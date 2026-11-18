-- Remove inherited Supabase default grants from sensitive objects that are not
-- revoked by the earlier object-specific migrations.
revoke all on public.schema_migrations from public, anon, authenticated;
revoke all on public.username_lookup_rate_limits from public, anon, authenticated;
alter table public.username_lookup_rate_limits enable row level security;

-- The public view only needs SELECT for the browser roles. In particular, do
-- not retain PostgreSQL's default REFERENCES, TRIGGER or TRUNCATE privileges.
revoke all on public.manifest from public, anon, authenticated;
grant select on public.manifest to anon, authenticated, service_role;

-- The identity guard is a trigger-only function. Journey-day calculation is an
-- internal service function and already has an explicit service_role grant.
revoke all on function public.guard_passenger_identity() from public, anon, authenticated;
revoke all on function public.journey_day_for(timestamptz) from public, anon, authenticated;
grant execute on function public.journey_day_for(timestamptz) to service_role;
