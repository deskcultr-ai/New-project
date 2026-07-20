-- DeskCulture: auth + invite system baseline.
-- Org/department/role model with invite-only account creation. No public
-- signup path exists anywhere in this schema -- profiles are only ever
-- created by the service-role invite-accept route.

create extension if not exists pgcrypto;

-- ============================================================
-- Enums
-- ============================================================

create type public.org_role as enum ('super_admin', 'admin', 'employee');
create type public.org_request_status as enum ('pending', 'approved', 'rejected');
create type public.profile_status as enum ('active', 'disabled');

-- ============================================================
-- Tables
-- ============================================================

create table public.pending_org_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text not null,
  work_email text not null,
  phone text,
  status public.org_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  rejection_reason text
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Nullable until the Super Admin claim invite is accepted. The unique
  -- constraint is what makes a second Super Admin for this org impossible
  -- at the database level, and also stops one person claiming two orgs.
  super_admin_id uuid unique references auth.users(id) on delete set null,
  org_request_id uuid references public.pending_org_requests(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  role public.org_role not null,
  full_name text,
  email text not null,
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  constraint profiles_department_matches_role check (
    (role = 'super_admin' and department_id is null)
    or (role in ('admin', 'employee') and department_id is not null)
  )
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  role public.org_role not null,
  email text not null,
  -- Only the SHA-256 hash is stored; the raw token lives solely in the
  -- emailed link and is never persisted.
  token_hash text not null unique,
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invites_department_matches_role check (
    (role = 'super_admin' and department_id is null)
    or (role in ('admin', 'employee') and department_id is not null)
  )
);

create index profiles_organization_id_idx on public.profiles (organization_id);
create index profiles_department_id_idx on public.profiles (department_id);
create index departments_organization_id_idx on public.departments (organization_id);
create index invites_organization_id_idx on public.invites (organization_id);
create index invites_email_idx on public.invites (email);

-- ============================================================
-- Helper functions (SECURITY DEFINER so RLS on profiles can't recurse
-- through them -- they run as the function owner, bypassing RLS
-- internally, the same pattern the previous schema used).
-- ============================================================

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select department_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_role()
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_department_id() to authenticated;
grant execute on function public.current_role() to authenticated;

-- Prevents a user from escalating their own role/org/department/status via
-- a direct PostgREST update -- only a Super Admin's session may change
-- these fields (e.g. future move-department / disable-account admin
-- actions). Everyone can still self-update full_name.
create or replace function public.profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     or new.organization_id is distinct from old.organization_id
     or new.department_id is distinct from old.department_id
     or new.status is distinct from old.status
  then
    if public.current_role() <> 'super_admin' then
      raise exception 'Not authorized to change role, organization, department, or status.';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_update_trigger
  before update on public.profiles
  for each row
  execute function public.profiles_guard_update();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.pending_org_requests enable row level security;
-- No policies: only the service-role key (platform-admin API routes) can
-- read or write this table. Not even authenticated org members can see it.

alter table public.organizations enable row level security;

create policy "org members can read own organization"
  on public.organizations for select
  to authenticated
  using (id = public.current_org_id());

create policy "super admin can update own organization"
  on public.organizations for update
  to authenticated
  using (id = public.current_org_id() and public.current_role() = 'super_admin')
  with check (id = public.current_org_id() and public.current_role() = 'super_admin');
-- No insert/delete policy: organizations are only created by the
-- service-role approval route.

alter table public.departments enable row level security;

create policy "org members can read departments"
  on public.departments for select
  to authenticated
  using (organization_id = public.current_org_id());

create policy "super admin can manage departments"
  on public.departments for all
  to authenticated
  using (organization_id = public.current_org_id() and public.current_role() = 'super_admin')
  with check (organization_id = public.current_org_id() and public.current_role() = 'super_admin');

alter table public.profiles enable row level security;

create policy "self read"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "super admin reads org profiles"
  on public.profiles for select
  to authenticated
  using (organization_id = public.current_org_id() and public.current_role() = 'super_admin');

create policy "admin reads own department profiles"
  on public.profiles for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and public.current_role() = 'admin'
    and department_id = public.current_department_id()
  );

create policy "self update"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- No insert/delete policy: profile rows are only created by the
-- service-role invite-accept route.

alter table public.invites enable row level security;

create policy "org admins can read relevant invites"
  on public.invites for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      public.current_role() = 'super_admin'
      or (public.current_role() = 'admin' and department_id = public.current_department_id())
    )
  );
-- No insert/update/delete policy: invite creation and redemption are both
-- handled by service-role API routes, which apply authorization from the
-- caller's own profile row before writing.
