-- DeskCulture: notifications for org/department joins, Drive uploads, and
-- new departments -- previously only messages (mention/dm/thread_reply)
-- and task assignment notified anyone.

alter type public.notification_type add value if not exists 'member_joined';
alter type public.notification_type add value if not exists 'file_uploaded';
alter type public.notification_type add value if not exists 'department_created';

-- ============================================================
-- 1. Someone joins the org/department. Super Admin hears about every
--    join org-wide; a department's Admin(s) hear about joins into their
--    own department specifically.
-- ============================================================

create or replace function public.notify_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_super_admin uuid;
  joined_label text;
begin
  if new.email is null then
    return new;
  end if;

  joined_label := coalesce(new.username, new.full_name, new.email);

  select super_admin_id into org_super_admin from public.organizations where id = new.organization_id;
  if org_super_admin is not null and org_super_admin <> new.id then
    insert into public.notifications (profile_id, type, title, body, link)
    values (org_super_admin, 'member_joined', joined_label || ' joined your organization', new.role::text, '/admin/people');
  end if;

  if new.department_id is not null then
    insert into public.notifications (profile_id, type, title, body, link)
    select p.id, 'member_joined', joined_label || ' joined your department', new.role::text, '/admin/departments/' || new.department_id
    from public.profiles p
    where p.organization_id = new.organization_id
      and p.department_id = new.department_id
      and p.role = 'admin'
      and p.id <> new.id;
  end if;

  return new;
end;
$$;

create trigger profiles_notify_member_joined
  after insert on public.profiles
  for each row execute function public.notify_member_joined();

-- ============================================================
-- 2. A file lands in a department resources folder or someone else's
--    personal folder. Resources: notify everyone with read access to that
--    department (its Admin/employees) plus the org's Super Admin.
--    Personal: notify the folder owner, if it wasn't their own upload.
-- ============================================================

create or replace function public.notify_file_uploaded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  path_parts text[];
  org_id uuid;
  uploader_id uuid := auth.uid();
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
      and p.id <> uploader_id
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

create trigger storage_notify_file_uploaded
  after insert on storage.objects
  for each row execute function public.notify_file_uploaded();

-- ============================================================
-- 3. A new department is created. Notifies the org's Admins (the Super
--    Admin is always the one creating it, so notifying them would just
--    be a self-notification).
-- ============================================================

create or replace function public.notify_department_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (profile_id, type, title, body, link)
  select p.id, 'department_created', 'New department: ' || new.name, null, '/admin/departments/' || new.id
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.role = 'admin';
  return new;
end;
$$;

create trigger departments_notify_created
  after insert on public.departments
  for each row execute function public.notify_department_created();
