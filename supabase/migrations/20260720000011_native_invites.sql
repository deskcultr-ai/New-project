-- DeskCulture: switch from the custom-token + Resend-API invite system to
-- Supabase Auth's native admin.inviteUserByEmail. auth.users now carries
-- the invite (created at send time, not redemption time), so there's no
-- separate token table or redeem-a-token endpoint needed anymore.

-- ============================================================
-- handle_new_invited_user: fires the moment admin.inviteUserByEmail()
-- creates the auth.users row (immediately, at send time -- well before
-- the invitee ever clicks the email link). Reads the org/dept/role we
-- attached as user_metadata and creates the profile right away.
-- ============================================================

create or replace function public.handle_new_invited_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := new.raw_user_meta_data;
  v_role public.org_role;
  v_org uuid;
  v_dept uuid;
begin
  -- Only acts on users created through our invite flow (metadata present).
  -- There is no public signup path, so nothing else should ever insert
  -- into auth.users, but stay defensive rather than assume that holds.
  if meta ? 'invite_role' and meta ? 'organization_id' then
    v_role := (meta->>'invite_role')::public.org_role;
    v_org := (meta->>'organization_id')::uuid;
    v_dept := nullif(meta->>'department_id', '')::uuid;

    insert into public.profiles (id, organization_id, department_id, role, email, status)
    values (new.id, v_org, v_dept, v_role, new.email, 'active');

    if v_role = 'super_admin' then
      update public.organizations
      set super_admin_id = new.id
      where id = v_org and super_admin_id is null;
    end if;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_invited_user();

-- ============================================================
-- org_people_status: replaces the old invites.accepted_at-based pending
-- list. auth.users isn't exposed over PostgREST, so this SECURITY
-- DEFINER function is the only way the client can see invited_at/
-- confirmed_at (confirmed_at is null until the invitee opens the emailed
-- link and it gets verified, i.e. "pending" vs "active").
-- ============================================================

create or replace function public.org_people_status()
returns table(
  profile_id uuid,
  email text,
  full_name text,
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
  select p.id, p.email, p.full_name, p.role, p.department_id, u.invited_at, u.confirmed_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.organization_id = public.current_org_id()
    and (
      public.current_role() = 'super_admin'
      or (public.current_role() = 'admin' and p.department_id = public.current_department_id())
    )
  order by u.invited_at desc nulls last;
$$;

grant execute on function public.org_people_status() to authenticated;

-- ============================================================
-- The custom invites table is fully superseded by the above -- drop it
-- (cascades its own RLS policies; nothing else references it by FK).
-- ============================================================

drop table public.invites cascade;
