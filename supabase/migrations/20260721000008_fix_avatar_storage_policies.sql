-- DeskCulture: fix avatar upload/update/delete.
--
-- Live-diagnosed root cause: a plain INSERT (no upsert) against the
-- avatars bucket succeeded for the file owner every time, but the exact
-- same request with upsert:true (which goes through Storage's UPDATE/
-- conflict path) and a plain DELETE both got silently rejected by RLS for
-- that same owner, on the same path, with a verified-valid non-expired
-- session. This is the same class of bug already hit once before in this
-- project (see fix_admin_chat_rls / can_read_department_resources):
-- Storage's microservice doesn't reliably resolve session context the
-- same way for mutation paths (UPDATE/DELETE) as it does for a plain
-- INSERT. The established fix is the same here -- move the check into a
-- SECURITY DEFINER function instead of an inline auth.uid() comparison.

create or replace function public.is_own_avatar_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select object_name is not null and (string_to_array(object_name, '/'))[1] = auth.uid()::text;
$$;

grant execute on function public.is_own_avatar_path(text) to authenticated;

drop policy "avatar owner can upload" on storage.objects;
drop policy "avatar owner can update" on storage.objects;
drop policy "avatar owner can delete" on storage.objects;

create policy "avatar owner can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and public.is_own_avatar_path(name));

create policy "avatar owner can update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and public.is_own_avatar_path(name))
  with check (bucket_id = 'avatars' and public.is_own_avatar_path(name));

create policy "avatar owner can delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and public.is_own_avatar_path(name));

drop function if exists public.debug_list_storage_policies();
