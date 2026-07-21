-- DeskCulture: notify a person when they're assigned (or reassigned) a
-- task. Previously the only notifications were @mentions and DMs -- being
-- assigned a task never told the assignee anything, so they'd only find
-- out by happening to check their board.

alter type public.notification_type add value if not exists 'task_assigned';

create or replace function public.notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
begin
  if new.assigned_to is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  if new.assigned_to = auth.uid() then
    return new;
  end if;

  select coalesce(username, full_name, email) into actor_name from public.profiles where id = auth.uid();

  insert into public.notifications (profile_id, type, title, body, link)
  values (
    new.assigned_to,
    'task_assigned',
    coalesce(actor_name, 'Someone') || ' assigned you a task',
    left(new.title, 140),
    '/tasks/' || new.id
  );

  return new;
end;
$$;

create trigger tasks_notify_assignment
  after insert or update on public.tasks
  for each row execute function public.notify_task_assignment();
