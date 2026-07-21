-- Temporary diagnostic: list every RLS policy currently active on
-- storage.objects, since a live avatar upload is being rejected despite a
-- verified-valid, correctly-subbed, non-expired session -- something is
-- blocking it that isn't explained by the avatars-bucket policies alone.

create or replace function public.debug_list_storage_policies()
returns table(policyname text, cmd text, permissive text, roles text, qual text, with_check text)
language sql
stable
security definer
set search_path = public
as $$
  select polname::text, case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else '*' end,
    case when polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
    (select string_agg(rolname, ',') from pg_roles where oid = any(polroles)),
    pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy
  where polrelid = 'storage.objects'::regclass;
$$;

grant execute on function public.debug_list_storage_policies() to authenticated;
