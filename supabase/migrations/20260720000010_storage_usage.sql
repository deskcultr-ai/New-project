-- PRD 9.4 nice-to-have: storage usage dashboard for Super Admin. A single
-- aggregate query against storage.objects (which carries file size in its
-- metadata jsonb) is far cheaper and more accurate than listing every
-- department/personal folder client-side. SECURITY DEFINER so it can read
-- storage.objects across the whole org regardless of the caller's own
-- object-level RLS grants; access is still gated inside the function.

create or replace function public.org_storage_usage()
returns table(total_bytes bigint, file_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'super_admin' then
    raise exception 'Only a Super Admin can view storage usage.';
  end if;

  return query
  select
    coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as total_bytes,
    count(*)::bigint as file_count
  from storage.objects o
  where o.bucket_id = 'org-drive'
    and (string_to_array(o.name, '/'))[1] = public.current_org_id()::text;
end;
$$;

grant execute on function public.org_storage_usage() to authenticated;
