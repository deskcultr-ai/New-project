-- The "department resources" storage policies used a bare inline
-- `exists (select ... from public.departments ...)` subquery instead of a
-- SECURITY DEFINER helper. That subquery runs under whatever role/session
-- context the Storage micro-service uses for object mutations, which
-- doesn't reliably resolve the same way plain PostgREST calls do (every
-- other storage policy in this app -- tasks, messages, personal folders --
-- already goes through a SECURITY DEFINER function for exactly this
-- reason, bypassing the need for the referenced table's own RLS to line
-- up under that session). Diagnosed by comparing a debug RPC (which
-- returned all-true conditions) against the real storage write, which
-- still rejected it -- the RPC ran under normal PostgREST role
-- resolution, the storage call didn't. Fix: same SECURITY DEFINER pattern
-- as can_access_personal_folder.

drop policy "department resources read" on storage.objects;
drop policy "department resources write" on storage.objects;
drop policy "department resources delete" on storage.objects;
drop function if exists public.debug_resource_write_check(uuid);

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
      and (public.current_role() = 'super_admin' or d.id = public.current_department_id())
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
        public.current_role() = 'super_admin'
        or (public.current_role() = 'admin' and d.id = public.current_department_id())
      )
  );
$$;

grant execute on function public.can_read_department_resources(uuid) to authenticated;
grant execute on function public.can_write_department_resources(uuid) to authenticated;

create policy "department resources read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'resources'
    and public.can_read_department_resources(public.try_parse_uuid((string_to_array(name, '/'))[2]))
  );

create policy "department resources write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'resources'
    and public.can_write_department_resources(public.try_parse_uuid((string_to_array(name, '/'))[2]))
  );

create policy "department resources delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'resources'
    and public.can_write_department_resources(public.try_parse_uuid((string_to_array(name, '/'))[2]))
  );
