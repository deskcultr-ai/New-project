-- Create activity logs table for tracking organization actions
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null, -- e.g. 'task.created', 'task.completed', 'department.created', 'member.invited', 'member.joined'
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.activity_logs enable row level security;

-- Select Policy: authenticated members can view activity logs for their own organization
create policy "Users can view organization activity logs"
  on public.activity_logs for select
  to authenticated
  using (organization_id = public.current_org_id());

-- Triggers for automatic logging

-- 1. Log Department creation
create or replace function public.log_department_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs (organization_id, actor_id, action, details)
  values (
    new.organization_id,
    auth.uid(),
    'department.created',
    jsonb_build_object('name', new.name)
  );
  return new;
end;
$$;

create or replace trigger tr_log_department_creation
  after insert on public.departments
  for each row execute function public.log_department_creation();

-- 2. Log Task events (creation & completion)
create or replace function public.log_task_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (organization_id, actor_id, action, details)
    values (
      new.organization_id,
      new.created_by,
      'task.created',
      jsonb_build_object('title', new.title)
    );
  elsif tg_op = 'UPDATE' then
    if new.status = 'done' and old.status <> 'done' then
      insert into public.activity_logs (organization_id, actor_id, action, details)
      values (
        new.organization_id,
        auth.uid(),
        'task.completed',
        jsonb_build_object('title', new.title)
      );
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger tr_log_task_events
  after insert or update on public.tasks
  for each row execute function public.log_task_events();



-- 4. Log member joining (profile created)
create or replace function public.log_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Exclude platform owner / general accounts created outside invite flow
  if new.email is not null then
    insert into public.activity_logs (organization_id, actor_id, action, details)
    values (
      new.organization_id,
      new.id,
      'member.joined',
      jsonb_build_object('email', new.email, 'role', new.role, 'full_name', new.full_name)
    );
  end if;
  return new;
end;
$$;

create or replace trigger tr_log_member_joined
  after insert on public.profiles
  for each row execute function public.log_member_joined();
