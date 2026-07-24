-- Extends Supabase Realtime beyond messages/reactions/notifications/
-- task_forward_requests (already live) to the other tables whose changes
-- should show up for other viewers without a manual refresh: tasks,
-- departments, profiles, task_comments, task_attachments. Realtime still
-- applies each table's existing RLS policies to every subscriber, so this
-- only turns on delivery -- it doesn't widen who can see what.

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.departments;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.task_comments;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.task_attachments;
exception when duplicate_object then null;
end;
$$;
