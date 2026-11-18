-- NIGHTLINE migration 0002: journey content, voting, archive, catalogue.
-- Payments stay disabled. Quantities and paid roles stay configurable and off.
-- Passenger 500 is not given a role.

create table public.train_status (
  id int primary key default 1 check (id = 1),
  state text not null default 'holding',
  headline text not null default 'No status has been published.',
  detail text,
  updated_at timestamptz not null default pg_catalog.now()
);
insert into public.train_status (id) values (1);

create table public.transmissions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

create table public.episodes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  number int unique,
  title text not null check (char_length(title) between 2 and 160),
  summary text not null check (char_length(summary) between 1 and 4000),
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

create table public.archive_entries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  kind text not null check (kind in (
    'episode', 'location', 'decision', 'vote_outcome', 'event', 'transmission', 'discovery'
  )),
  title text not null check (char_length(title) between 2 and 160),
  body text not null check (char_length(body) between 1 and 8000),
  occurred_on date,
  published boolean not null default false,
  source_poll_id uuid,
  created_at timestamptz not null default pg_catalog.now()
);

create table public.discoveries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 160),
  body text not null check (char_length(body) between 1 and 4000),
  published boolean not null default false,
  created_at timestamptz not null default pg_catalog.now()
);

create table public.announcements (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  title text not null,
  body text not null,
  active boolean not null default false,
  created_at timestamptz not null default pg_catalog.now()
);

create table public.achievements (
  key text primary key,
  label text not null,
  description text
);

create table public.passenger_achievements (
  passenger_id uuid not null references public.passengers(id) on delete cascade,
  achievement_key text not null references public.achievements(key),
  awarded_at timestamptz not null default pg_catalog.now(),
  primary key (passenger_id, achievement_key)
);

create table public.stamps (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  passenger_id uuid not null references public.passengers(id) on delete cascade,
  label text not null,
  note text,
  stamped_at timestamptz not null default pg_catalog.now()
);

create table public.journey_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  passenger_id uuid not null references public.passengers(id) on delete cascade,
  title text not null,
  body text,
  occurred_at timestamptz not null default pg_catalog.now()
);

create table public.polls (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 160),
  story text not null check (char_length(story) between 1 and 8000),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  show_results text not null default 'after_close' check (show_results in ('live', 'after_close', 'hidden')),
  published boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  constraint poll_window check (closes_at > opens_at)
);

create table public.poll_options (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 160),
  position int not null default 0
);

create table public.votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  option_id uuid not null references public.poll_options(id),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (poll_id, user_id)
);

create table public.products (
  key text primary key,
  label text not null,
  price_inr int not null check (price_inr >= 0),
  seat_class text,
  special_role text references public.role_definitions(key),
  quantity int check (quantity is null or quantity >= 0),
  enabled boolean not null default false,
  note text
);

insert into public.products (key, label, price_inr, seat_class, special_role, quantity, enabled, note) values
  ('standard',  'Standard passenger', 0,   'standard', null,        null, true,  'Issued with registration. No payment.'),
  ('luxury',    'Luxury seat',        99,  'luxury',   null,        null, false, 'Quantity is not finalized. Shown as coming soon.'),
  ('diamond',   'Diamond seat',       199, 'diamond',  null,        null, false, 'Quantity is not finalized. Shown as coming soon.'),
  ('driver',    'Driver',             299, null,       'driver',    null, false, 'Inventory is configurable. Disabled until the creator confirms it.'),
  ('conductor', 'Conductor',          149, null,       'conductor', null, false, 'Disabled. Passenger 500 is not assigned this role.');

create table public.purchases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  product_key text not null references public.products(key),
  status text not null check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  provider text,
  provider_ref text,
  created_at timestamptz not null default pg_catalog.now(),
  confirmed_at timestamptz
);

create table public.submissions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'archived')),
  created_at timestamptz not null default pg_catalog.now()
);

-- Boarding is a real journey event, written by the registration function's caller
-- (the server) after allocation. No fictional history is seeded.

create or replace function public.cast_vote(p_poll_id uuid, p_option_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_at timestamptz := pg_catalog.now();
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.passengers p where p.user_id = v_user) then
    raise exception 'not_a_passenger' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.polls poll
    where poll.id = p_poll_id
      and poll.published
      and v_at >= poll.opens_at
      and v_at < poll.closes_at
  ) then
    raise exception 'poll_closed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.poll_options o
    where o.id = p_option_id and o.poll_id = p_poll_id
  ) then
    raise exception 'invalid_option' using errcode = 'P0001';
  end if;

  insert into public.votes (poll_id, user_id, option_id, created_at)
  values (p_poll_id, v_user, p_option_id, v_at);
  return v_at;
exception
  when unique_violation then
    raise exception 'already_voted' using errcode = 'P0001';
end;
$$;

-- Results follow the poll's own setting. Hidden polls return no rows.
-- after_close polls return rows only once the window has ended.
create or replace function public.poll_results(p_poll_id uuid)
returns table (option_id uuid, label text, votes bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select o.id, o.label, pg_catalog.count(v.user_id)
  from public.poll_options o
  left join public.votes v on v.option_id = o.id
  join public.polls poll on poll.id = o.poll_id
  where o.poll_id = p_poll_id
    and poll.published
    and poll.show_results <> 'hidden'
    and (poll.show_results = 'live' or pg_catalog.now() >= poll.closes_at)
  group by o.id, o.label, o.position
  order by o.position, o.label;
$$;

-- Future payment confirmation. Refuses to run while payments are off, the
-- product is disabled, or a quantity has not been configured.
create or replace function public.apply_paid_entitlement(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_product public.products%rowtype;
  v_count int;
begin
  if session_user in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (select s.value from public.site_settings s where s.key = 'payments_enabled') <> 'true'::jsonb then
    raise exception 'payments_disabled' using errcode = 'P0001';
  end if;

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found or v_purchase.status <> 'paid' then
    raise exception 'purchase_not_paid' using errcode = 'P0001';
  end if;

  select * into v_product from public.products where key = v_purchase.product_key;
  if not v_product.enabled then
    raise exception 'product_disabled' using errcode = 'P0001';
  end if;
  if v_product.quantity is null then
    raise exception 'quantity_unconfigured' using errcode = 'P0001';
  end if;

  if v_product.seat_class is not null then
    select pg_catalog.count(*)::int into v_count
    from public.passengers where seat_class = v_product.seat_class;
    if v_count >= v_product.quantity then
      raise exception 'sold_out' using errcode = 'P0001';
    end if;
    update public.passengers
      set seat_class = v_product.seat_class
      where user_id = v_purchase.user_id;
    update public.tickets t
      set design_variant = v_product.seat_class
      from public.passengers p
      where t.passenger_id = p.id and p.user_id = v_purchase.user_id;
  end if;

  if v_product.special_role is not null then
    if not exists (
      select 1 from public.role_definitions r
      where r.key = v_product.special_role and r.enabled
    ) then
      raise exception 'role_disabled' using errcode = 'P0001';
    end if;
    select pg_catalog.count(*)::int into v_count
    from public.passengers where special_role = v_product.special_role;
    if v_count >= v_product.quantity then
      raise exception 'sold_out' using errcode = 'P0001';
    end if;
    update public.passengers
      set special_role = v_product.special_role
      where user_id = v_purchase.user_id;
  end if;
end;
$$;

-- Replace the directory view with achievement labels. Still no private columns.
create or replace view public.manifest
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
       case
         when pr.handle_public and pr.instagram_handle is not null then pr.handle_verified
         else false
       end as handle_verified,
       coalesce((
         select pg_catalog.array_agg(a.label order by a.label)
         from public.passenger_achievements pa
         join public.achievements a on a.key = pa.achievement_key
         where pa.passenger_id = p.id
       ), array[]::text[]) as achievements
from public.passengers p
join public.profiles pr on pr.id = p.user_id
where pr.is_listed
  and pr.moderation = 'ok'
  and pr.anonymised_at is null;

alter table public.train_status enable row level security;
alter table public.transmissions enable row level security;
alter table public.episodes enable row level security;
alter table public.archive_entries enable row level security;
alter table public.discoveries enable row level security;
alter table public.announcements enable row level security;
alter table public.achievements enable row level security;
alter table public.passenger_achievements enable row level security;
alter table public.stamps enable row level security;
alter table public.journey_events enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.votes enable row level security;
alter table public.products enable row level security;
alter table public.purchases enable row level security;
alter table public.submissions enable row level security;

create policy train_status_read on public.train_status for select to anon, authenticated using (true);
create policy transmissions_read on public.transmissions for select to anon, authenticated using (published);
create policy episodes_read on public.episodes for select to anon, authenticated using (published);
create policy archive_read on public.archive_entries for select to anon, authenticated using (published);
create policy discoveries_read on public.discoveries for select to anon, authenticated using (published);
create policy announcements_read on public.announcements for select to anon, authenticated using (active);
create policy achievements_read on public.achievements for select to anon, authenticated using (true);
create policy products_read on public.products for select to anon, authenticated using (true);
create policy polls_read on public.polls for select to anon, authenticated using (published);
create policy poll_options_read on public.poll_options for select to anon, authenticated
  using (exists (select 1 from public.polls poll where poll.id = poll_id and poll.published));
create policy votes_select_own on public.votes for select to authenticated using (user_id = auth.uid());
create policy journey_select_own on public.journey_events for select to authenticated
  using (exists (select 1 from public.passengers p where p.id = passenger_id and p.user_id = auth.uid()));
create policy stamps_select_own on public.stamps for select to authenticated
  using (exists (select 1 from public.passengers p where p.id = passenger_id and p.user_id = auth.uid()));
create policy earned_select_own on public.passenger_achievements for select to authenticated
  using (exists (select 1 from public.passengers p where p.id = passenger_id and p.user_id = auth.uid()));
create policy submissions_select_own on public.submissions for select to authenticated using (user_id = auth.uid());

revoke all on table public.train_status from anon, authenticated;
revoke all on table public.transmissions from anon, authenticated;
revoke all on table public.episodes from anon, authenticated;
revoke all on table public.archive_entries from anon, authenticated;
revoke all on table public.discoveries from anon, authenticated;
revoke all on table public.announcements from anon, authenticated;
revoke all on table public.achievements from anon, authenticated;
revoke all on table public.passenger_achievements from anon, authenticated;
revoke all on table public.stamps from anon, authenticated;
revoke all on table public.journey_events from anon, authenticated;
revoke all on table public.polls from anon, authenticated;
revoke all on table public.poll_options from anon, authenticated;
revoke all on table public.votes from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.purchases from anon, authenticated;
revoke all on table public.submissions from anon, authenticated;

grant select on public.train_status, public.transmissions, public.episodes, public.archive_entries,
  public.discoveries, public.announcements, public.achievements, public.polls, public.poll_options,
  public.products
  to anon, authenticated;
grant select on public.votes, public.journey_events, public.stamps, public.passenger_achievements, public.submissions
  to authenticated;
grant select on public.manifest to anon, authenticated;

revoke all on function public.cast_vote(uuid, uuid) from public;
revoke all on function public.poll_results(uuid) from public;
revoke all on function public.apply_paid_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid, uuid) to authenticated, service_role;
grant execute on function public.poll_results(uuid) to anon, authenticated, service_role;
grant execute on function public.apply_paid_entitlement(uuid) to service_role;

grant select, insert, update, delete on
  public.train_status, public.transmissions, public.episodes, public.archive_entries,
  public.discoveries, public.announcements, public.achievements, public.passenger_achievements,
  public.stamps, public.journey_events, public.polls, public.poll_options, public.votes,
  public.products, public.purchases, public.submissions
  to service_role;
grant select on public.manifest to service_role;

do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'nightline_app') then
    grant select, insert, update, delete on
      public.train_status, public.transmissions, public.episodes, public.archive_entries,
      public.discoveries, public.announcements, public.achievements, public.passenger_achievements,
      public.stamps, public.journey_events, public.polls, public.poll_options, public.votes,
      public.products, public.purchases, public.submissions
      to nightline_app;
    grant select on public.manifest to nightline_app;
    grant execute on function public.cast_vote(uuid, uuid) to nightline_app;
    grant execute on function public.poll_results(uuid) to nightline_app;
    grant execute on function public.apply_paid_entitlement(uuid) to nightline_app;
  end if;
end $$;
