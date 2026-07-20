-- DeskCulture: reset the live Supabase project's public schema.
-- Project: afsksxyryvxjaftblufv (deskcultr-ai's Project)
--
-- Run this yourself in the Supabase Dashboard -> SQL Editor. It is
-- IRREVERSIBLE: it drops every table, function, trigger, and type that
-- DeskCultre-main's migrations created (companies, profiles, departments,
-- tasks, chat, drive, attendance, etc.), including the handle_new_user
-- trigger on auth.users (it will be cascade-dropped since it depends on a
-- function in public).
--
-- auth.users itself (real invited accounts) is NOT touched by this script.

drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

-- Optional: also remove the "drive" storage bucket + its files from the old
-- Org Drive feature. Uncomment only if you want those files gone too.
-- delete from storage.objects where bucket_id = 'drive';
-- delete from storage.buckets where id = 'drive';
