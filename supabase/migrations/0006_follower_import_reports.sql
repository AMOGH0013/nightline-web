-- Immutable per-import snapshots power auditable downloads after preview rows are cleared.
create table public.follower_import_records (
  import_id uuid not null references public.follower_manifest_imports(id) on delete cascade,
  normalized_username text not null check (normalized_username ~ '^[a-z0-9._]{1,30}$'),
  passenger_id uuid not null references public.passengers(id),
  followed_at timestamptz,
  source_order integer not null default 0 check (source_order >= 0),
  follower_rank bigint not null,
  permanent_number bigint not null,
  original_entitlement text not null,
  assignment_status text not null check (assignment_status in ('new','existing','late_review')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (import_id,normalized_username),
  unique (import_id,passenger_id)
);
alter table public.follower_import_records enable row level security;
revoke all on public.follower_import_records from public,anon,authenticated;
grant select,insert,update,delete on public.follower_import_records to service_role;
do $$ begin
  if exists(select 1 from pg_catalog.pg_roles where rolname='nightline_app') then
    execute 'grant select,insert,update,delete on public.follower_import_records to nightline_app';
  end if;
end $$;
