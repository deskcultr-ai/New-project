-- DeskCulture: task management core.
-- All task/comment/attachment access is enforced purely by RLS (plus one
-- guard trigger for field-level restrictions RLS can't express) -- no
-- service-role bypass is used anywhere in this migration's application
-- code, unlike the invite-accept flow which had no authenticated caller yet.

-- ============================================================
-- Directory-read fix (PRD 6: Admins need an org-wide employee picker to
-- assign tasks cross-department; step 1's RLS only allowed own-dept reads).
-- ============================================================

drop policy "super admin reads org profiles" on public.profiles;
drop policy "admin reads own department profiles" on public.profiles;

create policy "admins and super admins read org directory"
  on public.profiles for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() in ('admin', 'super_admin')
  );

create policy "employees read own department profiles"
  on public.profiles for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() = 'employee'
    and department_id = public.current_department_id()
  );

-- ============================================================
-- Enums
-- ============================================================

create type public.task_status as enum ('todo', 'in_progress', 'in_review', 'done');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

-- ============================================================
-- Tables
-- ============================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Every task files under one department's board/Drive folder, even when
  -- Super-Admin-created and assigned cross-department -- see PRD 9.1.
  -- No ON DELETE cascade/set null: a department with tasks on it can't be
  -- deleted, same as it already can't be deleted while it has members.
  department_id uuid not null references public.departments(id),
  title text not null,
  description text,
  status public.task_status not null default 'todo',
  is_blocked boolean not null default false,
  priority public.task_priority not null default 'medium',
  due_date date,
  created_by uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  file_name text not null,
  file_size bigint not null,
  content_type text,
  created_at timestamptz not null default now()
);

create index tasks_organization_id_idx on public.tasks (organization_id);
create index tasks_department_id_idx on public.tasks (department_id);
create index tasks_assigned_to_idx on public.tasks (assigned_to);
create index task_comments_task_id_idx on public.task_comments (task_id);
create index task_attachments_task_id_idx on public.task_attachments (task_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- Helper: can the current user see/act on this task?
-- ============================================================

create or replace function public.can_access_task(target_task_id uuid)
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
        public.current_role() = 'super_admin'
        or (
          public.current_role() = 'admin'
          and (
            t.department_id = public.current_department_id()
            or t.assigned_to in (
              select id from public.profiles where department_id = public.current_department_id()
            )
          )
        )
        or t.assigned_to = auth.uid()
        or t.created_by = auth.uid()
      )
  );
$$;

grant execute on function public.can_access_task(uuid) to authenticated;

-- ============================================================
-- Guard trigger: an employee may only change status/is_blocked on a task,
-- never reassign/retitle/reschedule it. RLS's USING clause can't express
-- per-field rules, so this closes that gap at the DB level.
-- ============================================================

create or replace function public.tasks_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() = 'employee' then
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.department_id is distinct from old.department_id
       or new.assigned_to is distinct from old.assigned_to
       or new.priority is distinct from old.priority
       or new.due_date is distinct from old.due_date
       or new.created_by is distinct from old.created_by
       or new.organization_id is distinct from old.organization_id
    then
      raise exception 'Employees can only update task status and the blocked flag.';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_guard_update_trigger
  before update on public.tasks
  for each row
  execute function public.tasks_guard_update();

-- ============================================================
-- Row Level Security: tasks
-- ============================================================

alter table public.tasks enable row level security;

create policy "task viewers can read"
  on public.tasks for select
  to authenticated
  using (public.can_access_task(id));

create policy "admins and super admins can create tasks in scope"
  on public.tasks for insert
  to authenticated
  with check (
    organization_id = public.current_org_id()
    and created_by = auth.uid()
    and (
      public.current_role() = 'super_admin'
      or (public.current_role() = 'admin' and department_id = public.current_department_id())
    )
    and (
      assigned_to is null
      or exists (
        select 1 from public.profiles p
        where p.id = assigned_to
          and p.organization_id = public.current_org_id()
          and (
            public.current_role() = 'super_admin'
            or (public.current_role() = 'admin' and p.role = 'employee')
          )
      )
    )
  );

create policy "task viewers can update in scope"
  on public.tasks for update
  to authenticated
  using (public.can_access_task(id))
  with check (
    organization_id = public.current_org_id()
    and (
      assigned_to is null
      or exists (
        select 1 from public.profiles p
        where p.id = assigned_to
          and p.organization_id = public.current_org_id()
          and (
            public.current_role() = 'super_admin'
            or (public.current_role() = 'admin' and p.role = 'employee')
            or public.current_role() = 'employee'
          )
      )
    )
  );

create policy "super admin or owning admin can delete tasks"
  on public.tasks for delete
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() = 'super_admin'
      or (public.current_role() = 'admin' and department_id = public.current_department_id())
    )
  );

-- ============================================================
-- Row Level Security: task_comments / task_attachments
-- ============================================================

alter table public.task_comments enable row level security;

create policy "task viewers can read comments"
  on public.task_comments for select
  to authenticated
  using (public.can_access_task(task_id));

create policy "task viewers can add comments"
  on public.task_comments for insert
  to authenticated
  with check (author_id = auth.uid() and public.can_access_task(task_id));

alter table public.task_attachments enable row level security;

create policy "task viewers can read attachments"
  on public.task_attachments for select
  to authenticated
  using (public.can_access_task(task_id));

create policy "task viewers can add attachments"
  on public.task_attachments for insert
  to authenticated
  with check (uploaded_by = auth.uid() and public.can_access_task(task_id));

-- ============================================================
-- Storage: one private bucket for task attachments, shared with the
-- future Org Drive browsing UI. Path convention:
-- {organization_id}/{department_id}/tasks/{task_id}/{filename}
-- ============================================================

insert into storage.buckets (id, name, public)
values ('org-drive', 'org-drive', false)
on conflict (id) do nothing;

create policy "task attachment read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-drive'
    and public.can_access_task(((string_to_array(name, '/'))[4])::uuid)
  );

create policy "task attachment upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-drive'
    and public.can_access_task(((string_to_array(name, '/'))[4])::uuid)
  );
