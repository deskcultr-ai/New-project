-- Task Type: label-only "One-time" vs "Daily Recurring" classification on
-- tasks. No automation -- nothing regenerates or resets on a schedule, it's
-- purely descriptive metadata, so it rides along with the same permission
-- rules as priority/due_date/title/description.

create type public.task_type as enum ('one_time', 'daily_recurring');

alter table public.tasks add column task_type public.task_type not null default 'one_time';

-- tasks_guard_update() (last defined in 20260723000002_task_permission_refinements.sql):
-- add task_type to the Executive self-created-task carve-out, same
-- treatment as title/description/priority/due_date.

create or replace function public.tasks_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() = 'executive' then
    if new.department_id is distinct from old.department_id
       or new.assigned_to is distinct from old.assigned_to
       or new.created_by is distinct from old.created_by
       or new.organization_id is distinct from old.organization_id
    then
      raise exception 'Executives cannot change task department, assignee, creator, or organization.';
    end if;

    if old.created_by is distinct from auth.uid() then
      if new.title is distinct from old.title
         or new.description is distinct from old.description
         or new.priority is distinct from old.priority
         or new.due_date is distinct from old.due_date
         or new.task_type is distinct from old.task_type
      then
        raise exception 'Executives can only update status and the blocked flag on tasks assigned to them by someone else.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
