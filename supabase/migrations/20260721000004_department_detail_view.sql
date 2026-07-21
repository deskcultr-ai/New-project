-- DeskCulture: support for the department detail page.
-- 1. Admins can now READ comments/attachments on tasks org-wide (matching
--    the tasks-table widening in 20260721000003), via a new can_view_task()
--    that's separate from can_access_task() -- posting comments/uploading
--    attachments stays dept-scoped (can_access_task is untouched), so this
--    only widens visibility, not write access.
-- 2. activity_logs gets a real department_id column so department-scoped
--    "recent activity" can be a plain equality filter instead of a fragile
--    client-side heuristic matching on titles/names.

-- ============================================================
-- Step 1: can_view_task() + widen comment/attachment SELECT policies
-- ============================================================

create or replace function public.can_view_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task_id
      and t.organization_id = public.current_org_id()
      and (
        public.current_role() in ('super_admin', 'admin')
        or t.assigned_to = auth.uid()
        or t.created_by = auth.uid()
      )
  );
$$;

grant execute on function public.can_view_task(uuid) to authenticated;

drop policy "task viewers can read comments" on public.task_comments;
create policy "task viewers can read comments"
  on public.task_comments for select
  to authenticated
  using (public.can_view_task(task_id));

drop policy "task viewers can read attachments" on public.task_attachments;
create policy "task viewers can read attachments"
  on public.task_attachments for select
  to authenticated
  using (public.can_view_task(task_id));

-- ============================================================
-- Step 2: activity_logs.department_id
-- ============================================================

alter table public.activity_logs
  add column if not exists department_id uuid references public.departments(id) on delete set null;

create index if not exists activity_logs_department_id_idx on public.activity_logs (department_id);

create or replace function public.log_department_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs (organization_id, department_id, actor_id, action, details)
  values (new.organization_id, new.id, auth.uid(), 'department.created', jsonb_build_object('name', new.name));
  return new;
end;
$$;

create or replace function public.log_task_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (organization_id, department_id, actor_id, action, details)
    values (new.organization_id, new.department_id, new.created_by, 'task.created', jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    if new.status = 'done' and old.status <> 'done' then
      insert into public.activity_logs (organization_id, department_id, actor_id, action, details)
      values (new.organization_id, new.department_id, auth.uid(), 'task.completed', jsonb_build_object('title', new.title));
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.log_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null then
    insert into public.activity_logs (organization_id, department_id, actor_id, action, details)
    values (new.organization_id, new.department_id, new.id, 'member.joined', jsonb_build_object('email', new.email, 'role', new.role, 'full_name', new.full_name));
  end if;
  return new;
end;
$$;
