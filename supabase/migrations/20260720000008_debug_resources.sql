create or replace function public.debug_resource_write_check(dept_id uuid)
returns table(dept_org_matches boolean, is_super_admin boolean, is_admin_own_dept boolean, current_org uuid, current_dept uuid, current_role_val text, dept_org uuid)
language sql
stable
as $$
  select
    d.organization_id = public.current_org_id() as dept_org_matches,
    public.current_role() = 'super_admin' as is_super_admin,
    (public.current_role() = 'admin' and d.id = public.current_department_id()) as is_admin_own_dept,
    public.current_org_id() as current_org,
    public.current_department_id() as current_dept,
    public.current_role()::text as current_role_val,
    d.organization_id as dept_org
  from public.departments d
  where d.id = dept_id;
$$;

grant execute on function public.debug_resource_write_check(uuid) to authenticated;
