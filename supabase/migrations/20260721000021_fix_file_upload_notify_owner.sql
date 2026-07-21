-- notify_file_uploaded used auth.uid() to identify the uploader, which
-- returned null inside this AFTER INSERT trigger on storage.objects (live-
-- diagnosed: the object's own owner_id column was correctly populated with
-- the uploader while auth.uid() inside the trigger was not usable) --
-- "p.id <> uploader_id" then compared against null and matched zero rows
-- every time, so nobody ever got notified. Use new.owner_id instead, which
-- is set directly on the row by Storage regardless of session context.

create or replace function public.notify_file_uploaded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  path_parts text[];
  org_id uuid;
  uploader_id uuid := new.owner_id;
  uploader_label text;
  dept_id uuid;
  dept_name text;
  owner_profile_id uuid;
  file_name text;
begin
  if new.bucket_id <> 'org-drive' then
    return new;
  end if;

  path_parts := string_to_array(new.name, '/');
  org_id := public.try_parse_uuid(path_parts[1]);
  if org_id is null then
    return new;
  end if;
  file_name := path_parts[array_length(path_parts, 1)];

  select coalesce(username, full_name, email) into uploader_label from public.profiles where id = uploader_id;
  uploader_label := coalesce(uploader_label, 'Someone');

  if path_parts[3] = 'resources' then
    dept_id := public.try_parse_uuid(path_parts[2]);
    if dept_id is null then
      return new;
    end if;
    select name into dept_name from public.departments where id = dept_id;

    insert into public.notifications (profile_id, type, title, body, link)
    select p.id, 'file_uploaded', uploader_label || ' uploaded a file to ' || coalesce(dept_name, 'a department'), file_name, '/drive/departments/' || dept_id
    from public.profiles p
    where p.organization_id = org_id
      and (uploader_id is null or p.id <> uploader_id)
      and (p.role = 'super_admin' or p.department_id = dept_id);

  elsif path_parts[2] = 'personal' then
    owner_profile_id := public.try_parse_uuid(path_parts[3]);
    if owner_profile_id is null or owner_profile_id = uploader_id then
      return new;
    end if;

    insert into public.notifications (profile_id, type, title, body, link)
    values (owner_profile_id, 'file_uploaded', uploader_label || ' added a file to your personal folder', file_name, '/drive/personal/' || owner_profile_id);
  end if;

  return new;
end;
$$;

drop function if exists public.debug_object_owner(uuid);
