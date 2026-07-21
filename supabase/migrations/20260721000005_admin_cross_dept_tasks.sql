-- DeskCulture: Admins can now create and reassign tasks in ANY department
-- (not just their own), and assign to any employee org-wide. Previously
-- admins could only file/manage tasks within their own department.

drop policy "admins and super admins can create tasks in scope" on public.tasks;

create policy "admins and super admins can create tasks in scope"
  on public.tasks for insert
  to authenticated
  with check (
    organization_id = public.current_org_id()
    and created_by = auth.uid()
    and (
      public.current_role() = 'super_admin'
      or (
        public.current_role() = 'admin'
        and exists (select 1 from public.departments d where d.id = department_id and d.organization_id = public.current_org_id())
      )
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

drop policy "task viewers can update in scope" on public.tasks;

create policy "task viewers can update in scope"
  on public.tasks for update
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() in ('super_admin', 'admin')
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
            public.current_role() = 'super_admin'
            or (public.current_role() = 'admin' and p.role = 'employee')
            or public.current_role() = 'employee'
          )
      )
    )
  );
