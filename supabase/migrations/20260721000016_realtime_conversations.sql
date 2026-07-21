-- DeskCulture: the Messages sidebar (conversation list + unread badges)
-- had no realtime subscription at all -- it only loaded once on mount, so
-- a new message anywhere, or a new DM someone else started with you,
-- never showed up without a manual page reload. conversations needs to be
-- on the realtime publication so the sidebar can react to a brand new DM.

do $$ begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
