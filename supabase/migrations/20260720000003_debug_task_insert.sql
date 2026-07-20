create or replace function public.debug_task_insert_check(
  p_organization_id uuid, p_department_id uuid, p_created_by uuid, p_assigned_to uuid
)
returns table(cond1 boolean, cond2 boolean, cond3 boolean, cond4 boolean, org_id uuid, role_val text, dept_id uuid, uid_val uuid)
language sql
stable
as $$
  select
    p_organization_id = public.current_org_id() as cond1,
    p_created_by = auth.uid() as cond2,
    (public.current_role() = 'super_admin' or (public.current_role() = 'admin' and p_department_id = public.current_department_id())) as cond3,
    (p_assigned_to is null) as cond4,
    public.current_org_id() as org_id,
    public.current_role()::text as role_val,
    public.current_department_id() as dept_id,
    auth.uid() as uid_val;
$$;

grant execute on function public.debug_task_insert_check(uuid, uuid, uuid, uuid) to authenticated;
