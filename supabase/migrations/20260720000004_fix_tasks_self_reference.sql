-- 20260720000002's SELECT/UPDATE/DELETE policies on public.tasks used
-- can_access_task(id), which self-references public.tasks from inside a
-- policy on public.tasks. That's fine for plain reads, but during
-- INSERT ... RETURNING, Postgres evaluates the SELECT policy against the
-- just-inserted row, and can_access_task's internal "select from tasks
-- where id = ..." can't see that row yet within the same command --
-- causing a spurious "new row violates row-level security policy" error
-- whenever a caller requests the row back after insert (return=representation
-- / supabase-js's `.insert().select()`). The app itself never chains
-- `.select()` after `.insert()` for tasks, so this never surfaced in the
-- UI, but it's a landmine for any future code that does.
--
-- Fix: give public.tasks its own policies that check the row's columns
-- directly (same logic as can_access_task, inlined) instead of going
-- through a function that re-queries the table. can_access_task() itself
-- is kept as-is and remains correct for task_comments/task_attachments,
-- whose policies reference public.tasks -- a different, already-committed
-- table from their own insert's perspective, so no self-reference issue
-- there.

drop policy "task viewers can read" on public.tasks;
drop policy "task viewers can update in scope" on public.tasks;
drop policy "super admin or owning admin can delete tasks" on public.tasks;

create policy "task viewers can read"
  on public.tasks for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() = 'super_admin'
      or (
        public.current_role() = 'admin'
        and (
          department_id = public.current_department_id()
          or assigned_to in (select id from public.profiles where department_id = public.current_department_id())
        )
      )
      or assigned_to = auth.uid()
      or created_by = auth.uid()
    )
  );

create policy "task viewers can update in scope"
  on public.tasks for update
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() = 'super_admin'
      or (
        public.current_role() = 'admin'
        and (
          department_id = public.current_department_id()
          or assigned_to in (select id from public.profiles where department_id = public.current_department_id())
        )
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

drop function public.debug_task_insert_check(uuid, uuid, uuid, uuid);
