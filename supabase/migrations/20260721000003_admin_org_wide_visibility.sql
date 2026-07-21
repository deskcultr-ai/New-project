-- DeskCulture: Admins can now VIEW every department and its people/tasks
-- org-wide (matching the department-detail page), not just their own dept.
-- Write/manage rights (create tasks, invite people, edit departments) stay
-- scoped to the admin's own department -- only read visibility widens here,
-- mirroring the same admin-sees-everything pattern already applied to
-- profiles (tasks migration) and chat (fix_admin_chat_rls migration).

-- ============================================================
-- Step 1: tasks -- admin can read tasks in any department, not just their own.
-- ============================================================

drop policy "task viewers can read" on public.tasks;

create policy "task viewers can read"
  on public.tasks for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('super_admin', 'admin')
      or assigned_to = auth.uid()
      or created_by = auth.uid()
    )
  );

-- ============================================================
-- Step 2: org_people_status() -- admin sees the full org directory,
-- matching the org-wide profiles read policy admins already have.
-- ============================================================

create or replace function public.org_people_status()
returns table(
  profile_id uuid,
  email text,
  full_name text,
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
  select p.id, p.email, p.full_name, p.role, p.department_id, u.invited_at, u.confirmed_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.organization_id = public.current_org_id()
    and public.current_role() in ('super_admin', 'admin')
  order by u.invited_at desc nulls last;
$$;
