-- reset-live-db.sql dropped and recreated the public schema, which wiped
-- Supabase's standard role grants and default privileges on it. Without
-- these, PostgREST gets a bare permission-denied (42501) before RLS is
-- even evaluated. Restore Supabase's stock setup: broad table-level grants
-- to anon/authenticated, with RLS policies (already in place) as the real
-- access gate underneath.

grant usage on schema public to postgres, anon, authenticated, service_role;

grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all functions in schema public to postgres, service_role;

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
