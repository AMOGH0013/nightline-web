-- NIGHTLINE migration 0003: imported follower identities and separate Luxury seats.
-- This is intentionally additive: legacy passenger_number and issued tickets are preserved.

alter table public.profiles
  alter column terms_accepted_at drop not null,
  alter column terms_version drop not null,
  alter column privacy_version drop not null,
  add column if not exists owner_user_id uuid unique references auth.users(id);

alter table public.passengers
  add column if not exists account_user_id uuid unique references auth.users(id),
  add column if not exists follower_rank bigint,
  add column if not exists permanent_number bigint,
  add column if not exists original_entitlement text,
  add column if not exists boarded_at timestamptz,
  add column if not exists boarded_on_journey_day integer;

update public.passengers set account_user_id = user_id where account_user_id is null;
update public.profiles set owner_user_id = id where owner_user_id is null and exists (select 1 from auth.users u where u.id = profiles.id);

alter table public.passengers add constraint passengers_follower_rank_positive
  check (follower_rank is null or follower_rank > 0);
alter table public.passengers add constraint passengers_permanent_number_mapping
  check (permanent_number is null or (follower_rank is not null and permanent_number = 99 + follower_rank));
alter table public.passengers add constraint passengers_original_entitlement_check
  check (original_entitlement is null or original_entitlement in ('luxury','silver','bronze','regular'));
alter table public.passengers add constraint passengers_entitlement_matches_number
  check (permanent_number is null or original_entitlement = case
    when permanent_number between 100 and 199 then 'luxury'
    when permanent_number between 200 and 499 then 'silver'
    when permanent_number between 500 and 999 then 'bronze'
    else 'regular' end);
alter table public.passengers add constraint passengers_boarding_day_positive
  check (boarded_on_journey_day is null or boarded_on_journey_day > 0);
create unique index passengers_follower_rank_unique on public.passengers (follower_rank) where follower_rank is not null;
create unique index passengers_permanent_number_unique on public.passengers (permanent_number) where permanent_number is not null;
create index passengers_account_user_lookup on public.passengers (account_user_id) where account_user_id is not null;

create table public.follower_manifest_imports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  uploaded_by uuid references auth.users(id),
  file_names text[] not null,
  content_sha256 text not null,
  status text not null check (status in ('preview','confirmed','rejected','expired')),
  total_records integer not null default 0,
  unique_records integer not null default 0,
  duplicate_records integer not null default 0,
  malformed_records integer not null default 0,
  missing_timestamps integer not null default 0,
  late_historical_records integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  confirmed_at timestamptz
);

create table public.follower_records (
  normalized_username text primary key check (normalized_username ~ '^[a-z0-9._]{1,30}$'),
  profile_url text,
  followed_at timestamptz,
  source_order integer not null default 0 check (source_order >= 0),
  first_seen_at timestamptz not null default pg_catalog.now(),
  last_seen_at timestamptz not null default pg_catalog.now(),
  present_in_latest_snapshot boolean not null default true,
  late_review_required boolean not null default false,
  passenger_id uuid unique references public.passengers(id),
  source_import_id uuid references public.follower_manifest_imports(id),
  updated_at timestamptz not null default pg_catalog.now()
);
create index follower_records_followed_at_idx on public.follower_records (followed_at, normalized_username);

create table public.follower_import_preview_rows (
  import_id uuid not null references public.follower_manifest_imports(id) on delete cascade,
  normalized_username text not null,
  profile_url text,
  followed_at timestamptz,
  disposition text not null check (disposition in ('new','existing','late_review','legacy_conflict')),
  existing_passenger_id uuid references public.passengers(id),
  primary key (import_id, normalized_username)
);

create table public.passenger_identity_history (
  id bigint generated always as identity primary key,
  passenger_id uuid not null references public.passengers(id),
  follower_rank bigint not null,
  permanent_number bigint not null,
  original_entitlement text not null,
  import_id uuid not null references public.follower_manifest_imports(id),
  assigned_at timestamptz not null default pg_catalog.now(),
  unique (follower_rank),
  unique (permanent_number)
);

create table public.luxury_seat_inventory (
  seat_code text primary key check (seat_code ~ '^L-(00[1-9]|0[1-9][0-9]|[1-3][0-9]{2}|400)$'),
  seat_number integer not null unique check (seat_number between 1 and 400),
  pool text not null check (pool in ('premium','follower_entitlement','future_upgrade')),
  price_inr integer check (price_inr is null or price_inr > 0),
  sale_approved boolean not null default false,
  status text not null check (status in ('available','held','pending_payment','sold','refunded','blocked')),
  assignment_type text check (assignment_type in ('follower_entitlement','purchase')),
  passenger_id uuid references public.passengers(id),
  held_by uuid references auth.users(id),
  held_until timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  check ((status in ('held','pending_payment')) = (held_until is not null)),
  check ((status = 'sold') = (passenger_id is not null)),
  check ((status in ('held','pending_payment')) = (held_by is not null)),
  check ((status = 'sold') = (assignment_type is not null)),
  check ((status = 'blocked') or (pool <> 'premium' or status in ('available','held','pending_payment','sold','refunded')))
);
create unique index luxury_seat_one_active_per_passenger on public.luxury_seat_inventory (passenger_id)
  where passenger_id is not null and status='sold';
insert into public.luxury_seat_inventory (seat_code, seat_number, pool, price_inr, sale_approved, status)
select 'L-' || pg_catalog.lpad(n::text, 3, '0'), n,
       case when n <= 99 then 'premium' when n <= 199 then 'follower_entitlement' else 'future_upgrade' end,
       case when n = 1 then 999 when n = 2 then 799 when n = 3 then 699
            when n between 4 and 9 then 499 when n between 11 and 49 then 99
            when n between 50 and 99 then 49 else null end,
       n <= 99 and n <> 10,
       case when n = 10 or n >= 200 then 'blocked' else 'available' end
from pg_catalog.generate_series(1, 400) n;

create table public.seat_reservations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  passenger_id uuid not null references public.passengers(id),
  account_user_id uuid not null references auth.users(id),
  seat_code text not null references public.luxury_seat_inventory(seat_code),
  idempotency_key text not null,
  price_inr integer not null check (price_inr > 0),
  status text not null check (status in ('held','pending_payment','paid','failed','expired','refunded')),
  expires_at timestamptz not null,
  provider text,
  provider_ref text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (account_user_id, idempotency_key)
);
create unique index seat_reservations_provider_ref_unique on public.seat_reservations (provider, provider_ref)
  where provider_ref is not null;
create unique index seat_reservations_one_active_per_account on public.seat_reservations(account_user_id)
  where status in ('held','pending_payment');
create index seat_reservations_expiry_idx on public.seat_reservations (expires_at) where status in ('held','pending_payment');

create table public.passenger_video_consent (
  passenger_id uuid primary key references public.passengers(id) on delete cascade,
  allowed boolean not null default false,
  approved_public_label text,
  updated_at timestamptz not null default pg_catalog.now()
);
create table public.passenger_video_consent_history (
  id bigint generated always as identity primary key,
  passenger_id uuid not null references public.passengers(id) on delete cascade,
  account_user_id uuid references auth.users(id),
  allowed boolean not null,
  approved_public_label text,
  changed_at timestamptz not null default pg_catalog.now()
);
grant usage,select on sequence public.passenger_identity_history_id_seq,
  public.passenger_video_consent_history_id_seq to service_role;
do $$ begin
  if exists(select 1 from pg_catalog.pg_roles where rolname='nightline_app') then
    execute 'grant usage,select on sequence public.passenger_identity_history_id_seq, public.passenger_video_consent_history_id_seq to nightline_app';
  end if;
end $$;

create table public.pending_boarding_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  normalized_username text not null check (normalized_username ~ '^[a-z0-9._]{1,30}$'),
  request_key_hash text not null,
  status text not null default 'pending' check (status in ('pending','matched','closed')),
  created_at timestamptz not null default pg_catalog.now(),
  matched_at timestamptz
);
create index pending_boarding_requests_username_idx on public.pending_boarding_requests (normalized_username, created_at desc);

create table public.journey_settings (
  id integer primary key default 1 check (id = 1),
  launch_at timestamptz,
  timezone text not null default 'Asia/Kolkata',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default pg_catalog.now()
);
insert into public.journey_settings (id) values (1) on conflict (id) do nothing;

create or replace function public.journey_day_for(p_timestamp timestamptz default pg_catalog.now())
returns integer language plpgsql stable security definer set search_path = '' as $$
declare
  v_launch timestamptz;
  v_timezone text;
begin
  select launch_at, timezone into v_launch, v_timezone from public.journey_settings where id=1;
  if v_launch is null or p_timestamp < v_launch then return null; end if;
  return ((p_timestamp at time zone v_timezone)::date - (v_launch at time zone v_timezone)::date) + 1;
end;
$$;

create table public.username_lookup_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default pg_catalog.now()
);
alter table public.username_lookup_rate_limits enable row level security;

create table public.passenger_claim_challenges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  passenger_id uuid not null references public.passengers(id) on delete cascade,
  code_hash text not null,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

create or replace function public.guard_passenger_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.follower_rank is not null and new.follower_rank is distinct from old.follower_rank then
    raise exception 'follower_rank_immutable' using errcode = '23514';
  end if;
  if old.permanent_number is not null and new.permanent_number is distinct from old.permanent_number then
    raise exception 'permanent_number_immutable' using errcode = '23514';
  end if;
  if old.original_entitlement is not null and new.original_entitlement is distinct from old.original_entitlement then
    raise exception 'original_entitlement_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger passengers_identity_immutable before update on public.passengers
  for each row execute function public.guard_passenger_identity();

create or replace function public.assign_follower_identity(
  p_import_id uuid,
  p_username text,
  p_followed_at timestamptz,
  p_profile_url text,
  p_follower_rank bigint,
  p_permanent_number bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_identity uuid := pg_catalog.gen_random_uuid();
  v_passenger uuid;
  v_entitlement text;
  v_stowaway bigint;
  v_code text;
begin
  if session_user in ('anon','authenticated') or coalesce(auth.role(),'') in ('anon','authenticated') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_permanent_number <> 99 + p_follower_rank then raise exception 'number_mapping_invalid'; end if;
  v_entitlement := case when p_permanent_number between 100 and 199 then 'luxury'
                        when p_permanent_number between 200 and 499 then 'silver'
                        when p_permanent_number between 500 and 999 then 'bronze' else 'regular' end;
  v_stowaway := pg_catalog.nextval('public.stowaway_seq');
  insert into public.profiles (id, display_name, instagram_handle, handle_public, is_listed,
    terms_accepted_at, terms_version, privacy_version)
  values (v_identity, 'Passenger ' || p_permanent_number::text, p_username, false, false, null, null, null);
  insert into public.passengers (user_id, kind, stowaway_number, seat_class, follower_rank,
    permanent_number, original_entitlement, boarded_at, boarded_on_journey_day)
  values (v_identity, 'stowaway', v_stowaway, v_entitlement, p_follower_rank,
    p_permanent_number, v_entitlement, pg_catalog.now(), public.journey_day_for(pg_catalog.now()))
  returning id into v_passenger;
  v_code := pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 14);
  insert into public.tickets (passenger_id, serial, verification_code, design_variant)
    values (v_passenger, 'NL-P' || pg_catalog.lpad(p_permanent_number::text, 4, '0'), v_code, v_entitlement);
  insert into public.follower_records (normalized_username, profile_url, followed_at, passenger_id, source_import_id)
    values (p_username, p_profile_url, p_followed_at, v_passenger, p_import_id)
    on conflict (normalized_username) do update set profile_url=excluded.profile_url,
      followed_at=excluded.followed_at, last_seen_at=pg_catalog.now(),
      present_in_latest_snapshot=true, source_import_id=excluded.source_import_id,
      updated_at=pg_catalog.now();
  insert into public.passenger_identity_history (passenger_id,follower_rank,permanent_number,original_entitlement,import_id)
    values (v_passenger,p_follower_rank,p_permanent_number,v_entitlement,p_import_id);
  insert into public.journey_events (passenger_id,title,body,occurred_at)
    values (v_passenger,'Boarded','Verified follower manifest import.',pg_catalog.now());
  if p_follower_rank <= 100 then
    update public.luxury_seat_inventory set status='sold', passenger_id=v_passenger,
      assignment_type='follower_entitlement', updated_at=pg_catalog.now()
      where seat_number = 99 + p_follower_rank and pool='follower_entitlement' and status='available';
    if not found then raise exception 'follower_luxury_seat_unavailable'; end if;
  end if;
  return v_passenger;
end;
$$;

create or replace view public.passenger_ticket_lookup
  with (security_barrier = true, security_invoker = false) as
select lower(pr.instagram_handle) as normalized_username,
       p.id as passenger_id, p.follower_rank, p.permanent_number, p.original_entitlement,
       p.seat_class as current_accommodation, p.carriage, p.seat_label,
       p.boarded_at, p.boarded_on_journey_day, p.kind, p.passenger_number, p.stowaway_number,
       pr.display_name, pr.instagram_handle, pr.handle_verified, t.serial,
       pr.handle_public, p.special_role, r.label as role_label, p.issued_at,
       t.verification_code,
       ls.seat_code as luxury_seat_code,
       case when pr.anonymised_at is null then 'active' else 'departed' end as ticket_status
from public.passengers p
join public.profiles pr on pr.id=p.user_id
join public.tickets t on t.passenger_id=p.id
left join public.role_definitions r on r.key=p.special_role
left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
where pr.moderation <> 'hidden';

create or replace function public.cast_vote(p_poll_id uuid,p_option_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid := auth.uid();
  v_identity uuid;
  v_at timestamptz := pg_catalog.now();
begin
  if v_account is null then raise exception 'unauthenticated' using errcode='42501'; end if;
  select p.user_id into v_identity from public.passengers p
    join public.profiles pr on pr.id=p.user_id
    where coalesce(p.account_user_id,p.user_id)=v_account and pr.anonymised_at is null;
  if v_identity is null then raise exception 'not_a_passenger' using errcode='P0001'; end if;
  if not exists(select 1 from public.polls poll where poll.id=p_poll_id and poll.published
    and v_at >= poll.opens_at and v_at < poll.closes_at) then
    raise exception 'poll_closed' using errcode='P0001';
  end if;
  if not exists(select 1 from public.poll_options o where o.id=p_option_id and o.poll_id=p_poll_id) then
    raise exception 'invalid_option' using errcode='P0001';
  end if;
  insert into public.votes(poll_id,user_id,option_id,created_at) values(p_poll_id,v_identity,p_option_id,v_at);
  return v_at;
exception when unique_violation then raise exception 'already_voted' using errcode='P0001';
end;
$$;

create or replace function public.anonymise_passenger(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_identity uuid;
begin
  if session_user in ('anon','authenticated') or coalesce(auth.role(),'') in ('anon','authenticated') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_user_id then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select p.user_id into v_identity from public.passengers p
    where coalesce(p.account_user_id,p.user_id)=p_user_id for update;
  if v_identity is null then raise exception 'passenger_missing' using errcode='P0001'; end if;
  update public.profiles set display_name='Departed',instagram_handle=null,handle_public=false,handle_verified=false,
    bio=null,is_listed=false,anonymised_at=pg_catalog.now(),owner_user_id=null where id=v_identity;
  update public.passenger_video_consent set allowed=false,approved_public_label=null,updated_at=pg_catalog.now() where passenger_id=(select id from public.passengers where user_id=v_identity);
  insert into public.passenger_video_consent_history(passenger_id,account_user_id,allowed,approved_public_label)
    select id,p_user_id,false,null from public.passengers where user_id=v_identity;
  update public.audit_log set actor=null,detail='{}'::jsonb where actor=p_user_id;
  if pg_catalog.to_regclass('public.local_login_codes') is not null then delete from public.local_login_codes where user_id=p_user_id; end if;
  update public.passengers set account_user_id=null where user_id=v_identity and account_user_id=p_user_id;
  delete from auth.users where id=p_user_id;
end;
$$;

create or replace function public.verify_passenger_ticket(p_code text)
returns table (
  serial text,
  kind public.passenger_kind,
  passenger_number integer,
  stowaway_number integer,
  permanent_number bigint,
  follower_rank bigint,
  original_entitlement text,
  current_accommodation text,
  luxury_seat_code text,
  display_name text,
  instagram_handle text,
  handle_verified boolean,
  identity_public boolean,
  seat_class text,
  carriage integer,
  seat_label text,
  special_role text,
  issued_at timestamptz,
  boarded_on_journey_day integer,
  ticket_status text
)
language sql security definer stable set search_path = '' as $$
  select t.serial,p.kind,p.passenger_number,p.stowaway_number,p.permanent_number,p.follower_rank,
    p.original_entitlement,p.seat_class,ls.seat_code,
    case when pr.is_listed and pr.anonymised_at is null then pr.display_name end,
    case when pr.is_listed and pr.anonymised_at is null and pr.handle_public then pr.instagram_handle end,
    case when pr.is_listed and pr.anonymised_at is null and pr.handle_public then pr.handle_verified else false end,
    (pr.is_listed and pr.anonymised_at is null),p.seat_class,p.carriage,p.seat_label,p.special_role,
    p.issued_at,p.boarded_on_journey_day,
    case when pr.anonymised_at is null then 'active' else 'departed' end
  from public.tickets t
  join public.passengers p on p.id=t.passenger_id
  join public.profiles pr on pr.id=p.user_id
  left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
  where t.verification_code=p_code and pr.moderation <> 'hidden';
$$;

create or replace view public.manifest
  with (security_barrier = true, security_invoker = false) as
select p.kind,p.passenger_number,p.stowaway_number,pr.display_name,p.seat_class,p.carriage,p.seat_label,p.special_role,
  case when pr.handle_public then pr.instagram_handle end as instagram_handle,
  case when pr.handle_public and pr.instagram_handle is not null then pr.handle_verified else false end as handle_verified,
  coalesce((select pg_catalog.array_agg(a.label order by a.label) from public.passenger_achievements pa
    join public.achievements a on a.key=pa.achievement_key where pa.passenger_id=p.id),array[]::text[]) as achievements,
  p.permanent_number,p.follower_rank,p.original_entitlement,p.seat_class as current_accommodation,
  ls.seat_code as luxury_seat_code,p.boarded_on_journey_day as boarding_day
from public.passengers p
join public.profiles pr on pr.id=p.user_id
left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
where pr.is_listed and pr.moderation='ok' and pr.anonymised_at is null;

create or replace function public.reserve_luxury_seat(
  p_account_user_id uuid,
  p_seat_code text,
  p_idempotency_key text
)
returns table(reservation_id uuid, price_inr integer, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_passenger public.passengers%rowtype;
  v_seat public.luxury_seat_inventory%rowtype;
  v_existing public.seat_reservations%rowtype;
  v_id uuid;
  v_expiry timestamptz := pg_catalog.now() + interval '15 minutes';
begin
  if session_user in ('anon','authenticated') or coalesce(auth.role(),'') in ('anon','authenticated') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if (select value from public.site_settings where key='payments_enabled') <> 'true'::jsonb then
    raise exception 'payments_disabled' using errcode='P0001';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'invalid_idempotency_key' using errcode='P0001';
  end if;
  select * into v_existing from public.seat_reservations r
    where r.account_user_id=p_account_user_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.seat_code <> p_seat_code then raise exception 'idempotency_conflict' using errcode='P0001'; end if;
    return query select v_existing.id,v_existing.price_inr,v_existing.expires_at;
    return;
  end if;
  select * into v_passenger from public.passengers p where p.account_user_id=p_account_user_id for update;
  if not found then raise exception 'passenger_missing' using errcode='P0001'; end if;
  update public.seat_reservations r set status='expired',updated_at=pg_catalog.now()
    where r.account_user_id=p_account_user_id and r.status in ('held','pending_payment') and r.expires_at <= pg_catalog.now();
  update public.luxury_seat_inventory set status='available',held_by=null,held_until=null,updated_at=pg_catalog.now()
    where held_by=p_account_user_id and status in ('held','pending_payment') and held_until <= pg_catalog.now();
  if exists (select 1 from public.seat_reservations r where r.account_user_id=p_account_user_id and r.status in ('held','pending_payment')) then
    raise exception 'reservation_already_active' using errcode='P0001';
  end if;
  select * into v_seat from public.luxury_seat_inventory where seat_code=p_seat_code for update;
  if not found or v_seat.pool <> 'premium' or not v_seat.sale_approved or v_seat.status <> 'available' or v_seat.price_inr is null then
    raise exception 'seat_unavailable' using errcode='P0001';
  end if;
  update public.luxury_seat_inventory set status='held',held_by=p_account_user_id,held_until=v_expiry,updated_at=pg_catalog.now()
    where seat_code=p_seat_code and status='available';
  if not found then raise exception 'seat_unavailable' using errcode='P0001'; end if;
  insert into public.seat_reservations(passenger_id,account_user_id,seat_code,idempotency_key,price_inr,status,expires_at)
    values(v_passenger.id,p_account_user_id,p_seat_code,p_idempotency_key,v_seat.price_inr,'held',v_expiry)
    returning id into v_id;
  return query select v_id,v_seat.price_inr,v_expiry;
end;
$$;

create or replace function public.finalize_verified_luxury_payment(p_reservation_id uuid, p_provider text, p_provider_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.seat_reservations%rowtype;
  v_old public.luxury_seat_inventory%rowtype;
begin
  if session_user in ('anon','authenticated') or coalesce(auth.role(),'') in ('anon','authenticated') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if (select value from public.site_settings where key='payments_enabled') <> 'true'::jsonb then
    raise exception 'payments_disabled' using errcode='P0001';
  end if;
  if p_provider is null or p_provider_ref is null then raise exception 'provider_reference_required'; end if;
  select * into v_order from public.seat_reservations where id=p_reservation_id for update;
  if not found or v_order.status <> 'held' or v_order.expires_at <= pg_catalog.now() then
    raise exception 'reservation_expired' using errcode='P0001';
  end if;
  perform 1 from public.luxury_seat_inventory where seat_code=v_order.seat_code for update;
  if not found then raise exception 'seat_unavailable' using errcode='P0001'; end if;
  select * into v_old from public.luxury_seat_inventory where passenger_id=v_order.passenger_id and status='sold' for update;
  if found then
    update public.luxury_seat_inventory set status='available',assignment_type=null,passenger_id=null,updated_at=pg_catalog.now()
      where seat_code=v_old.seat_code;
  end if;
  update public.luxury_seat_inventory set status='sold',assignment_type='purchase',passenger_id=v_order.passenger_id,
    held_by=null,held_until=null,updated_at=pg_catalog.now()
    where seat_code=v_order.seat_code and held_by=v_order.account_user_id and status='held';
  if not found then raise exception 'seat_unavailable' using errcode='P0001'; end if;
  update public.passengers set seat_class='luxury' where id=v_order.passenger_id;
  update public.tickets set design_variant='luxury' where passenger_id=v_order.passenger_id;
  update public.seat_reservations set status='paid',provider=p_provider,provider_ref=p_provider_ref,
    updated_at=pg_catalog.now() where id=p_reservation_id;
end;
$$;

alter table public.follower_manifest_imports enable row level security;
alter table public.follower_records enable row level security;
alter table public.follower_import_preview_rows enable row level security;
alter table public.passenger_identity_history enable row level security;
alter table public.luxury_seat_inventory enable row level security;
alter table public.seat_reservations enable row level security;
alter table public.passenger_video_consent enable row level security;
alter table public.passenger_video_consent_history enable row level security;
alter table public.pending_boarding_requests enable row level security;
alter table public.journey_settings enable row level security;
alter table public.passenger_claim_challenges enable row level security;

drop policy profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id=auth.uid() or owner_user_id=auth.uid());
drop policy profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id=auth.uid() or owner_user_id=auth.uid()) with check (id=auth.uid() or owner_user_id=auth.uid());
drop policy passengers_select_own on public.passengers;
create policy passengers_select_own on public.passengers for select to authenticated
  using (user_id=auth.uid() or account_user_id=auth.uid());
drop policy tickets_select_own on public.tickets;
create policy tickets_select_own on public.tickets for select to authenticated using (exists (
  select 1 from public.passengers p where p.id=passenger_id and (p.user_id=auth.uid() or p.account_user_id=auth.uid())
));

drop policy votes_select_own on public.votes;
create policy votes_select_own on public.votes for select to authenticated using (
  user_id=auth.uid() or exists(select 1 from public.passengers p where p.user_id=votes.user_id and p.account_user_id=auth.uid())
);
drop policy journey_select_own on public.journey_events;
create policy journey_select_own on public.journey_events for select to authenticated using (exists (
  select 1 from public.passengers p where p.id=journey_events.passenger_id
    and (p.user_id=auth.uid() or p.account_user_id=auth.uid())
));
drop policy stamps_select_own on public.stamps;
create policy stamps_select_own on public.stamps for select to authenticated using (exists (
  select 1 from public.passengers p where p.id=stamps.passenger_id
    and (p.user_id=auth.uid() or p.account_user_id=auth.uid())
));
drop policy earned_select_own on public.passenger_achievements;
create policy earned_select_own on public.passenger_achievements for select to authenticated using (exists (
  select 1 from public.passengers p where p.id=passenger_achievements.passenger_id
    and (p.user_id=auth.uid() or p.account_user_id=auth.uid())
));
drop policy submissions_select_own on public.submissions;
create policy submissions_select_own on public.submissions for select to authenticated using (
  user_id=auth.uid() or exists(select 1 from public.passengers p where p.user_id=submissions.user_id and p.account_user_id=auth.uid())
);

revoke all on public.follower_manifest_imports, public.follower_records, public.follower_import_preview_rows,
  public.passenger_identity_history, public.luxury_seat_inventory, public.seat_reservations,
  public.passenger_video_consent, public.passenger_video_consent_history, public.pending_boarding_requests,
  public.journey_settings, public.passenger_claim_challenges from public, anon, authenticated;
revoke all on function public.assign_follower_identity(uuid,text,timestamptz,text,bigint,bigint) from public, anon, authenticated;
revoke all on function public.reserve_luxury_seat(uuid,text,text) from public, anon, authenticated;
revoke all on function public.finalize_verified_luxury_payment(uuid,text,text) from public, anon, authenticated;
revoke all on function public.verify_passenger_ticket(text) from public;
revoke all on public.passenger_ticket_lookup from public, anon, authenticated;

grant select,insert,update,delete on public.follower_manifest_imports, public.follower_records,
  public.follower_import_preview_rows, public.passenger_identity_history, public.luxury_seat_inventory,
  public.seat_reservations, public.passenger_video_consent, public.passenger_video_consent_history,
  public.pending_boarding_requests, public.journey_settings, public.passenger_claim_challenges,
  public.username_lookup_rate_limits to service_role;
grant execute on function public.assign_follower_identity(uuid,text,timestamptz,text,bigint,bigint) to service_role;
grant execute on function public.journey_day_for(timestamptz) to service_role;
grant execute on function public.reserve_luxury_seat(uuid,text,text) to service_role;
grant execute on function public.finalize_verified_luxury_payment(uuid,text,text) to service_role;
grant execute on function public.verify_passenger_ticket(text) to anon,authenticated,service_role;
grant select on public.passenger_ticket_lookup to service_role;
do $$ begin
  if exists(select 1 from pg_catalog.pg_roles where rolname='nightline_app') then
    execute 'grant select,insert,update,delete on public.follower_manifest_imports, public.follower_records, public.follower_import_preview_rows, public.passenger_identity_history, public.luxury_seat_inventory, public.seat_reservations, public.passenger_video_consent, public.passenger_video_consent_history, public.pending_boarding_requests, public.journey_settings, public.passenger_claim_challenges, public.username_lookup_rate_limits to nightline_app';
    execute 'grant execute on function public.assign_follower_identity(uuid,text,timestamptz,text,bigint,bigint) to nightline_app';
    execute 'grant execute on function public.journey_day_for(timestamptz) to nightline_app';
    execute 'grant execute on function public.reserve_luxury_seat(uuid,text,text) to nightline_app';
    execute 'grant execute on function public.verify_passenger_ticket(text) to nightline_app';
    execute 'grant select on public.passenger_ticket_lookup to nightline_app';
  end if;
end $$;

insert into public.site_settings (key,value,note) values
  ('journey_timezone','"Asia/Kolkata"','Timezone used by the server-side Journey Day clock.')
on conflict (key) do nothing;
