-- DeskCulture: a single active user could never be deleted (from the
-- Supabase dashboard or otherwise) once they had any activity -- tasks,
-- comments, messages, etc. all referenced profiles(id) with no ON DELETE
-- behavior (defaults to NO ACTION), so deleting their auth.users row
-- cascaded into profiles, which then hit these and failed the whole
-- operation with a generic "Database error deleting user". Deleting a
-- whole organization already works (it cascades from organizations.id,
-- removing the referencing rows before profiles), but removing one
-- person while their org keeps running never did.
--
-- Fix: content authored by a removed person survives with its author set
-- to null ("removed user") rather than blocking deletion or cascading
-- destruction onto everyone else's tasks/threads. Lightweight signals
-- that are meaningless without their actor (reactions, mentions) are
-- cascade-deleted instead of left dangling.

-- Content that should survive with a null author -----------------------

alter table public.tasks alter column created_by drop not null;
alter table public.tasks drop constraint tasks_created_by_fkey;
alter table public.tasks add constraint tasks_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.tasks drop constraint tasks_assigned_to_fkey;
alter table public.tasks add constraint tasks_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

alter table public.task_comments alter column author_id drop not null;
alter table public.task_comments drop constraint task_comments_author_id_fkey;
alter table public.task_comments add constraint task_comments_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;

alter table public.task_attachments alter column uploaded_by drop not null;
alter table public.task_attachments drop constraint task_attachments_uploaded_by_fkey;
alter table public.task_attachments add constraint task_attachments_uploaded_by_fkey
  foreign key (uploaded_by) references public.profiles(id) on delete set null;

alter table public.messages alter column author_id drop not null;
alter table public.messages drop constraint messages_author_id_fkey;
alter table public.messages add constraint messages_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;

alter table public.message_attachments alter column uploaded_by drop not null;
alter table public.message_attachments drop constraint message_attachments_uploaded_by_fkey;
alter table public.message_attachments add constraint message_attachments_uploaded_by_fkey
  foreign key (uploaded_by) references public.profiles(id) on delete set null;

alter table public.task_forward_requests alter column requested_by drop not null;
alter table public.task_forward_requests drop constraint task_forward_requests_requested_by_fkey;
alter table public.task_forward_requests add constraint task_forward_requests_requested_by_fkey
  foreign key (requested_by) references public.profiles(id) on delete set null;

alter table public.task_forward_requests alter column forward_to drop not null;
alter table public.task_forward_requests drop constraint task_forward_requests_forward_to_fkey;
alter table public.task_forward_requests add constraint task_forward_requests_forward_to_fkey
  foreign key (forward_to) references public.profiles(id) on delete set null;

alter table public.task_forward_requests drop constraint task_forward_requests_reviewed_by_fkey;
alter table public.task_forward_requests add constraint task_forward_requests_reviewed_by_fkey
  foreign key (reviewed_by) references public.profiles(id) on delete set null;

-- Signals that are meaningless without their actor -- delete instead ----

alter table public.message_reactions drop constraint message_reactions_profile_id_fkey;
alter table public.message_reactions add constraint message_reactions_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete cascade;

alter table public.message_mentions drop constraint message_mentions_mentioned_profile_id_fkey;
alter table public.message_mentions add constraint message_mentions_mentioned_profile_id_fkey
  foreign key (mentioned_profile_id) references public.profiles(id) on delete cascade;

drop function if exists public.debug_fk_constraint_names();
