-- NIGHTLINE migration 0001: passenger identity, atomic allocation, tickets, RLS.
-- Targets Supabase (auth.users, auth.uid(), roles anon / authenticated / service_role).
-- Corrected before any cloud deploy: public manifest has no verification codes,
-- SECURITY DEFINER functions use an empty search_path, unverified Instagram handles
-- do not reserve usernames, and grants touch only these objects.

create type public.passenger_kind as enum ('founding', 'stowaway');
create type public.moderation_status as enum ('ok', 'hidden', 'flagged');

-- ---------- configuration ----------
create table public.site_settings (
  key text primary key,
  value jsonb not null,
  note text,
  updated_at timestamptz not null default pg_catalog.now()
);
insert into public.site_settings (key, value, note) values
  ('payments_enabled', 'false', 'Master switch. Stays false until the creator approves provider, quantities, terms and refunds.'),
  ('passenger_500_rule', '"undecided"', 'undecided | last_founder | conductor. Allocation applies NO special role while undecided.'),
  ('registration_open', 'true', 'Kill switch for new registrations.'),
  ('terms_version', '"2026-11-18"', 'Version string recorded when a passenger accepts the terms.'),
  ('privacy_version', '"2026-11-18"', 'Version string recorded when a passenger accepts the privacy notice.');

create table public.role_definitions (
  key text primary key,
  label text not null,
  is_unique boolean not null default true,
  enabled boolean not null default false,
  note text
);
insert into public.role_definitions (key, label, enabled, note) values
  ('last_founder',     'Last Founder',     false, 'Candidate for Passenger 500. Pending creator decision.'),
  ('conductor',        'Conductor',        false, 'Pending decision: Passenger 500 vs paid role. Not assigned automatically.'),
  ('deputy_conductor', 'Deputy Conductor', false, 'Used only if Passenger 500 stays Conductor.'),
  ('driver',           'Driver',           false, 'Paid role; disabled until quantities are confirmed.');

-- ---------- identity ----------
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now()
);

-- profiles.id matches the auth user id at registration. It is intentionally not an
-- ON DELETE CASCADE foreign key: anonymise_passenger() clears personal data and the
-- departed shell can outlive the auth user. register_passenger() still requires a
-- live auth.users row before creating anything.
create table public.profiles (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 2 and 32),
  instagram_handle text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  handle_public boolean not null default false,
  handle_verified boolean not null default false,
  is_listed boolean not null default true,
  bio text check (char_length(bio) <= 280),
  moderation public.moderation_status not null default 'ok',
  terms_accepted_at timestamptz not null,
  terms_version text not null,
  privacy_version text not null,
  anonymised_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

-- Only a verified handle reserves the username. Unverified claims do not.
create unique index profiles_verified_handle_unique
  on public.profiles (lower(instagram_handle))
  where instagram_handle is not null and handle_verified;

create table public.seat_inventory (
  seat_number int primary key check (seat_number > 0),
  carriage int not null,
  seat_label text not null,
  seat_class text not null default 'standard',
  claimed_by uuid unique
);
insert into public.seat_inventory (seat_number, carriage, seat_label)
select n,
       ((n - 1) / 50) + 1,
       'C' || (((n - 1) / 50) + 1) || '-' || pg_catalog.lpad((((n - 1) % 50) + 1)::text, 2, '0')
from pg_catalog.generate_series(1, 500) n;

create sequence public.stowaway_seq start 1;

create table public.passengers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id),
  kind public.passenger_kind not null,
  passenger_number int unique references public.seat_inventory(seat_number),
  stowaway_number int unique,
  seat_class text not null default 'standard',
  carriage int,
  seat_label text,
  special_role text references public.role_definitions(key),
  issued_at timestamptz not null default pg_catalog.now(),
  constraint identity_matches_kind check (
    (kind = 'founding' and passenger_number is not null and stowaway_number is null) or
    (kind = 'stowaway' and passenger_number is null and stowaway_number is not null))
);
create unique index passengers_unique_role on public.passengers (special_role) where special_role is not null;

create table public.tickets (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  passenger_id uuid not null unique references public.passengers(id) on delete cascade,
  serial text not null unique,
  verification_code text not null unique,
  design_variant text not null default 'standard',
  wear jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default pg_catalog.now(),
  actor uuid,
  action text not null,
  subject text,
  detail jsonb not null default '{}'::jsonb
);

-- Changing the handle clears verification. Runs as the table owner so it can
-- touch handle_verified, which passengers are not granted.
create or replace function public.tg_reset_handle_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.instagram_handle is distinct from old.instagram_handle then
    new.handle_verified := false;
  end if;
  return new;
end;
$$;

create trigger profiles_reset_handle_verification
  before update of instagram_handle on public.profiles
  for each row execute function public.tg_reset_handle_verification();

-- ---------- atomic registration ----------
-- Browser roles cannot execute this. The Next.js server must authenticate the
-- session first, then call it with that user's id. A non-null auth.uid() that
-- does not match p_user_id is rejected. Passenger numbers are never arguments.
create or replace function public.register_passenger(
  p_user_id uuid,
  p_display_name text,
  p_instagram text,
  p_terms boolean,
  p_terms_version text,
  p_privacy_version text
)
returns table (
  passenger_id uuid,
  kind public.passenger_kind,
  passenger_number int,
  stowaway_number int,
  seat_label text,
  ticket_serial text,
  verification_code text,
  already_registered boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat public.seat_inventory%rowtype;
  v_pid uuid;
  v_kind public.passenger_kind;
  v_snum int;
  v_serial text;
  v_code text;
  v_handle text;
  v_terms text;
  v_privacy text;
begin
  -- current_user inside SECURITY DEFINER is the owner, so the browser roles are
  -- blocked by EXECUTE grants. This rejects a JWT or a session that is still
  -- anon/authenticated if those grants are ever widened by mistake.
  if session_user in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'user_mismatch' using errcode = '42501';
  end if;
  if not p_terms then
    raise exception 'terms_not_accepted' using errcode = 'P0001';
  end if;
  if p_terms_version is null or pg_catalog.btrim(p_terms_version) = ''
     or p_privacy_version is null or pg_catalog.btrim(p_privacy_version) = '' then
    raise exception 'policy_version_required' using errcode = 'P0001';
  end if;

  select s.value #>> '{}' into v_terms from public.site_settings s where s.key = 'terms_version';
  select s.value #>> '{}' into v_privacy from public.site_settings s where s.key = 'privacy_version';
  if p_terms_version is distinct from v_terms then
    raise exception 'terms_version_mismatch' using errcode = 'P0001';
  end if;
  if p_privacy_version is distinct from v_privacy then
    raise exception 'privacy_version_mismatch' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'unknown_user' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nightline.registration'));

  if exists (select 1 from public.passengers p where p.user_id = p_user_id) then
    return query
      select p.id, p.kind, p.passenger_number, p.stowaway_number, p.seat_label,
             t.serial, t.verification_code, true
      from public.passengers p
      join public.tickets t on t.passenger_id = p.id
      where p.user_id = p_user_id;
    return;
  end if;

  if exists (select 1 from public.profiles pr where pr.id = p_user_id and pr.anonymised_at is not null) then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;

  if (select s.value from public.site_settings s where s.key = 'registration_open') <> 'true'::jsonb then
    raise exception 'registration_closed' using errcode = 'P0001';
  end if;

  v_handle := nullif(pg_catalog.btrim(p_instagram, ' @'), '');

  insert into public.profiles (
    id, display_name, instagram_handle, terms_accepted_at, terms_version, privacy_version
  ) values (
    p_user_id, pg_catalog.btrim(p_display_name), v_handle, pg_catalog.now(), p_terms_version, p_privacy_version
  )
  on conflict (id) do nothing;

  select * into v_seat
  from public.seat_inventory
  where claimed_by is null
  order by seat_number
  limit 1
  for update;

  if found then
    v_kind := 'founding';
    update public.seat_inventory
      set claimed_by = p_user_id
      where seat_number = v_seat.seat_number;
    insert into public.passengers (user_id, kind, passenger_number, seat_class, carriage, seat_label)
    values (p_user_id, 'founding', v_seat.seat_number, v_seat.seat_class, v_seat.carriage, v_seat.seat_label)
    returning id into v_pid;
    v_serial := 'NL-F' || pg_catalog.lpad(v_seat.seat_number::text, 3, '0');
  else
    v_kind := 'stowaway';
    v_snum := pg_catalog.nextval('public.stowaway_seq');
    insert into public.passengers (user_id, kind, stowaway_number)
    values (p_user_id, 'stowaway', v_snum)
    returning id into v_pid;
    v_serial := 'NL-S' || pg_catalog.lpad(v_snum::text, 4, '0');
  end if;

  v_code := pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 14);
  insert into public.tickets (passenger_id, serial, verification_code)
  values (v_pid, v_serial, v_code);

  insert into public.audit_log (actor, action, subject, detail)
  values (
    p_user_id,
    'passenger.allocated',
    v_pid::text,
    pg_catalog.jsonb_build_object('kind', v_kind, 'number', v_seat.seat_number, 'stowaway', v_snum)
  );

  return query
    select v_pid, v_kind, v_seat.seat_number, v_snum, v_seat.seat_label, v_serial, v_code, false;
end;
$$;

-- Service role only. Sets verification without letting the passenger do it.
-- The unique index rejects a second verified claim on the same handle.
create or replace function public.set_handle_verified(p_user_id uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.profiles
    set handle_verified = p_verified
    where id = p_user_id and instagram_handle is not null and anonymised_at is null;
  if not found then
    raise exception 'handle_missing' using errcode = 'P0001';
  end if;
exception
  when unique_violation then
    raise exception 'handle_taken' using errcode = 'P0001';
end;
$$;

-- Clears personal information. Keeps the seat and ticket serial so numbers stay
-- unique, but removes the name, handle, biography and audit actor link.
create or replace function public.anonymise_passenger(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.profiles
    set display_name = 'Departed',
        instagram_handle = null,
        handle_public = false,
        handle_verified = false,
        bio = null,
        is_listed = false,
        anonymised_at = pg_catalog.now()
    where id = p_user_id;

  update public.audit_log
    set actor = null,
        detail = '{}'::jsonb
    where actor = p_user_id;

  if pg_catalog.to_regclass('public.local_login_codes') is not null then
    delete from public.local_login_codes where user_id = p_user_id;
  end if;

  -- The seat stays claimed. The auth row is the record that still holds an email.
  delete from auth.users where id = p_user_id;
end;
$$;

-- ---------- public, privacy-safe reads ----------
-- Directory: listed, unmoderated passengers only. No emails, user ids, or ticket codes.
-- Instagram is included only when the passenger marked it public.
-- handle_verified is never true unless the handle itself is public.
create view public.manifest
  with (security_barrier = true, security_invoker = false)
as
select p.kind,
       p.passenger_number,
       p.stowaway_number,
       pr.display_name,
       p.seat_class,
       p.carriage,
       p.seat_label,
       p.special_role,
       case when pr.handle_public then pr.instagram_handle end as instagram_handle,
       case when pr.handle_public and pr.instagram_handle is not null then pr.handle_verified else false end as handle_verified
from public.passengers p
join public.profiles pr on pr.id = p.user_id
where pr.is_listed
  and pr.moderation = 'ok'
  and pr.anonymised_at is null;

create or replace function public.public_stats()
returns table (founding_claimed int, founding_capacity int, stowaways bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select (select pg_catalog.count(*)::int from public.seat_inventory where claimed_by is not null),
         (select pg_catalog.count(*)::int from public.seat_inventory),
         (select pg_catalog.count(*) from public.passengers where kind = 'stowaway');
$$;

-- Ticket verification is possession of the secret code, not a directory listing.
-- A private (unlisted) or anonymised profile still proves the ticket is real,
-- but the name and Instagram handle are omitted. A hidden passenger returns nothing.
-- The code itself is never returned.
create or replace function public.verify_ticket(p_code text)
returns table (
  serial text,
  kind public.passenger_kind,
  passenger_number int,
  stowaway_number int,
  display_name text,
  seat_class text,
  carriage int,
  seat_label text,
  special_role text,
  instagram_handle text,
  handle_verified boolean,
  identity_public boolean,
  issued_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select t.serial,
         p.kind,
         p.passenger_number,
         p.stowaway_number,
         case
           when pr.is_listed and pr.anonymised_at is null then pr.display_name
         end,
         p.seat_class,
         p.carriage,
         p.seat_label,
         p.special_role,
         case
           when pr.is_listed and pr.anonymised_at is null and pr.handle_public then pr.instagram_handle
         end,
         case
           when pr.is_listed and pr.anonymised_at is null and pr.handle_public and pr.instagram_handle is not null
             then pr.handle_verified
           else false
         end,
         (pr.is_listed and pr.anonymised_at is null),
         p.issued_at
  from public.tickets t
  join public.passengers p on p.id = t.passenger_id
  join public.profiles pr on pr.id = p.user_id
  where t.verification_code = p_code
    and pr.moderation <> 'hidden';
$$;

-- ---------- privileges & RLS ----------
alter table public.site_settings    enable row level security;
alter table public.role_definitions enable row level security;
alter table public.admin_users      enable row level security;
alter table public.profiles         enable row level security;
alter table public.seat_inventory   enable row level security;
alter table public.passengers       enable row level security;
alter table public.tickets          enable row level security;
alter table public.audit_log        enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy passengers_select_own on public.passengers
  for select to authenticated using (user_id = auth.uid());
create policy tickets_select_own on public.tickets
  for select to authenticated
  using (exists (
    select 1 from public.passengers p
    where p.id = passenger_id and p.user_id = auth.uid()
  ));
create policy roles_select_enabled on public.role_definitions
  for select to anon, authenticated using (enabled);

-- Grants are listed per object. This migration does not revoke privileges on
-- unrelated tables already present in public.
revoke all on table public.site_settings from anon, authenticated;
revoke all on table public.role_definitions from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.seat_inventory from anon, authenticated;
revoke all on table public.passengers from anon, authenticated;
revoke all on table public.tickets from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;

grant select on public.profiles, public.passengers, public.tickets, public.role_definitions to authenticated;
grant select on public.role_definitions to anon;
grant update (display_name, instagram_handle, handle_public, is_listed, bio)
  on public.profiles to authenticated;
grant select on public.manifest to anon, authenticated;

revoke all on function public.register_passenger(uuid, text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.set_handle_verified(uuid, boolean) from public, anon, authenticated;
revoke all on function public.anonymise_passenger(uuid) from public, anon, authenticated;
revoke all on function public.public_stats() from public;
revoke all on function public.verify_ticket(text) from public;
revoke all on function public.tg_reset_handle_verification() from public, anon, authenticated;

grant execute on function public.register_passenger(uuid, text, text, boolean, text, text) to service_role;
grant execute on function public.set_handle_verified(uuid, boolean) to service_role;
grant execute on function public.anonymise_passenger(uuid) to service_role;
grant execute on function public.public_stats() to anon, authenticated, service_role;
grant execute on function public.verify_ticket(text) to anon, authenticated, service_role;

-- service_role is the Supabase server key. It is not a browser role.
-- These grants cover only the tables created above.
grant select, insert, update, delete on
  public.site_settings, public.role_definitions, public.admin_users, public.profiles,
  public.seat_inventory, public.passengers, public.tickets, public.audit_log
  to service_role;
grant usage, select on sequence public.stowaway_seq to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;
grant select on public.manifest to service_role;

do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'nightline_app') then
    grant select, insert, update, delete on
      public.site_settings, public.role_definitions, public.admin_users, public.profiles,
      public.seat_inventory, public.passengers, public.tickets, public.audit_log
      to nightline_app;
    grant usage, select on sequence public.stowaway_seq to nightline_app;
    grant usage, select on sequence public.audit_log_id_seq to nightline_app;
    grant select on public.manifest to nightline_app;
    grant execute on function public.register_passenger(uuid, text, text, boolean, text, text) to nightline_app;
    grant execute on function public.set_handle_verified(uuid, boolean) to nightline_app;
    grant execute on function public.anonymise_passenger(uuid) to nightline_app;
    grant execute on function public.public_stats() to nightline_app;
    grant execute on function public.verify_ticket(text) to nightline_app;
  end if;
end $$;
