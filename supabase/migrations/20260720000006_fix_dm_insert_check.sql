-- The "members can start a dm" INSERT policy on conversations checked the
-- other participant exists via a plain subquery on public.profiles. That
-- subquery runs under the CALLING user's own RLS, and an employee can't
-- see a Super Admin's profile (no department match) -- especially not
-- before the very DM that would grant that visibility exists yet. Chicken
-- and egg. Fix: check existence through a SECURITY DEFINER function that
-- bypasses RLS for this narrow "is this a real org member" check, same
-- reasoning as current_org_id() etc.

create or replace function public.profile_exists_in_org(target_profile_id uuid, target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = target_profile_id and organization_id = target_org_id
  );
$$;

grant execute on function public.profile_exists_in_org(uuid, uuid) to authenticated;

drop policy "members can start a dm" on public.conversations;

create policy "members can start a dm"
  on public.conversations for insert
  to authenticated
  with check (
    organization_id = public.current_org_id()
    and type = 'dm'
    and auth.uid() in (dm_profile_a, dm_profile_b)
    and public.profile_exists_in_org(
      case when dm_profile_a = auth.uid() then dm_profile_b else dm_profile_a end,
      public.current_org_id()
    )
  );
