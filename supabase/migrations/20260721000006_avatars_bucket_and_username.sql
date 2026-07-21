-- DeskCulture: dedicated public bucket for avatars (org-drive is private,
-- so getPublicUrl() against it produced dead links -- avatars need to
-- render instantly in <img> tags across the app without signed-URL
-- round-trips or expiry, so they get their own public bucket instead).
-- Also widens org_people_status() to return username, so directory UIs
-- can show @handle instead of a raw email address.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

create policy "avatar owner can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text);

create policy "avatar owner can update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text);

create policy "avatar owner can delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = auth.uid()::text);

drop function if exists public.org_people_status();

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
    and public.current_role() in ('super_admin', 'admin')
  order by u.invited_at desc nulls last;
$$;

grant execute on function public.org_people_status() to authenticated;
