-- RBAC overhaul, step 2 of 2: now that the enum values are renamed and
-- 'manager' exists (previous migration), rewrite every function/policy/
-- trigger that referenced the old role literals, and add the new Manager
-- tier's authorization logic.
--
-- Manager sits between Team Leader and Executive, scoped to ONE department
-- (never org-wide, unlike Team Leader who already had org-wide task
-- read/create rights from 20260721000003/20260721000005). Concretely,
-- Manager gets:
--   - task create/assign/edit/comment/attach, but only within their own
--     department, assignable only to Executives in that department
--   - inviting new Executives into their own department
--   - reviewing task-forward requests, scoped to their own department
-- and explicitly does NOT get: department resources write, personal-folder
-- oversight, org-wide directory/task visibility, task delete, or Settings.

-- ============================================================
-- profiles table: check constraint + RLS
-- ============================================================

alter table public.profiles drop constraint profiles_department_matches_role;
alter table public.profiles add constraint profiles_department_matches_role check (
  (role = 'org_super_admin' and department_id is null)
  or (role in ('team_leader', 'manager', 'executive') and department_id is not null)
);

create or replace function public.profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     or new.organization_id is distinct from old.organization_id
     or new.department_id is distinct from old.department_id
     or new.status is distinct from old.status
  then
    if public.current_role() <> 'org_super_admin' then
      raise exception 'Not authorized to change role, organization, department, or status.';
    end if;
  end if;
  return new;
end;
$$;

drop policy "admins and super admins read org directory" on public.profiles;
create policy "team leaders and org super admins read org directory"
  on public.profiles for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() in ('team_leader', 'org_super_admin')
  );

create policy "managers read own department profiles"
  on public.profiles for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() = 'manager'
    and department_id = public.current_department_id()
  );

drop policy "employees read own department profiles" on public.profiles;
create policy "executives read own department profiles"
  on public.profiles for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() = 'executive'
    and department_id = public.current_department_id()
  );

-- ============================================================
-- handle_new_invited_user(): rename literal + the column it claims
-- (organizations.super_admin_id -> org_super_admin_id, previous migration)
-- ============================================================

create or replace function public.handle_new_invited_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := new.raw_user_meta_data;
  v_role public.org_role;
  v_org uuid;
  v_dept uuid;
begin
  if meta ? 'invite_role' and meta ? 'organization_id' then
    v_role := (meta->>'invite_role')::public.org_role;
    v_org := (meta->>'organization_id')::uuid;
    v_dept := nullif(meta->>'department_id', '')::uuid;

    insert into public.profiles (id, organization_id, department_id, role, email, status)
    values (new.id, v_org, v_dept, v_role, new.email, 'active');

    if v_role = 'org_super_admin' then
      update public.organizations
      set org_super_admin_id = new.id
      where id = v_org and org_super_admin_id is null;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================
-- org_people_status(): Org Super Admin + Team Leader keep org-wide
-- visibility (unchanged); Manager is scoped to their own department.
-- ============================================================

create or replace function public.org_people_status()
returns table(
  profile_id uuid,
  email text,
  full_name text,
  username text,
  role public.org_role,
  department_id uuid,
  invited_at timestamptz,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.username, p.role, p.department_id, u.invited_at, u.confirmed_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_super_admin', 'team_leader')
      or (public.current_role() = 'manager' and p.department_id = public.current_department_id())
    )
  order by u.invited_at desc nulls last;
$$;

-- ============================================================
-- Tasks: can_access_task() (write-scope: comments/attachments/storage) and
-- can_view_task() (read-scope: task row + comment/attachment visibility)
-- both gain a Manager branch scoped to their own department.
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
        public.current_role() = 'org_super_admin'
        or (
          public.current_role() in ('team_leader', 'manager')
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
        public.current_role() in ('org_super_admin', 'team_leader')
        or (public.current_role() = 'manager' and t.department_id = public.current_department_id())
        or t.assigned_to = auth.uid()
        or t.created_by = auth.uid()
      )
  );
$$;

-- ============================================================
-- Tasks table RLS: read stays org-wide for Team Leader (unchanged), gains
-- a dept-scoped Manager branch. Create/update gain a dept-scoped Manager
-- branch that can only assign to Executives in the same department. Team
-- Leader's assignable set widens from Executive-only to Manager+Executive.
-- Delete is intentionally left Manager-less (Team Leader/Org Super Admin only).
-- ============================================================

drop policy "task viewers can read" on public.tasks;
create policy "task viewers can read"
  on public.tasks for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_super_admin', 'team_leader')
      or (public.current_role() = 'manager' and department_id = public.current_department_id())
      or assigned_to = auth.uid()
      or created_by = auth.uid()
    )
  );

drop policy "admins and super admins can create tasks in scope" on public.tasks;
create policy "leads can create tasks in scope"
  on public.tasks for insert
  to authenticated
  with check (
    organization_id = public.current_org_id()
    and created_by = auth.uid()
    and (
      public.current_role() = 'org_super_admin'
      or (
        public.current_role() = 'team_leader'
        and exists (select 1 from public.departments d where d.id = department_id and d.organization_id = public.current_org_id())
      )
      or (
        public.current_role() = 'manager'
        and department_id = public.current_department_id()
      )
    )
    and (
      assigned_to is null
      or exists (
        select 1 from public.profiles p
        where p.id = assigned_to
          and p.organization_id = public.current_org_id()
          and (
            public.current_role() = 'org_super_admin'
            or (public.current_role() = 'team_leader' and p.role in ('manager', 'executive'))
            or (public.current_role() = 'manager' and p.role = 'executive' and p.department_id = department_id)
          )
      )
    )
  );

drop policy "task viewers can update in scope" on public.tasks;
create policy "task viewers can update in scope"
  on public.tasks for update
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_super_admin', 'team_leader')
      or (public.current_role() = 'manager' and department_id = public.current_department_id())
      or assigned_to = auth.uid()
      or created_by = auth.uid()
    )
  )
  with check (
    organization_id = public.current_org_id()
    and (
      assigned_to is null
      or exists (
        select 1 from public.profiles p
        where p.id = assigned_to
          and p.organization_id = public.current_org_id()
          and (
            public.current_role() = 'org_super_admin'
            or (public.current_role() = 'team_leader' and p.role in ('manager', 'executive'))
            or (public.current_role() = 'manager' and p.role = 'executive' and p.department_id = department_id)
            or public.current_role() = 'executive'
          )
      )
    )
  );

drop policy "super admin or owning admin can delete tasks" on public.tasks;
create policy "org super admin or owning team leader can delete tasks"
  on public.tasks for delete
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() = 'org_super_admin'
      or (public.current_role() = 'team_leader' and department_id = public.current_department_id())
    )
  );

-- ============================================================
-- tasks_guard_update(): only Executive is field-restricted (status/blocked
-- only); Manager keeps full edit rights same as Team Leader.
-- ============================================================

create or replace function public.tasks_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() = 'executive' then
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.department_id is distinct from old.department_id
       or new.assigned_to is distinct from old.assigned_to
       or new.priority is distinct from old.priority
       or new.due_date is distinct from old.due_date
       or new.created_by is distinct from old.created_by
       or new.organization_id is distinct from old.organization_id
    then
      raise exception 'Executives can only update task status and the blocked flag.';
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================
-- Communication: literal rename only. Manager deliberately NOT added to the
-- "sees every department channel" branch -- falls through to the
-- department_id match, same as Executive.
-- ============================================================

create or replace function public.can_access_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = target_conversation_id
      and c.organization_id = public.current_org_id()
      and (
        c.type = 'announcement'
        or (
          c.type = 'department_channel'
          and (
            public.current_role() in ('org_super_admin', 'team_leader')
            or c.department_id = public.current_department_id()
          )
        )
        or (c.type = 'dm' and auth.uid() in (c.dm_profile_a, c.dm_profile_b))
      )
  );
$$;

drop policy "org members can read conversations they belong to" on public.conversations;
create policy "org members can read conversations they belong to"
  on public.conversations for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      type = 'announcement'
      or (
        type = 'department_channel'
        and (
          public.current_role() in ('org_super_admin', 'team_leader')
          or department_id = public.current_department_id()
        )
      )
      or (type = 'dm' and auth.uid() in (dm_profile_a, dm_profile_b))
    )
  );

drop policy "conversation members can post messages" on public.messages;
create policy "conversation members can post messages"
  on public.messages for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.can_access_conversation(conversation_id)
    and (
      (select type from public.conversations where id = conversation_id) <> 'announcement'
      or public.current_role() = 'org_super_admin'
    )
  );

-- ============================================================
-- Drive: personal folders (literal rename only, Manager NOT added -- no
-- personal-folder oversight per the chosen scope) and department resources
-- (literal rename only, write stays Org Super Admin + Team Leader only).
-- ============================================================

create or replace function public.can_access_personal_folder(owner_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner_profile_id is not null and (
    auth.uid() = owner_profile_id
    or (
      public.current_role() = 'org_super_admin'
      and exists (select 1 from public.profiles where id = owner_profile_id and organization_id = public.current_org_id())
    )
    or (
      public.current_role() = 'team_leader'
      and exists (
        select 1 from public.profiles
        where id = owner_profile_id
          and organization_id = public.current_org_id()
          and department_id = public.current_department_id()
      )
    )
  );
$$;

create or replace function public.can_read_department_resources(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_department_id is not null and exists (
    select 1 from public.departments d
    where d.id = target_department_id
      and d.organization_id = public.current_org_id()
      and (public.current_role() = 'org_super_admin' or d.id = public.current_department_id())
  );
$$;

create or replace function public.can_write_department_resources(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_department_id is not null and exists (
    select 1 from public.departments d
    where d.id = target_department_id
      and d.organization_id = public.current_org_id()
      and (
        public.current_role() = 'org_super_admin'
        or (public.current_role() = 'team_leader' and d.id = public.current_department_id())
      )
  );
$$;

-- ============================================================
-- org_storage_usage(): literal rename only (Org Super Admin only, unchanged).
-- ============================================================

create or replace function public.org_storage_usage()
returns table(total_bytes bigint, file_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'org_super_admin' then
    raise exception 'Only an Organization Super Admin can view storage usage.';
  end if;

  return query
  select
    coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as total_bytes,
    count(*)::bigint as file_count
  from storage.objects o
  where o.bucket_id = 'org-drive'
    and (string_to_array(o.name, '/'))[1] = public.current_org_id()::text;
end;
$$;

-- ============================================================
-- Task forward requests: requester side renamed to Executive; reviewer side
-- widened from "not Executive" to explicitly Manager/Team Leader/Org Super
-- Admin, with Manager's dept-scoped exists() check applying automatically
-- since it already scopes by the CALLER's own department for any non-super-
-- admin role.
-- ============================================================

drop policy "employee can request forward of own task" on public.task_forward_requests;
create policy "executive can request forward of own task"
  on public.task_forward_requests for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.current_role() = 'executive'
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.assigned_to = auth.uid()
        and t.organization_id = public.current_org_id()
    )
  );

drop policy "admin reads dept forward requests" on public.task_forward_requests;
create policy "leads read dept forward requests"
  on public.task_forward_requests for select
  to authenticated
  using (
    public.current_role() in ('team_leader', 'manager', 'org_super_admin')
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.organization_id = public.current_org_id()
        and (
          public.current_role() = 'org_super_admin'
          or t.department_id = public.current_department_id()
        )
    )
  );

drop policy "admin can update forward requests" on public.task_forward_requests;
create policy "leads can update forward requests"
  on public.task_forward_requests for update
  to authenticated
  using (
    public.current_role() in ('team_leader', 'manager', 'org_super_admin')
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.organization_id = public.current_org_id()
        and (
          public.current_role() = 'org_super_admin'
          or t.department_id = public.current_department_id()
        )
    )
  )
  with check (
    reviewed_by = auth.uid()
  );

-- ============================================================
-- Notifications: rename column/literal references; Managers now also hear
-- about new joiners in their own department (Team Leader already did).
-- ============================================================

create or replace function public.notify_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_super_admin_profile uuid;
  joined_label text;
begin
  if new.email is null then
    return new;
  end if;

  joined_label := coalesce(new.username, new.full_name, new.email);

  select org_super_admin_id into org_super_admin_profile from public.organizations where id = new.organization_id;
  if org_super_admin_profile is not null and org_super_admin_profile <> new.id then
    insert into public.notifications (profile_id, type, title, body, link)
    values (org_super_admin_profile, 'member_joined', joined_label || ' joined your organization', new.role::text, '/admin/people');
  end if;

  if new.department_id is not null then
    insert into public.notifications (profile_id, type, title, body, link)
    select p.id, 'member_joined', joined_label || ' joined your department', new.role::text, '/admin/departments/' || new.department_id
    from public.profiles p
    where p.organization_id = new.organization_id
      and p.department_id = new.department_id
      and p.role in ('team_leader', 'manager')
      and p.id <> new.id;
  end if;

  return new;
end;
$$;

create or replace function public.notify_file_uploaded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  path_parts text[];
  org_id uuid;
  uploader_id uuid := new.owner_id;
  uploader_label text;
  dept_id uuid;
  dept_name text;
  owner_profile_id uuid;
  file_name text;
begin
  if new.bucket_id <> 'org-drive' then
    return new;
  end if;

  path_parts := string_to_array(new.name, '/');
  org_id := public.try_parse_uuid(path_parts[1]);
  if org_id is null then
    return new;
  end if;
  file_name := path_parts[array_length(path_parts, 1)];

  select coalesce(username, full_name, email) into uploader_label from public.profiles where id = uploader_id;
  uploader_label := coalesce(uploader_label, 'Someone');

  if path_parts[3] = 'resources' then
    dept_id := public.try_parse_uuid(path_parts[2]);
    if dept_id is null then
      return new;
    end if;
    select name into dept_name from public.departments where id = dept_id;

    insert into public.notifications (profile_id, type, title, body, link)
    select p.id, 'file_uploaded', uploader_label || ' uploaded a file to ' || coalesce(dept_name, 'a department'), file_name, '/drive/departments/' || dept_id
    from public.profiles p
    where p.organization_id = org_id
      and (uploader_id is null or p.id <> uploader_id)
      and (p.role = 'org_super_admin' or p.department_id = dept_id);

  elsif path_parts[2] = 'personal' then
    owner_profile_id := public.try_parse_uuid(path_parts[3]);
    if owner_profile_id is null or owner_profile_id = uploader_id then
      return new;
    end if;

    insert into public.notifications (profile_id, type, title, body, link)
    values (owner_profile_id, 'file_uploaded', uploader_label || ' added a file to your personal folder', file_name, '/drive/personal/' || owner_profile_id);
  end if;

  return new;
end;
$$;

create or replace function public.notify_department_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (profile_id, type, title, body, link)
  select p.id, 'department_created', 'New department: ' || new.name, null, '/admin/departments/' || new.id
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.role = 'team_leader';
  return new;
end;
$$;
