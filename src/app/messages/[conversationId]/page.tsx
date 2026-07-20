"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { Button, Badge, Avatar } from "@/components/ui";
import { parseMessageBody, taskToken, REACTION_EMOJI, type ConversationType } from "@/lib/messaging";

type PersonRef = { id: string; full_name: string | null; email: string } | null;
type MessageRow = {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: PersonRef;
};
type Attachment = { id: string; message_id: string; storage_path: string; file_name: string; file_size: number };
type Reaction = { id: string; message_id: string; profile_id: string; emoji: string };
type TaskPreview = { id: string; title: string; status: string };
type DirectoryPerson = { id: string; full_name: string | null; email: string };
type TaskSuggestion = { id: string; title: string };

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

  const [body, setBody] = useState("");
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [suggestMentions, setSuggestMentions] = useState<DirectoryPerson[]>([]);
  const [suggestTasks, setSuggestTasks] = useState<TaskSuggestion[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

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
      .select("id, conversation_id, author_id, body, created_at, author:profiles(id,full_name,email)")
      .eq("conversation_id", params.conversationId)
      .order("created_at", { ascending: true });
    const rows = (messageRows ?? []) as unknown as MessageRow[];
    setMessages(rows);
    loadTaskPreviews(rows.map((r) => r.body));

    const messageIds = rows.map((r) => r.id);
    if (messageIds.length > 0) {
      const [{ data: attachmentRows }, { data: reactionRows }] = await Promise.all([
        supabase.from("message_attachments").select("id, message_id, storage_path, file_name, file_size").in("message_id", messageIds),
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
          const { data: author } = await supabase.from("profiles").select("id, full_name, email").eq("id", (payload.new as { author_id: string }).author_id).maybeSingle();
          const row = { ...(payload.new as MessageRow), author: author ?? null };
          setMessages((current) => [...current, row]);
          loadTaskPreviews([row.body]);
        }
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (payload) => {
        setReactions((current) => [...current, payload.new as Reaction]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
        setReactions((current) => current.filter((r) => r.id !== (payload.old as Reaction).id));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [params.conversationId, loadTaskPreviews]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !body.trim()) return;
    setSending(true);
    setError("");

    const { data: newId, error: sendError } = await supabase.rpc("post_message", {
      p_conversation_id: params.conversationId,
      p_body: body.trim(),
      p_mentioned_ids: mentionedIds,
    });

    if (sendError || !newId) {
      setSending(false);
      setError(sendError?.message ?? "Could not send the message.");
      return;
    }

    if (pendingFile && profile) {
      const path = `${profile.organization_id}/messages/${params.conversationId}/${newId}/${Date.now()}-${pendingFile.name}`;
      const { error: uploadErr } = await supabase.storage.from("org-drive").upload(path, pendingFile);
      if (!uploadErr) {
        await supabase.from("message_attachments").insert({
          message_id: newId,
          uploaded_by: profile.id,
          storage_path: path,
          file_name: pendingFile.name,
          file_size: pendingFile.size,
          content_type: pendingFile.type || null,
        });
      }
    }

    setBody("");
    setMentionedIds([]);
    setPendingFile(null);
    setSending(false);
    load();
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

  async function downloadFile(attachment: Attachment) {
    const { data } = await supabase.storage.from("org-drive").createSignedUrl(attachment.storage_path, 60);
    if (data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
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

  const canPost = conversationType !== "announcement" || profile.role === "super_admin";

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) => {
          const isMe = message.author_id === profile.id;
          const msgAttachments = attachments.filter((a) => a.message_id === message.id);
          const msgReactions = reactions.filter((r) => r.message_id === message.id);
          return (
            <div key={message.id} className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""}`}>
              <Avatar name={message.author?.full_name || message.author?.email || "?"} size="sm" />
              <div className={`max-w-[72%] ${isMe ? "items-end text-right" : ""}`}>
                <p className="text-xs font-semibold text-slate-500">
                  {message.author?.full_name || message.author?.email} · {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className={`mt-1 inline-block rounded-2xl px-4 py-2.5 text-sm ${isMe ? "bg-primary text-white" : "bg-slate-100 text-slate-800"}`}>
                  {parseMessageBody(message.body).map((segment, i) =>
                    segment.type === "text" ? (
                      <span key={i} className="whitespace-pre-wrap">{segment.value}</span>
                    ) : (
                      <TaskChip key={i} preview={taskPreviews[segment.id]} onOpen={() => router.push(`/tasks/${segment.id}`)} />
                    )
                  )}
                </div>
                {msgAttachments.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {msgAttachments.map((a) => (
                      <button key={a.id} type="button" onClick={() => downloadFile(a)} className="block text-xs font-semibold text-primary hover:underline">
                        📎 {a.file_name} ({(a.file_size / 1024).toFixed(0)} KB)
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {REACTION_EMOJI.map((emoji) => {
                    const count = msgReactions.filter((r) => r.emoji === emoji).length;
                    if (count === 0) return null;
                    const mine = msgReactions.some((r) => r.emoji === emoji && r.profile_id === profile.id);
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleReaction(message.id, emoji)}
                        className={`rounded-full border px-2 py-0.5 text-xs ${mine ? "border-primary bg-primary-light" : "border-slate-200 bg-white"}`}
                      >
                        {emoji} {count}
                      </button>
                    );
                  })}
                  <ReactionPicker onPick={(emoji) => toggleReaction(message.id, emoji)} />
                </div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && <p className="text-center text-sm text-slate-400">No messages yet. Say hello.</p>}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 p-3">
        {!canPost ? (
          <p className="text-center text-xs font-semibold text-slate-400">Only the Super Admin can post to Announcements.</p>
        ) : (
          <form onSubmit={sendMessage} className="space-y-2">
            <div className="relative">
              {suggestMentions.length > 0 && (
                <div className="absolute bottom-full mb-1 w-full max-w-xs rounded-lg border border-slate-200 bg-white shadow-lg">
                  {suggestMentions.map((p) => (
                    <button key={p.id} type="button" onClick={() => pickMention(p)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                      {p.full_name || p.email}
                    </button>
                  ))}
                </div>
              )}
              {suggestTasks.length > 0 && (
                <div className="absolute bottom-full mb-1 w-full max-w-xs rounded-lg border border-slate-200 bg-white shadow-lg">
                  {suggestTasks.map((t) => (
                    <button key={t.id} type="button" onClick={() => pickTask(t)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                      {t.title}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
                rows={2}
                placeholder="Message... use @ to mention, # to reference a task"
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-primary focus:ring-4 focus:ring-primary-light"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <input type="file" onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)} className="text-xs" />
              <Button type="submit" disabled={sending || !body.trim()}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

function TaskChip({ preview, onOpen }: { preview: TaskPreview | null | undefined; onOpen: () => void }) {
  if (preview === undefined) return <Badge tone="neutral">Loading task...</Badge>;
  if (preview === null) return <Badge tone="neutral">Task unavailable</Badge>;
  return (
    <button type="button" onClick={onOpen} className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold underline">
      {preview.title} ({preview.status.replace("_", " ")})
    </button>
  );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-400 hover:text-slate-700">
        +
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 flex gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-lg">
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              className="rounded-full px-1.5 py-0.5 text-sm hover:bg-slate-100"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
