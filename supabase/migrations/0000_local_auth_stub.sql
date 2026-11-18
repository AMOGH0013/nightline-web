-- LOCAL POSTGRES ONLY. Do not run this against a Supabase project.
-- Supabase already provides auth.users, auth.uid(), and the anon / authenticated / service_role roles.
-- This stub lets the same migrations and security tests run on plain PostgreSQL 16.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default pg_catalog.now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
$$;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role nightline_app login bypassrls;
exception when duplicate_object then null;
end $$;

revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role, nightline_app;
revoke all on table auth.users from public, anon, authenticated;
grant select, insert, update, delete on table auth.users to nightline_app, service_role;

-- Dev-only one-time codes. Production email OTP is Supabase Auth, not this table.
create table if not exists public.local_login_codes (
  email text primary key,
  code text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now()
);
revoke all on table public.local_login_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.local_login_codes to nightline_app;
