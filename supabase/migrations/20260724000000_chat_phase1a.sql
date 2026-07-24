-- Chat Phase 1A: edit/delete, read receipts, pinning, typing (ephemeral,
-- no schema needed), forwarding (reuses post_message + message_attachments
-- as-is), date separators/grouping (pure frontend, no schema needed).
--
-- messages currently has no UPDATE or DELETE policy at all -- nobody,
-- not even the author, can edit or delete a message today. This adds a
-- single UPDATE policy (soft-delete is modeled as an update, so no DELETE
-- policy is needed) covering both edit and delete-for-everyone, with a
-- 15-minute self-service window and an Org Super Admin moderation override.

alter table public.messages add column deleted_at timestamptz;
alter table public.messages add column deleted_for_everyone boolean not null default false;

create policy "author can edit or admin can moderate"
  on public.messages for update
  to authenticated
  using (
    (author_id = auth.uid() and created_at > now() - interval '15 minutes')
    or public.current_role() = 'org_super_admin'
  )
  with check (
    (author_id = auth.uid() and created_at > now() - interval '15 minutes')
    or public.current_role() = 'org_super_admin'
  );

-- Per-message read receipts (distinct from conversation_reads, which only
-- tracks a per-conversation "last read at" watermark for unread badges).
create table public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

alter table public.message_reads enable row level security;

create policy "conversation members can read receipts"
  on public.message_reads for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_access_conversation(m.conversation_id)
    )
  );

create policy "members mark their own read receipts"
  on public.message_reads for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_access_conversation(m.conversation_id)
    )
  );

-- Pinned messages, capped at 3 per conversation (matches WhatsApp's own cap).
create table public.message_pins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid references public.profiles(id) on delete set null,
  pinned_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);

alter table public.message_pins enable row level security;

create policy "conversation members can view pins"
  on public.message_pins for select
  to authenticated
  using (public.can_access_conversation(conversation_id));

create policy "conversation members can pin messages"
  on public.message_pins for insert
  to authenticated
  with check (public.can_access_conversation(conversation_id) and pinned_by = auth.uid());

create policy "conversation members can unpin messages"
  on public.message_pins for delete
  to authenticated
  using (public.can_access_conversation(conversation_id));

create or replace function public.enforce_pin_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.message_pins where conversation_id = new.conversation_id) >= 3 then
    raise exception 'A conversation can have at most 3 pinned messages. Unpin one first.';
  end if;
  return new;
end;
$$;

create trigger message_pins_enforce_limit
  before insert on public.message_pins
  for each row execute function public.enforce_pin_limit();

-- Per-viewer "delete for me" -- hides a message from one person's view only,
-- without touching the row anyone else sees.
create table public.message_hidden_for (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

alter table public.message_hidden_for enable row level security;

create policy "a user manages their own hidden messages"
  on public.message_hidden_for for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.message_reads;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.message_pins;
exception when duplicate_object then null;
end;
$$;
