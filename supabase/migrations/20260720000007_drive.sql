-- DeskCulture: Org Drive -- personal folders + department resources on top
-- of the org-drive bucket already used by task/message attachments.
--
-- Robustness fix carried in from this step's design work: the step-3 task
-- attachment storage policies cast a path segment straight to ::uuid
-- without first checking it was shaped like a task path. Postgres does not
-- guarantee AND-clause short-circuit order, so once this migration adds a
-- differently-shaped path ('resources/...'), that blind cast could throw
-- invalid_text_representation and hard-error the query instead of just
-- being denied. Fix: never cast untrusted path segments directly again --
-- go through try_parse_uuid(), which returns null instead of raising.

create or replace function public.try_parse_uuid(input text)
returns uuid
language plpgsql
immutable
as $$
begin
  return input::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

drop policy "task attachment read" on storage.objects;
drop policy "task attachment upload" on storage.objects;

create policy "task attachment read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'tasks'
    and public.can_access_task(public.try_parse_uuid((string_to_array(name, '/'))[4]))
  );

create policy "task attachment upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'tasks'
    and public.can_access_task(public.try_parse_uuid((string_to_array(name, '/'))[4]))
  );

-- Same treatment for the message-attachment policies, which already had
-- the discriminator check but still used a raw cast.
drop policy "message attachment read" on storage.objects;
drop policy "message attachment upload" on storage.objects;

create policy "message attachment read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[2] = 'messages'
    and public.can_access_conversation(public.try_parse_uuid((string_to_array(name, '/'))[3]))
  );

create policy "message attachment upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[2] = 'messages'
    and public.can_access_conversation(public.try_parse_uuid((string_to_array(name, '/'))[3]))
  );

-- ============================================================
-- Personal folder: {organization_id}/personal/{profile_id}/{filename}
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
      public.current_role() = 'super_admin'
      and exists (select 1 from public.profiles where id = owner_profile_id and organization_id = public.current_org_id())
    )
    or (
      public.current_role() = 'admin'
      and exists (
        select 1 from public.profiles
        where id = owner_profile_id
          and organization_id = public.current_org_id()
          and department_id = public.current_department_id()
      )
    )
  );
$$;

grant execute on function public.can_access_personal_folder(uuid) to authenticated;

create policy "personal folder read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[2] = 'personal'
    and public.can_access_personal_folder(public.try_parse_uuid((string_to_array(name, '/'))[3]))
  );

create policy "personal folder write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[2] = 'personal'
    and public.can_access_personal_folder(public.try_parse_uuid((string_to_array(name, '/'))[3]))
  );

create policy "personal folder delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[2] = 'personal'
    and public.can_access_personal_folder(public.try_parse_uuid((string_to_array(name, '/'))[3]))
  );

-- ============================================================
-- Department resources: {organization_id}/{department_id}/resources/{filename}
-- Read: super_admin, or admin/employee of that department.
-- Write/delete: super_admin, or admin of that department only.
-- ============================================================

create policy "department resources read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'resources'
    and exists (
      select 1 from public.departments d
      where d.id = public.try_parse_uuid((string_to_array(name, '/'))[2])
        and d.organization_id = public.current_org_id()
        and (public.current_role() = 'super_admin' or d.id = public.current_department_id())
    )
  );

create policy "department resources write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'resources'
    and exists (
      select 1 from public.departments d
      where d.id = public.try_parse_uuid((string_to_array(name, '/'))[2])
        and d.organization_id = public.current_org_id()
        and (
          public.current_role() = 'super_admin'
          or (public.current_role() = 'admin' and d.id = public.current_department_id())
        )
    )
  );

create policy "department resources delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[3] = 'resources'
    and exists (
      select 1 from public.departments d
      where d.id = public.try_parse_uuid((string_to_array(name, '/'))[2])
        and d.organization_id = public.current_org_id()
        and (
          public.current_role() = 'super_admin'
          or (public.current_role() = 'admin' and d.id = public.current_department_id())
        )
    )
  );
