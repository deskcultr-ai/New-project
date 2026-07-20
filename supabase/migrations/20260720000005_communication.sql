-- DeskCulture: communication layer (dept channels, announcements, DMs,
-- mentions/notifications, reactions, attachments). Same RLS-only
-- philosophy as tasks -- no service-role bypass in any application code.
--
-- Anti-self-reference rule carried over from the tasks migration:
-- `conversations` never gets a policy that re-queries `conversations`
-- (that broke INSERT ... RETURNING there). can_access_conversation() does
-- self-reference, but it's only ever used from *other* tables' policies
-- (messages, attachments, ...), which is safe.

-- ============================================================
-- Enums
-- ============================================================

create type public.conversation_type as enum ('department_channel', 'announcement', 'dm');
create type public.notification_type as enum ('mention', 'dm');

-- ============================================================
-- Tables
-- ============================================================

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type public.conversation_type not null,
  department_id uuid references public.departments(id) on delete cascade,
  dm_profile_a uuid references public.profiles(id) on delete cascade,
  dm_profile_b uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversations_shape_matches_type check (
    (type = 'department_channel' and department_id is not null and dm_profile_a is null and dm_profile_b is null)
    or (type = 'announcement' and department_id is null and dm_profile_a is null and dm_profile_b is null)
    or (type = 'dm' and department_id is null and dm_profile_a is not null and dm_profile_b is not null and dm_profile_a < dm_profile_b)
  )
);

create unique index conversations_one_channel_per_department on public.conversations (department_id) where type = 'department_channel';
create unique index conversations_one_announcement_per_org on public.conversations (organization_id) where type = 'announcement';
create unique index conversations_one_dm_per_pair on public.conversations (dm_profile_a, dm_profile_b) where type = 'dm';
create index conversations_organization_id_idx on public.conversations (organization_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index messages_conversation_id_idx on public.messages (conversation_id, created_at);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  file_name text not null,
  file_size bigint not null,
  content_type text,
  created_at timestamptz not null default now()
);

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, profile_id, emoji)
);

create table public.message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  mentioned_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index message_mentions_mentioned_profile_id_idx on public.message_mentions (mentioned_profile_id);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_id_idx on public.notifications (profile_id, created_at desc);

-- ============================================================
-- Auto-create channels (SECURITY DEFINER: fires regardless of whether the
-- parent row was created by an authenticated Super Admin's RLS-checked
-- insert or the service-role platform-admin approval route).
-- ============================================================

create or replace function public.create_department_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversations (organization_id, type, department_id)
  values (new.organization_id, 'department_channel', new.id);
  return new;
end;
$$;

create trigger departments_create_channel
  after insert on public.departments
  for each row
  execute function public.create_department_channel();

create or replace function public.create_announcement_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversations (organization_id, type)
  values (new.id, 'announcement');
  return new;
end;
$$;

create trigger organizations_create_announcement_channel
  after insert on public.organizations
  for each row
  execute function public.create_announcement_channel();

-- ============================================================
-- Notification triggers
-- ============================================================

create or replace function public.notify_dm_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  convo public.conversations;
  recipient uuid;
  sender_name text;
begin
  select * into convo from public.conversations where id = new.conversation_id;
  if convo.type <> 'dm' then
    return new;
  end if;

  recipient := case when convo.dm_profile_a = new.author_id then convo.dm_profile_b else convo.dm_profile_a end;
  select coalesce(full_name, email) into sender_name from public.profiles where id = new.author_id;

  insert into public.notifications (profile_id, type, title, body, link)
  values (recipient, 'dm', coalesce(sender_name, 'Someone') || ' sent you a message', left(new.body, 140), '/messages/' || new.conversation_id);

  return new;
end;
$$;

create trigger messages_notify_dm
  after insert on public.messages
  for each row
  execute function public.notify_dm_participant();

create or replace function public.notify_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msg public.messages;
  sender_name text;
begin
  select * into msg from public.messages where id = new.message_id;
  select coalesce(full_name, email) into sender_name from public.profiles where id = msg.author_id;

  insert into public.notifications (profile_id, type, title, body, link)
  values (new.mentioned_profile_id, 'mention', coalesce(sender_name, 'Someone') || ' mentioned you', left(msg.body, 140), '/messages/' || msg.conversation_id);

  return new;
end;
$$;

create trigger message_mentions_notify
  after insert on public.message_mentions
  for each row
  execute function public.notify_mention();

-- ============================================================
-- can_access_conversation: used by every table EXCEPT conversations
-- itself (see anti-self-reference note at top of file).
-- ============================================================

create or replace function public.can_access_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = target_conversation_id
      and c.organization_id = public.current_org_id()
      and (
        c.type = 'announcement'
        or (c.type = 'department_channel' and (public.current_role() = 'super_admin' or c.department_id = public.current_department_id()))
        or (c.type = 'dm' and auth.uid() in (c.dm_profile_a, c.dm_profile_b))
      )
  );
$$;

grant execute on function public.can_access_conversation(uuid) to authenticated;

-- ============================================================
-- get_or_create_dm: SECURITY INVOKER so the insert stays subject to the
-- conversations INSERT policy below -- no privilege bypass.
-- ============================================================

create or replace function public.get_or_create_dm(other_profile_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  a uuid;
  b uuid;
  result uuid;
begin
  if other_profile_id = auth.uid() then
    raise exception 'Cannot start a DM with yourself.';
  end if;

  if auth.uid() < other_profile_id then
    a := auth.uid();
    b := other_profile_id;
  else
    a := other_profile_id;
    b := auth.uid();
  end if;

  select id into result from public.conversations where type = 'dm' and dm_profile_a = a and dm_profile_b = b;
  if result is not null then
    return result;
  end if;

  insert into public.conversations (organization_id, type, dm_profile_a, dm_profile_b)
  values (public.current_org_id(), 'dm', a, b)
  returning id into result;
  return result;
exception when unique_violation then
  select id into result from public.conversations where type = 'dm' and dm_profile_a = a and dm_profile_b = b;
  return result;
end;
$$;

grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- ============================================================
-- post_message: SECURITY INVOKER convenience wrapper (message + mentions
-- in one round trip), still fully RLS-checked per statement.
-- ============================================================

create or replace function public.post_message(p_conversation_id uuid, p_body text, p_mentioned_ids uuid[] default '{}')
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
  mid uuid;
begin
  insert into public.messages (conversation_id, author_id, body)
  values (p_conversation_id, auth.uid(), p_body)
  returning id into new_id;

  if p_mentioned_ids is not null then
    foreach mid in array p_mentioned_ids loop
      insert into public.message_mentions (message_id, mentioned_profile_id) values (new_id, mid);
    end loop;
  end if;

  return new_id;
end;
$$;

grant execute on function public.post_message(uuid, text, uuid[]) to authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.conversations enable row level security;

create policy "org members can read conversations they belong to"
  on public.conversations for select
  to authenticated
  using (
    organization_id = public.current_org_id()
    and (
      type = 'announcement'
      or (type = 'department_channel' and (public.current_role() = 'super_admin' or department_id = public.current_department_id()))
      or (type = 'dm' and auth.uid() in (dm_profile_a, dm_profile_b))
    )
  );

create policy "members can start a dm"
  on public.conversations for insert
  to authenticated
  with check (
    organization_id = public.current_org_id()
    and type = 'dm'
    and auth.uid() in (dm_profile_a, dm_profile_b)
    and exists (
      select 1 from public.profiles p
      where p.organization_id = public.current_org_id()
        and p.id = (case when dm_profile_a = auth.uid() then dm_profile_b else dm_profile_a end)
    )
  );

-- Employees' profiles visibility (from the tasks migration) is dept-scoped,
-- but a DM partner (e.g. a Super Admin, who has no department) may fall
-- outside that. Let anyone see the profiles of people they share a DM with,
-- regardless of role/department, so DM lists can render a name. Queries
-- conversations, not profiles -- no self-reference risk.
create policy "dm partners are visible to each other"
  on public.profiles for select
  to authenticated
  using (
    id in (
      select dm_profile_a from public.conversations where type = 'dm' and dm_profile_b = auth.uid()
      union
      select dm_profile_b from public.conversations where type = 'dm' and dm_profile_a = auth.uid()
    )
  );

alter table public.messages enable row level security;

create policy "conversation members can read messages"
  on public.messages for select
  to authenticated
  using (public.can_access_conversation(conversation_id));

create policy "conversation members can post messages"
  on public.messages for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.can_access_conversation(conversation_id)
    and (
      (select type from public.conversations where id = conversation_id) <> 'announcement'
      or public.current_role() = 'super_admin'
    )
  );

alter table public.message_attachments enable row level security;

create policy "conversation members can read attachments"
  on public.message_attachments for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_access_conversation(m.conversation_id)
    )
  );

create policy "conversation members can add attachments"
  on public.message_attachments for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_access_conversation(m.conversation_id)
    )
  );

alter table public.message_reactions enable row level security;

create policy "conversation members can read reactions"
  on public.message_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_access_conversation(m.conversation_id)
    )
  );

create policy "conversation members can react"
  on public.message_reactions for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_access_conversation(m.conversation_id)
    )
  );

create policy "members can remove their own reaction"
  on public.message_reactions for delete
  to authenticated
  using (profile_id = auth.uid());

alter table public.message_mentions enable row level security;

create policy "conversation members can read mentions"
  on public.message_mentions for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_access_conversation(m.conversation_id)
    )
  );

create policy "authors can mention people in their own message"
  on public.message_mentions for insert
  to authenticated
  with check (
    exists (select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid())
  );

alter table public.conversation_reads enable row level security;

create policy "members manage their own read state"
  on public.conversation_reads for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.can_access_conversation(conversation_id));

alter table public.notifications enable row level security;

create policy "profiles read their own notifications"
  on public.notifications for select
  to authenticated
  using (profile_id = auth.uid());

create policy "profiles mark their own notifications read"
  on public.notifications for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
-- No insert policy: notifications are only created by the SECURITY
-- DEFINER triggers above.

-- ============================================================
-- Storage: message attachments, same org-drive bucket as task attachments.
-- Path: {organization_id}/messages/{conversation_id}/{message_id}/{filename}
-- ============================================================

create policy "message attachment read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[2] = 'messages'
    and public.can_access_conversation(((string_to_array(name, '/'))[3])::uuid)
  );

create policy "message attachment upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-drive'
    and (string_to_array(name, '/'))[2] = 'messages'
    and public.can_access_conversation(((string_to_array(name, '/'))[3])::uuid)
  );

-- ============================================================
-- Realtime: live messages, live reaction updates, live notification bell.
-- ============================================================

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end;
$$;
