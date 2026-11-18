-- Optional Manychat claim integration. Provider identifiers stay namespaced and distinct.
create table public.messaging_identities (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider text not null check (provider = 'manychat'),
  provider_contact_id text not null,
  instagram_scoped_id text,
  current_username text not null check (current_username ~ '^[a-z0-9._]{1,30}$'),
  passenger_id uuid not null references public.passengers(id),
  first_claimed_at timestamptz not null default pg_catalog.now(),
  last_seen_at timestamptz not null default pg_catalog.now(),
  unique (provider, provider_contact_id),
  unique (provider, instagram_scoped_id),
  unique (provider, passenger_id)
);
create table public.passenger_ticket_access (
  passenger_id uuid primary key references public.passengers(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  revoked_at timestamptz
);
create table public.messaging_claim_attempts (
  id bigint generated always as identity primary key,
  provider text not null,
  status text not null check (status in ('claimed','already_claimed','not_found','conflict','invalid','rate_limited')),
  username text,
  occurred_at timestamptz not null default pg_catalog.now()
);
create index messaging_claim_attempts_recent_idx on public.messaging_claim_attempts(occurred_at desc);
alter table public.messaging_identities enable row level security;
alter table public.passenger_ticket_access enable row level security;
alter table public.messaging_claim_attempts enable row level security;
revoke all on public.messaging_identities,public.passenger_ticket_access,public.messaging_claim_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.messaging_identities,public.passenger_ticket_access,public.messaging_claim_attempts to service_role;
grant usage,select on sequence public.messaging_claim_attempts_id_seq to service_role;
do $$ begin
  if exists(select 1 from pg_catalog.pg_roles where rolname='nightline_app') then
    execute 'grant select,insert,update,delete on public.messaging_identities,public.passenger_ticket_access,public.messaging_claim_attempts to nightline_app';
    execute 'grant usage,select on sequence public.messaging_claim_attempts_id_seq to nightline_app';
  end if;
end $$;
