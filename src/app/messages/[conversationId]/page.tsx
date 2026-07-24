"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { Button, Badge, Avatar } from "@/components/ui";
import { FilePreviewModal, useFilePreview, isImage } from "@/components/file-preview";
import { uploadFileWithRetry } from "@/lib/storage-upload";
import { parseMessageBody, taskToken, REACTION_EMOJI, type ConversationType } from "@/lib/messaging";

type PersonRef = { id: string; full_name: string | null; username: string | null; email: string } | null;
type MessageRow = {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
  reply_to_message_id: string | null;
  author: PersonRef;
};
type Attachment = { id: string; message_id: string; storage_path: string; file_name: string; file_size: number; content_type: string | null };
type Reaction = { id: string; message_id: string; profile_id: string; emoji: string };
type TaskPreview = { id: string; title: string; status: string };
type DirectoryPerson = { id: string; full_name: string | null; email: string };
type TaskSuggestion = { id: string; title: string };

function personLabel(person: PersonRef) {
  if (!person) return "?";
  return person.username ? `@${person.username}` : person.full_name || person.email;
}

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversationType, setConversationType] = useState<ConversationType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [taskPreviews, setTaskPreviews] = useState<Record<string, TaskPreview | null>>({});
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [suggestMentions, setSuggestMentions] = useState<DirectoryPerson[]>([]);
  const [suggestTasks, setSuggestTasks] = useState<TaskSuggestion[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [replyBody, setReplyBody] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [pendingReplyFiles, setPendingReplyFiles] = useState<File[]>([]);
  const [replyDragOver, setReplyDragOver] = useState(false);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);

  const loadTaskPreviews = useCallback(async (bodies: string[]) => {
    const ids = new Set<string>();
    for (const b of bodies) {
      for (const segment of parseMessageBody(b)) {
        if (segment.type === "task") ids.add(segment.id);
      }
    }
    if (ids.size === 0) return;
    const { data } = await supabase.from("tasks").select("id, title, status").in("id", Array.from(ids));
    setTaskPreviews((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = null;
      for (const row of data ?? []) next[row.id as string] = row as TaskPreview;
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const me = await getProfile();
    if (!me) {
      router.replace("/login");
      return;
    }
    setProfile(me);

    const { data: convo, error: convoErr } = await supabase
      .from("conversations")
      .select("id, type")
      .eq("id", params.conversationId)
      .maybeSingle();
    if (convoErr || !convo) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setConversationType(convo.type as ConversationType);

    const { data: messageRows } = await supabase
      .from("messages")
      .select("id, conversation_id, author_id, body, created_at, reply_to_message_id, author:profiles(id,full_name,username,email)")
      .eq("conversation_id", params.conversationId)
      .order("created_at", { ascending: true });
    const rows = (messageRows ?? []) as unknown as MessageRow[];
    setMessages(rows);
    loadTaskPreviews(rows.map((r) => r.body));

    const messageIds = rows.map((r) => r.id);
    if (messageIds.length > 0) {
      const [{ data: attachmentRows }, { data: reactionRows }] = await Promise.all([
        supabase.from("message_attachments").select("id, message_id, storage_path, file_name, file_size, content_type").in("message_id", messageIds),
        supabase.from("message_reactions").select("id, message_id, profile_id, emoji").in("message_id", messageIds),
      ]);
      setAttachments((attachmentRows ?? []) as Attachment[]);
      setReactions((reactionRows ?? []) as Reaction[]);
    } else {
      setAttachments([]);
      setReactions([]);
    }

    const { data: directoryData } = await supabase.from("profiles").select("id, full_name, email").neq("id", me.id).order("full_name");
    setDirectory((directoryData ?? []) as DirectoryPerson[]);

    await supabase
      .from("conversation_reads")
      .upsert({ conversation_id: params.conversationId, profile_id: me.id, last_read_at: new Date().toISOString() }, { onConflict: "conversation_id,profile_id" });

    setLoading(false);
  }, [params.conversationId, router, loadTaskPreviews]);

  useEffect(() => {
    async function run() {
      await load();
    }
    run();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`conversation-messages:${params.conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${params.conversationId}` },
        async (payload) => {
          const { data: author } = await supabase.from("profiles").select("id, full_name, username, email").eq("id", (payload.new as { author_id: string }).author_id).maybeSingle();
          const row = { ...(payload.new as MessageRow), author: author ?? null };
          // The sender's own load() call after posting (used to also refresh
          // attachments/read-state) can race this realtime echo of the same
          // insert -- whichever arrives second must not add a second copy.
          setMessages((current) => (current.some((m) => m.id === row.id) ? current : [...current, row]));
          loadTaskPreviews([row.body]);

          // Without this, a message arriving while this conversation is
          // already open would still leave it showing "unread" in the
          // sidebar until the page was left and reopened.
          const me = await getProfile();
          if (me) {
            await supabase
              .from("conversation_reads")
              .upsert({ conversation_id: params.conversationId, profile_id: me.id, last_read_at: new Date().toISOString() }, { onConflict: "conversation_id,profile_id" });
          }
        }
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (payload) => {
        const row = payload.new as Reaction;
        // Same race as messages: toggleReaction() already appends its own
        // optimistic copy locally, so skip this one if it's already there.
        setReactions((current) => (current.some((r) => r.id === row.id) ? current : [...current, row]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
        setReactions((current) => current.filter((r) => r.id !== (payload.old as Reaction).id));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [params.conversationId, loadTaskPreviews]);

  const topLevelMessages = messages.filter((m) => !m.reply_to_message_id);
  const activeThread = activeThreadId ? messages.find((m) => m.id === activeThreadId) ?? null : null;
  const threadReplies = activeThreadId ? messages.filter((m) => m.reply_to_message_id === activeThreadId) : [];

  function replyCount(messageId: string) {
    return messages.filter((m) => m.reply_to_message_id === messageId).length;
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [topLevelMessages.length]);

  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadReplies.length, activeThreadId]);

  function onBodyChange(value: string) {
    setBody(value);
    const atMatch = value.match(/@([^\s@]*)$/);
    const hashMatch = value.match(/#([^\s#]*)$/);
    if (atMatch) {
      const q = atMatch[1].toLowerCase();
      setSuggestMentions(directory.filter((p) => (p.full_name || p.email).toLowerCase().includes(q)).slice(0, 6));
    } else {
      setSuggestMentions([]);
    }
    if (hashMatch) {
      const q = hashMatch[1].toLowerCase();
      supabase
        .from("tasks")
        .select("id, title")
        .ilike("title", `%${q}%`)
        .limit(6)
        .then(({ data }) => setSuggestTasks((data ?? []) as TaskSuggestion[]));
    } else {
      setSuggestTasks([]);
    }
  }

  function pickMention(person: DirectoryPerson) {
    setBody((current) => current.replace(/@([^\s@]*)$/, `@${person.full_name || person.email} `));
    setMentionedIds((current) => (current.includes(person.id) ? current : [...current, person.id]));
    setSuggestMentions([]);
  }

  function pickTask(task: TaskSuggestion) {
    setBody((current) => current.replace(/#([^\s#]*)$/, `${taskToken(task.id)} `));
    setSuggestTasks([]);
  }

  // Returns the inserted row (not just ok/error) so the caller can append it
  // to local state directly instead of re-fetching everything.
  async function uploadMessageAttachment(messageId: string, file: File): Promise<Attachment | null> {
    if (!profile) return null;
    const path = `${profile.organization_id}/messages/${params.conversationId}/${messageId}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await uploadFileWithRetry("org-drive", path, file);
    if (uploadErr) return null;
    const { data, error: insertErr } = await supabase
      .from("message_attachments")
      .insert({
        message_id: messageId,
        uploaded_by: profile.id,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        content_type: file.type || null,
      })
      .select("id, message_id, storage_path, file_name, file_size, content_type")
      .single();
    if (insertErr) return null;
    return data as Attachment;
  }

  function markRead() {
    if (!profile) return;
    supabase
      .from("conversation_reads")
      .upsert({ conversation_id: params.conversationId, profile_id: profile.id, last_read_at: new Date().toISOString() }, { onConflict: "conversation_id,profile_id" });
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    // An attachment alone is a valid message -- WhatsApp-style, no caption required.
    if (!profile || (!body.trim() && pendingFiles.length === 0)) return;
    setSending(true);
    setError("");

    const trimmedBody = body.trim();
    const { data: newId, error: sendError } = await supabase.rpc("post_message", {
      p_conversation_id: params.conversationId,
      p_body: trimmedBody,
      p_mentioned_ids: mentionedIds,
    });

    if (sendError || !newId) {
      setSending(false);
      setError(sendError?.message ?? "Could not send the message.");
      return;
    }

    // Append locally right away instead of re-fetching the whole
    // conversation (messages, every attachment, every reaction, the
    // directory) on every single send -- that full reload was the main
    // source of visible lag, and re-mounted every image thumbnail from
    // scratch each time too. The realtime echo of this same insert (see
    // the subscription above) already knows to skip it once it's here.
    const optimisticMessage: MessageRow = {
      id: newId,
      conversation_id: params.conversationId,
      author_id: profile.id,
      body: trimmedBody,
      created_at: new Date().toISOString(),
      reply_to_message_id: null,
      author: { id: profile.id, full_name: profile.full_name, username: profile.username, email: profile.email },
    };
    setMessages((current) => (current.some((m) => m.id === newId) ? current : [...current, optimisticMessage]));
    if (trimmedBody) loadTaskPreviews([trimmedBody]);

    if (pendingFiles.length > 0) {
      const uploaded = await Promise.all(pendingFiles.map((file) => uploadMessageAttachment(newId, file)));
      const newAttachments = uploaded.filter((a): a is Attachment => a !== null);
      if (newAttachments.length > 0) setAttachments((current) => [...current, ...newAttachments]);
    }

    markRead();
    setBody("");
    setMentionedIds([]);
    setPendingFiles([]);
    setSending(false);
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !activeThreadId || (!replyBody.trim() && pendingReplyFiles.length === 0)) return;
    setReplySending(true);

    const trimmedBody = replyBody.trim();
    const { data: newId, error: sendError } = await supabase.rpc("post_message", {
      p_conversation_id: params.conversationId,
      p_body: trimmedBody,
      p_reply_to_message_id: activeThreadId,
    });

    if (sendError || !newId) {
      setReplySending(false);
      setError(sendError?.message ?? "Could not send the reply.");
      return;
    }

    const optimisticReply: MessageRow = {
      id: newId,
      conversation_id: params.conversationId,
      author_id: profile.id,
      body: trimmedBody,
      created_at: new Date().toISOString(),
      reply_to_message_id: activeThreadId,
      author: { id: profile.id, full_name: profile.full_name, username: profile.username, email: profile.email },
    };
    setMessages((current) => (current.some((m) => m.id === newId) ? current : [...current, optimisticReply]));
    if (trimmedBody) loadTaskPreviews([trimmedBody]);

    if (pendingReplyFiles.length > 0) {
      const uploaded = await Promise.all(pendingReplyFiles.map((file) => uploadMessageAttachment(newId, file)));
      const newAttachments = uploaded.filter((a): a is Attachment => a !== null);
      if (newAttachments.length > 0) setAttachments((current) => [...current, ...newAttachments]);
    }

    markRead();
    setReplyBody("");
    setPendingReplyFiles([]);
    setReplySending(false);
  }

  function addFiles(list: FileList | File[]) {
    setPendingFiles((current) => [...current, ...Array.from(list)]);
  }

  function addReplyFiles(list: FileList | File[]) {
    setPendingReplyFiles((current) => [...current, ...Array.from(list)]);
  }

  // Enter sends (matches every chat app); Shift+Enter still inserts a
  // newline. Submitting the form itself (rather than calling the handler
  // directly) keeps this in sync with the disabled/validation state on the
  // Send button.
  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!profile) return;
    const existing = reactions.find((r) => r.message_id === messageId && r.profile_id === profile.id && r.emoji === emoji);
    if (existing) {
      await supabase.from("message_reactions").delete().eq("id", existing.id);
      setReactions((current) => current.filter((r) => r.id !== existing.id));
    } else {
      const { data } = await supabase
        .from("message_reactions")
        .insert({ message_id: messageId, profile_id: profile.id, emoji })
        .select("id, message_id, profile_id, emoji")
        .maybeSingle();
      if (data) setReactions((current) => [...current, data as Reaction]);
    }
  }

  const preview = useFilePreview();

  async function downloadFile(attachment: Attachment) {
    const { data } = await supabase.storage.from("org-drive").createSignedUrl(attachment.storage_path, 60);
    if (data) preview.open({ url: data.signedUrl, name: attachment.file_name, contentType: attachment.content_type });
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-500">
        This conversation doesn&apos;t exist, or you don&apos;t have access to it.
      </div>
    );
  }

  const canPost = conversationType !== "announcement" || profile.role === "org_super_admin";

  return (
    <div className="flex h-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {topLevelMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isMe={message.author_id === profile.id}
              attachments={attachments.filter((a) => a.message_id === message.id)}
              reactions={reactions.filter((r) => r.message_id === message.id)}
              myProfileId={profile.id}
              taskPreviews={taskPreviews}
              onOpenTask={(id) => router.push(`/tasks/${id}`)}
              onToggleReaction={(emoji) => toggleReaction(message.id, emoji)}
              onDownloadFile={downloadFile}
              replyCount={replyCount(message.id)}
              onOpenThread={() => setActiveThreadId(message.id)}
            />
          ))}
          {topLevelMessages.length === 0 && <p className="text-center text-sm text-[var(--text-tertiary)]">No messages yet. Say hello.</p>}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--divider)] p-3">
          {!canPost ? (
            <p className="text-center text-xs font-semibold text-[var(--text-tertiary)]">Only the Organization Super Admin can post to Announcements.</p>
          ) : (
            <form
              onSubmit={sendMessage}
              className={`space-y-2 rounded-xl transition ${dragOver ? "ring-2 ring-[#8b5cf6] ring-offset-2 ring-offset-[var(--background)]" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); }}
            >
              <div className="relative">
                {suggestMentions.length > 0 && (
                  <div className="absolute bottom-full mb-1 w-full max-w-xs glass-panel shadow-lg">
                    {suggestMentions.map((p) => (
                      <button key={p.id} type="button" onClick={() => pickMention(p)} className="block w-full border-0 bg-transparent px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer">
                        {p.full_name || p.email}
                      </button>
                    ))}
                  </div>
                )}
                {suggestTasks.length > 0 && (
                  <div className="absolute bottom-full mb-1 w-full max-w-xs glass-panel shadow-lg">
                    {suggestTasks.map((t) => (
                      <button key={t.id} type="button" onClick={() => pickTask(t)} className="block w-full border-0 bg-transparent px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer">
                        {t.title}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  value={body}
                  onChange={(e) => onBodyChange(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  rows={2}
                  placeholder="Message... use @ to mention, # to reference a task, Enter to send"
                  className="w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b5cf6] focus:ring-4 focus:ring-[#8b5cf6]/20 backdrop-blur-xl"
                />
              </div>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pendingFiles.map((file, i) => (
                    <div key={`${file.name}-${file.lastModified}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                      <span className="max-w-[180px] truncate">📎 {file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        onClick={() => setPendingFiles((current) => current.filter((_, idx) => idx !== i))}
                        className="shrink-0 border-0 bg-transparent text-[var(--text-tertiary)] hover:text-red-500 cursor-pointer"
                        aria-label={`Remove ${file.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach images, videos, or files (or drag & drop them here)"
                  aria-label="Attach files"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:text-primary hover:border-primary/40 cursor-pointer transition"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>
                <Button type="submit" disabled={sending || (!body.trim() && pendingFiles.length === 0)}>
                  {sending ? "Sending..." : "Send"}
                </Button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </form>
          )}
        </div>
      </div>

      {activeThread && (
        <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-[var(--divider)]">
          <div className="flex items-center justify-between border-b border-[var(--divider)] p-3">
            <p className="text-sm font-bold text-[var(--text-primary)]">Thread</p>
            <button type="button" onClick={() => setActiveThreadId(null)} className="grid h-7 w-7 place-items-center rounded-lg border-0 bg-transparent text-[var(--text-tertiary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] cursor-pointer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            <MessageBubble
              message={activeThread}
              isMe={activeThread.author_id === profile.id}
              attachments={attachments.filter((a) => a.message_id === activeThread.id)}
              reactions={reactions.filter((r) => r.message_id === activeThread.id)}
              myProfileId={profile.id}
              taskPreviews={taskPreviews}
              onOpenTask={(id) => router.push(`/tasks/${id}`)}
              onToggleReaction={(emoji) => toggleReaction(activeThread.id, emoji)}
              onDownloadFile={downloadFile}
              compact
            />
            <div className="border-t border-[var(--divider)] pt-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                {threadReplies.length} repl{threadReplies.length === 1 ? "y" : "ies"}
              </p>
              <div className="space-y-3">
                {threadReplies.map((reply) => (
                  <MessageBubble
                    key={reply.id}
                    message={reply}
                    isMe={reply.author_id === profile.id}
                    attachments={attachments.filter((a) => a.message_id === reply.id)}
                    reactions={reactions.filter((r) => r.message_id === reply.id)}
                    myProfileId={profile.id}
                    taskPreviews={taskPreviews}
                    onOpenTask={(id) => router.push(`/tasks/${id}`)}
                    onToggleReaction={(emoji) => toggleReaction(reply.id, emoji)}
                    onDownloadFile={downloadFile}
                    compact
                  />
                ))}
              </div>
            </div>
            <div ref={threadBottomRef} />
          </div>
          {canPost && (
            <form
              onSubmit={sendReply}
              className={`border-t border-[var(--divider)] p-3 transition ${replyDragOver ? "ring-2 ring-inset ring-[#8b5cf6]" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setReplyDragOver(true); }}
              onDragLeave={() => setReplyDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setReplyDragOver(false); if (e.dataTransfer.files.length > 0) addReplyFiles(e.dataTransfer.files); }}
            >
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={2}
                placeholder="Reply in thread... Enter to send"
                className="w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] p-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b5cf6] focus:ring-4 focus:ring-[#8b5cf6]/20 backdrop-blur-xl"
              />
              {pendingReplyFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pendingReplyFiles.map((file, i) => (
                    <div key={`${file.name}-${file.lastModified}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                      <span className="max-w-[140px] truncate">📎 {file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        onClick={() => setPendingReplyFiles((current) => current.filter((_, idx) => idx !== i))}
                        className="shrink-0 border-0 bg-transparent text-[var(--text-tertiary)] hover:text-red-500 cursor-pointer"
                        aria-label={`Remove ${file.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={replyFileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => { if (e.target.files) addReplyFiles(e.target.files); e.target.value = ""; }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => replyFileInputRef.current?.click()}
                  title="Attach images, videos, or files (or drag & drop them here)"
                  aria-label="Attach files"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:text-primary hover:border-primary/40 cursor-pointer transition"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>
                <Button type="submit" disabled={replySending || (!replyBody.trim() && pendingReplyFiles.length === 0)} className="h-9 flex-1">
                  {replySending ? "Sending..." : "Reply"}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      <FilePreviewModal target={preview.target} onClose={preview.close} />
    </div>
  );
}

function MessageBubble({
  message,
  isMe,
  attachments,
  reactions,
  myProfileId,
  taskPreviews,
  onOpenTask,
  onToggleReaction,
  onDownloadFile,
  replyCount,
  onOpenThread,
  compact,
}: {
  message: MessageRow;
  isMe: boolean;
  attachments: Attachment[];
  reactions: Reaction[];
  myProfileId: string;
  taskPreviews: Record<string, TaskPreview | null>;
  onOpenTask: (id: string) => void;
  onToggleReaction: (emoji: string) => void;
  onDownloadFile: (attachment: Attachment) => void;
  replyCount?: number;
  onOpenThread?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${!compact && isMe ? "flex-row-reverse" : ""}`}>
      <Avatar name={personLabel(message.author)} size="sm" />
      <div className={`min-w-0 ${compact ? "flex-1" : "max-w-[72%]"} ${!compact && isMe ? "items-end text-right" : ""}`}>
        <p className="text-xs font-semibold text-[var(--text-secondary)]">
          {personLabel(message.author)} · {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
        {message.body.trim().length > 0 && (
          <div className={`mt-1 inline-block rounded-2xl px-4 py-2.5 text-sm ${!compact && isMe ? "bg-gradient-to-r from-[#8b5cf6] to-[#ec4899] text-white shadow-[0_4px_12px_rgba(139,92,246,0.25)]" : "bg-[var(--surface-soft)] border border-[var(--glass-border-soft)] text-[var(--text-primary)]"}`}>
            {parseMessageBody(message.body).map((segment, i) =>
              segment.type === "text" ? (
                <span key={i} className="whitespace-pre-wrap">{segment.value}</span>
              ) : (
                <TaskChip key={i} preview={taskPreviews[segment.id]} onOpen={() => onOpenTask(segment.id)} />
              )
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {attachments.map((a) =>
              isImage(a.content_type, a.file_name) ? (
                <ImageAttachment key={a.id} attachment={a} onOpen={() => onDownloadFile(a)} />
              ) : (
                <button key={a.id} type="button" onClick={() => onDownloadFile(a)} className="block text-xs font-semibold text-primary hover:underline bg-transparent border-0 cursor-pointer">
                  📎 {a.file_name} ({(a.file_size / 1024).toFixed(0)} KB)
                </button>
              )
            )}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {REACTION_EMOJI.map((emoji) => {
            const count = reactions.filter((r) => r.emoji === emoji).length;
            if (count === 0) return null;
            const mine = reactions.some((r) => r.emoji === emoji && r.profile_id === myProfileId);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onToggleReaction(emoji)}
                className={`rounded-full border border-[var(--glass-border-soft)] px-2 py-0.5 text-xs transition cursor-pointer ${mine ? "bg-[#8b5cf6] text-white" : "bg-[var(--surface-soft)] text-[var(--text-secondary)]"}`}
              >
                {emoji} {count}
              </button>
            );
          })}
          <ReactionPicker onPick={onToggleReaction} />
          {onOpenThread && (
            <button
              type="button"
              onClick={onOpenThread}
              className="rounded-full border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-primary transition cursor-pointer"
            >
              {replyCount && replyCount > 0 ? `💬 ${replyCount} repl${replyCount === 1 ? "y" : "ies"}` : "💬 Reply"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Renders a real <img> (not just a "download" link) so the browser's native
// right-click "Copy image" / "Save image as" works directly on it, the same
// way it does on an inline WhatsApp image -- the signed URL is fetched once
// per attachment since the private org-drive bucket has no public URLs.
function ImageAttachment({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from("org-drive")
      .createSignedUrl(attachment.storage_path, 3600)
      .then(({ data }) => {
        if (!cancelled && data) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  if (!url) {
    return <div className="grid h-28 w-28 place-items-center rounded-lg border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] text-[10px] text-[var(--text-tertiary)]">Loading…</div>;
  }

  return (
    <button type="button" onClick={onOpen} className="block cursor-pointer overflow-hidden rounded-lg border-0 bg-transparent p-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase Storage URL, next/image can't proxy this */}
      <img src={url} alt={attachment.file_name} className="max-h-52 max-w-[220px] rounded-lg object-cover" />
    </button>
  );
}

function TaskChip({ preview, onOpen }: { preview: TaskPreview | null | undefined; onOpen: () => void }) {
  if (preview === undefined) return <Badge tone="neutral">Loading task...</Badge>;
  if (preview === null) return <Badge tone="neutral">Task unavailable</Badge>;
  return (
    <button type="button" onClick={onOpen} className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold underline cursor-pointer">
      {preview.title} ({preview.status.replace("_", " ")})
    </button>
  );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-full border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer">
        +
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 flex gap-1 rounded-full glass-panel p-1 shadow-lg">
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              className="rounded-full px-1.5 py-0.5 text-sm border-0 bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
