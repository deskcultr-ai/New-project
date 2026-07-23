-- Task permission refinements on top of the 4-tier RBAC rename:
--   1. Manager's task/people scope moves from "own department" to a real
--      Manager -> Executive assignment (profiles.manager_id) -- two Managers
--      in the same department can now own non-overlapping sets of Executives.
--   2. Task deletion is locked down to Organization Super Admin only (Team
--      Leader's delete right is revoked). No UI ever exposed task deletion,
--      so this is a pure DB-level tightening.
--   3. Executive can create tasks for themselves (self-assigned only) and
--      gets full edit rights (title/description/priority/due_date) on
--      tasks they created -- tasks assigned to them by someone else stay
--      status/blocked-only, as before.

-- ============================================================
-- Step 1: profiles.manager_id column + constraint
-- ============================================================

alter table public.profiles add column manager_id uuid references public.profiles(id) on delete set null;

alter table public.profiles add constraint profiles_manager_id_only_for_executive
  check (manager_id is null or role = 'executive');

create index profiles_manager_id_idx on public.profiles (manager_id);

-- ============================================================
-- Step 2: one-time backfill, BEFORE the guard trigger below starts
-- validating manager_id -- the currently-deployed profiles_guard_update()
-- doesn't know about manager_id yet, so this plain bulk UPDATE passes
-- through untouched. Departments with exactly one Manager get their
-- existing Executives auto-assigned to that Manager; departments with zero
-- or multiple Managers are left null (ambiguous -- resolved by a human via
-- the new /admin/people "Manager" picker after this ships).
-- ============================================================

update public.profiles e
set manager_id = m.id
from public.profiles m
where e.role = 'executive'
  and e.manager_id is null
  and m.role = 'manager'
  and m.department_id = e.department_id
  and (
    select count(*) from public.profiles m2
    where m2.role = 'manager' and m2.department_id = e.department_id
  ) = 1;

-- ============================================================
-- Step 3: profiles_guard_update() now also guards manager_id -- separate
-- from the existing role/org/department/status guard (still Org Super
-- Admin-only): a Team Leader may change it for someone in their OWN
-- department, Org Super Admin for anyone. Also validates the new value
-- actually points at a Manager in the same department -- the backstop
-- against bad writes from any code path, not just the RPC in step 4.
-- ============================================================

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

  if new.manager_id is distinct from old.manager_id then
    if not (
      public.current_role() = 'org_super_admin'
      or (public.current_role() = 'team_leader' and new.department_id = public.current_department_id())
    ) then
      raise exception 'Only a Team Leader (own department) or Organization Super Admin can change manager_id.';
    end if;

    if new.manager_id is not null and not exists (
      select 1 from public.profiles m
      where m.id = new.manager_id
        and m.role = 'manager'
        and m.department_id = new.department_id
        and m.organization_id = new.organization_id
    ) then
      raise exception 'manager_id must reference a Manager in the same department.';
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- Step 3b: handle_new_invited_user() reads the new optional manager_id
-- out of invite metadata (set by /api/invites when a Manager invites an
-- Executive, or a Team Leader picks one) and sets it on the new profile.
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
  v_manager uuid;
begin
  if meta ? 'invite_role' and meta ? 'organization_id' then
    v_role := (meta->>'invite_role')::public.org_role;
    v_org := (meta->>'organization_id')::uuid;
    v_dept := nullif(meta->>'department_id', '')::uuid;
    v_manager := nullif(meta->>'manager_id', '')::uuid;

    insert into public.profiles (id, organization_id, department_id, role, email, status, manager_id)
    values (new.id, v_org, v_dept, v_role, new.email, 'active', v_manager);

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
-- Step 4: assign_executive_manager() -- SECURITY DEFINER RPC used by
-- Team Leader (own dept) / Org Super Admin (any dept) from /admin/people
-- to (re)assign or clear an Executive's Manager. Still passes through the
-- guard trigger above as a second layer.
-- ============================================================

create or replace function public.assign_executive_manager(p_executive_id uuid, p_manager_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.org_role := public.current_role();
  caller_dept uuid := public.current_department_id();
  target_org uuid;
  target_dept uuid;
  target_role public.org_role;
begin
  select organization_id, department_id, role into target_org, target_dept, target_role
  from public.profiles where id = p_executive_id;

  if target_org is null or target_org <> public.current_org_id() or target_role <> 'executive' then
    raise exception 'Target must be an executive in your organization.';
  end if;

  if caller_role = 'org_super_admin' then
    null;
  elsif caller_role = 'team_leader' and target_dept = caller_dept then
    null;
  else
    raise exception 'Only a Team Leader (own department) or Organization Super Admin can reassign a Manager.';
  end if;

  if p_manager_id is not null and not exists (
    select 1 from public.profiles m
    where m.id = p_manager_id
      and m.role = 'manager'
      and m.department_id = target_dept
      and m.organization_id = target_org
  ) then
    raise exception 'The new manager must be a Manager in the same department as the executive.';
  end if;

  update public.profiles set manager_id = p_manager_id where id = p_executive_id;
end;
$$;

grant execute on function public.assign_executive_manager(uuid, uuid) to authenticated;

-- ============================================================
-- Step 5: org_people_status() + the "managers read ..." profiles policy --
-- Manager's scope moves from department to assignment.
-- ============================================================

-- CREATE OR REPLACE can't change a function's RETURNS TABLE signature
-- (adding manager_id here) -- drop first.
drop function if exists public.org_people_status();

create function public.org_people_status()
returns table(
  profile_id uuid,
  email text,
  full_name text,
  username text,
  role public.org_role,
  department_id uuid,
  manager_id uuid,
  invited_at timestamptz,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.username, p.role, p.department_id, p.manager_id, u.invited_at, u.confirmed_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_super_admin', 'team_leader')
      or (public.current_role() = 'manager' and p.manager_id = auth.uid())
    )
  order by u.invited_at desc nulls last;
$$;

-- DROP FUNCTION drops the previous grant along with the old function OID --
-- re-grant on the freshly created one.
grant execute on function public.org_people_status() to authenticated;

drop policy "managers read own department profiles" on public.profiles;
create policy "managers read their assigned executives"
  on public.profiles for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() = 'manager'
    and manager_id = auth.uid()
  );

-- ============================================================
-- Step 6: can_access_task() / can_view_task() -- Manager's branch moves
-- from department to assignment. Team Leader's branches are untouched
-- (can_access_task's dept-scoped write branch is a pre-existing, separate
-- design from before the RBAC rename -- not part of this change).
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
          public.current_role() = 'team_leader'
          and (
            t.department_id = public.current_department_id()
            or t.assigned_to in (
              select id from public.profiles where department_id = public.current_department_id()
            )
          )
        )
        or (
          public.current_role() = 'manager'
          and t.assigned_to in (select id from public.profiles where manager_id = auth.uid())
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
        or (
          public.current_role() = 'manager'
          and t.assigned_to in (select id from public.profiles where manager_id = auth.uid())
        )
        or t.assigned_to = auth.uid()
        or t.created_by = auth.uid()
      )
  );
$$;

-- ============================================================
-- Step 7: tasks table RLS -- read/insert/update rewritten for Manager's
-- assignment-based scope, Executive's new self-create right, and the
-- delete lockdown to Org Super Admin only.
-- ============================================================

drop policy "task viewers can read" on public.tasks;
create policy "task viewers can read"
  on public.tasks for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('org_super_admin', 'team_leader')
      or (
        public.current_role() = 'manager'
        and assigned_to in (select id from public.profiles where manager_id = auth.uid())
      )
      or assigned_to = auth.uid()
      or created_by = auth.uid()
    )
  );

drop policy "leads can create tasks in scope" on public.tasks;
create policy "leads and executives can create tasks in scope"
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
      or (
        public.current_role() = 'executive'
        and department_id = public.current_department_id()
      )
    )
    and (
      assigned_to is null
      or (public.current_role() = 'executive' and assigned_to = auth.uid())
      or exists (
        select 1 from public.profiles p
        where p.id = assigned_to
          and p.organization_id = public.current_org_id()
          and (
            public.current_role() = 'org_super_admin'
            or (public.current_role() = 'team_leader' and p.role in ('manager', 'executive'))
            or (public.current_role() = 'manager' and p.role = 'executive' and p.manager_id = auth.uid())
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
      or (
        public.current_role() = 'manager'
        and assigned_to in (select id from public.profiles where manager_id = auth.uid())
      )
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
            or (public.current_role() = 'manager' and p.role = 'executive' and p.manager_id = auth.uid())
            or public.current_role() = 'executive'
          )
      )
    )
  );

drop policy "org super admin or owning team leader can delete tasks" on public.tasks;
create policy "only org super admin can delete tasks"
  on public.tasks for delete
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() = 'org_super_admin'
  );

-- ============================================================
-- Step 8: tasks_guard_update() -- structural fields (department/assignee/
-- creator/organization) stay permanently locked for Executives regardless
-- of who created the task. Title/description/priority/due_date become
-- editable when the Executive is the task's creator (a self-task);
-- otherwise it's status/blocked-only, exactly as before.
-- ============================================================

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
      then
        raise exception 'Executives can only update status and the blocked flag on tasks assigned to them by someone else.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================
-- Step 9: task_forward_requests -- Manager's review scope moves from
-- department to assignment. Team Leader's department-scoped visibility in
-- this specific policy is a pre-existing quirk from before the RBAC
-- rename (Team Leader is org-wide everywhere else in tasks) -- left as-is,
-- not part of this change.
-- ============================================================

drop policy "leads read dept forward requests" on public.task_forward_requests;
create policy "leads read forward requests in scope"
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
          or (public.current_role() = 'team_leader' and t.department_id = public.current_department_id())
          or (public.current_role() = 'manager' and t.assigned_to in (select id from public.profiles where manager_id = auth.uid()))
        )
    )
  );

drop policy "leads can update forward requests" on public.task_forward_requests;
create policy "leads can update forward requests in scope"
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
          or (public.current_role() = 'team_leader' and t.department_id = public.current_department_id())
          or (public.current_role() = 'manager' and t.assigned_to in (select id from public.profiles where manager_id = auth.uid()))
        )
    )
  )
  with check (
    reviewed_by = auth.uid()
  );
