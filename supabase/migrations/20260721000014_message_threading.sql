-- DeskCulture: threaded replies. The direct fix for "30+ WhatsApp groups"
-- is giving people somewhere to have a side-conversation without leaving
-- the channel -- reply in a thread instead of spinning up a new group.
-- Replies are just normal messages with reply_to_message_id set; existing
-- RLS (can_access_conversation) already covers them with no changes.

alter table public.messages
  add column reply_to_message_id uuid references public.messages(id) on delete set null;

create index messages_reply_to_message_id_idx on public.messages (reply_to_message_id) where reply_to_message_id is not null;

-- post_message: accept an optional reply target.
create or replace function public.post_message(
  p_conversation_id uuid,
  p_body text,
  p_mentioned_ids uuid[] default '{}',
  p_reply_to_message_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id uuid;
  mid uuid;
begin
  insert into public.messages (conversation_id, author_id, body, reply_to_message_id)
  values (p_conversation_id, auth.uid(), p_body, p_reply_to_message_id)
  returning id into new_id;

  if p_mentioned_ids is not null then
    foreach mid in array p_mentioned_ids loop
      insert into public.message_mentions (message_id, mentioned_profile_id) values (new_id, mid);
    end loop;
  end if;

  return new_id;
end;
$$;

grant execute on function public.post_message(uuid, text, uuid[], uuid) to authenticated;

-- Notify the parent message's author when someone replies to their message.
alter type public.notification_type add value if not exists 'thread_reply';

create or replace function public.notify_thread_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent public.messages;
  sender_name text;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  select * into parent from public.messages where id = new.reply_to_message_id;
  if parent.author_id is null or parent.author_id = new.author_id then
    return new;
  end if;

  select coalesce(username, full_name, email) into sender_name from public.profiles where id = new.author_id;

  insert into public.notifications (profile_id, type, title, body, link)
  values (
    parent.author_id,
    'thread_reply',
    coalesce(sender_name, 'Someone') || ' replied to your message',
    left(new.body, 140),
    '/messages/' || new.conversation_id
  );

  return new;
end;
$$;

create trigger messages_notify_thread_reply
  after insert on public.messages
  for each row execute function public.notify_thread_reply();
