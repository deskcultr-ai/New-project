"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, displayName, type Profile } from "@/lib/session";
import { Button, Badge, Avatar, Modal, Alert } from "@/components/ui";
import { FilePreviewModal, useFilePreview, isImage, isVideo, isAudio } from "@/components/file-preview";
import { uploadFileWithProgress } from "@/lib/storage-upload";
import { parseMessageBody, taskToken, formatDayLabel, REACTION_EMOJI, type ConversationType } from "@/lib/messaging";

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const GROUP_GAP_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;

type PersonRef = { id: string; full_name: string | null; username: string | null; email: string } | null;
type MessageRow = {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_for_everyone: boolean;
  reply_to_message_id: string | null;
  author: PersonRef;
};
type Attachment = { id: string; message_id: string; storage_path: string; file_name: string; file_size: number; content_type: string | null };
type Reaction = { id: string; message_id: string; profile_id: string; emoji: string };
type MessageRead = { message_id: string; profile_id: string; read_at: string };
type MessagePin = { id: string; conversation_id: string; message_id: string; pinned_by: string | null; pinned_at: string };
type TaskPreview = { id: string; title: string; status: string };
type DirectoryPerson = { id: string; full_name: string | null; email: string };
type TaskSuggestion = { id: string; title: string };
type ForwardTarget = { id: string; label: string };
type ConversationRow = { id: string; type: ConversationType; department_id: string | null; dm_profile_a: string | null; dm_profile_b: string | null };
type SearchHit = { id: string; body: string; created_at: string; author: PersonRef };

function fileKey(file: File): string {
  return `${file.name}-${file.lastModified}-${file.size}`;
}

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
  const [reads, setReads] = useState<MessageRead[]>([]);
  const [pins, setPins] = useState<MessagePin[]>([]);
  const [taskPreviews, setTaskPreviews] = useState<Record<string, TaskPreview | null>>({});
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);
  const [forwardTargets, setForwardTargets] = useState<ForwardTarget[]>([]);
  const [forwardBusy, setForwardBusy] = useState(false);

  const [typingNames, setTypingNames] = useState<Map<string, string>>(new Map());
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingSentRef = useRef(0);
  const stopTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
  const suppressAutoScrollRef = useRef(false);

  const [replyBody, setReplyBody] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [pendingReplyFiles, setPendingReplyFiles] = useState<File[]>([]);
  const [replyDragOver, setReplyDragOver] = useState(false);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);

  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());

  // Pagination: only the most recent PAGE_SIZE messages load up front; the
  // sentinel/IntersectionObserver below fetches older batches on demand.
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const oldestLoadedAtRef = useRef<string | null>(null);
  const hasMoreOlderRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const prependScrollAnchorRef = useRef<number | null>(null);
  const [hasMoreOlder, setHasMoreOlderState] = useState(true);
  const [loadingOlder, setLoadingOlderState] = useState(false);
  function setHasMoreOlder(value: boolean) {
    hasMoreOlderRef.current = value;
    setHasMoreOlderState(value);
  }
  function setLoadingOlder(value: boolean) {
    loadingOlderRef.current = value;
    setLoadingOlderState(value);
  }

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  function flashError(message: string) {
    setActionError(message);
    setTimeout(() => setActionError(""), 4000);
  }

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
      .select("id, conversation_id, author_id, body, created_at, edited_at, deleted_at, deleted_for_everyone, reply_to_message_id, author:profiles(id,full_name,username,email)")
      .eq("conversation_id", params.conversationId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    const allRows = ((messageRows ?? []) as unknown as MessageRow[]).slice().reverse();
    setHasMoreOlder(allRows.length === PAGE_SIZE);
    oldestLoadedAtRef.current = allRows[0]?.created_at ?? null;

    const { data: hiddenRows } = await supabase.from("message_hidden_for").select("message_id").eq("profile_id", me.id);
    const hiddenSet = new Set((hiddenRows ?? []).map((r) => r.message_id as string));
    const rows = allRows.filter((r) => !hiddenSet.has(r.id));
    setMessages(rows);
    loadTaskPreviews(rows.map((r) => r.body));

    const messageIds = allRows.map((r) => r.id);
    if (messageIds.length > 0) {
      const [{ data: attachmentRows }, { data: reactionRows }, { data: readRows }] = await Promise.all([
        supabase.from("message_attachments").select("id, message_id, storage_path, file_name, file_size, content_type").in("message_id", messageIds),
        supabase.from("message_reactions").select("id, message_id, profile_id, emoji").in("message_id", messageIds),
        supabase.from("message_reads").select("message_id, profile_id, read_at").in("message_id", messageIds),
      ]);
      setAttachments((attachmentRows ?? []) as Attachment[]);
      setReactions((reactionRows ?? []) as Reaction[]);
      setReads((readRows ?? []) as MessageRead[]);
    } else {
      setAttachments([]);
      setReactions([]);
      setReads([]);
    }

    const { data: pinRows } = await supabase
      .from("message_pins")
      .select("id, conversation_id, message_id, pinned_by, pinned_at")
      .eq("conversation_id", params.conversationId);
    setPins((pinRows ?? []) as MessagePin[]);

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

  // Fetches the next PAGE_SIZE messages older than the earliest one
  // currently loaded, merges them in, and anchors scroll position so the
  // view doesn't jump (see the useLayoutEffect below). Guards read off
  // refs (not state) so this stays a stable callback the sentinel observer
  // effect doesn't need to keep re-subscribing.
  const loadOlderMessages = useCallback(async () => {
    if (!hasMoreOlderRef.current || loadingOlderRef.current || !oldestLoadedAtRef.current) return;
    setLoadingOlder(true);
    const earliest = oldestLoadedAtRef.current;
    const me = await getProfile();

    const { data: olderRows } = await supabase
      .from("messages")
      .select("id, conversation_id, author_id, body, created_at, edited_at, deleted_at, deleted_for_everyone, reply_to_message_id, author:profiles(id,full_name,username,email)")
      .eq("conversation_id", params.conversationId)
      .lt("created_at", earliest)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    const rows = ((olderRows ?? []) as unknown as MessageRow[]).slice().reverse();
    if (rows.length < PAGE_SIZE) setHasMoreOlder(false);
    if (rows.length === 0) {
      setLoadingOlder(false);
      return;
    }

    const hiddenSet = new Set<string>();
    if (me) {
      const { data: hiddenRows } = await supabase
        .from("message_hidden_for")
        .select("message_id")
        .eq("profile_id", me.id)
        .in("message_id", rows.map((r) => r.id));
      for (const h of hiddenRows ?? []) hiddenSet.add(h.message_id as string);
    }
    const visibleRows = rows.filter((r) => !hiddenSet.has(r.id));
    oldestLoadedAtRef.current = rows[0]?.created_at ?? oldestLoadedAtRef.current;

    const messageIds = rows.map((r) => r.id);
    const [{ data: attachmentRows }, { data: reactionRows }, { data: readRows }] = await Promise.all([
      supabase.from("message_attachments").select("id, message_id, storage_path, file_name, file_size, content_type").in("message_id", messageIds),
      supabase.from("message_reactions").select("id, message_id, profile_id, emoji").in("message_id", messageIds),
      supabase.from("message_reads").select("message_id, profile_id, read_at").in("message_id", messageIds),
    ]);

    suppressAutoScrollRef.current = true;
    prependScrollAnchorRef.current = messagesContainerRef.current?.scrollHeight ?? null;

    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      return [...visibleRows.filter((r) => !known.has(r.id)), ...current];
    });
    setAttachments((current) => {
      const known = new Set(current.map((a) => a.id));
      return [...current, ...((attachmentRows ?? []) as Attachment[]).filter((a) => !known.has(a.id))];
    });
    setReactions((current) => {
      const known = new Set(current.map((r) => r.id));
      return [...current, ...((reactionRows ?? []) as Reaction[]).filter((r) => !known.has(r.id))];
    });
    setReads((current) => {
      const known = new Set(current.map((r) => `${r.message_id}:${r.profile_id}`));
      return [...current, ...((readRows ?? []) as MessageRead[]).filter((r) => !known.has(`${r.message_id}:${r.profile_id}`))];
    });

    setLoadingOlder(false);
  }, [params.conversationId]);

  // Runs synchronously after the prepended (older) messages are committed to
  // the DOM but before the browser paints, so the scrollbar never visibly
  // jumps -- the standard fix for "load older content above the viewport."
  useLayoutEffect(() => {
    if (prependScrollAnchorRef.current === null) return;
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop += container.scrollHeight - prependScrollAnchorRef.current;
    }
    prependScrollAnchorRef.current = null;
  }, [messages]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadOlderMessages();
      },
      { root: messagesContainerRef.current, threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadOlderMessages]);

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
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${params.conversationId}` },
        (payload) => {
          const row = payload.new as MessageRow;
          // Edits/deletes come through as UPDATEs -- merge in place rather
          // than replacing the whole row, since this payload has no joined
          // `author` object the way the initial load/INSERT handler does.
          setMessages((current) =>
            current.map((m) =>
              m.id === row.id
                ? { ...m, body: row.body, edited_at: row.edited_at, deleted_at: row.deleted_at, deleted_for_everyone: row.deleted_for_everyone }
                : m
            )
          );
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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reads" }, (payload) => {
        const row = payload.new as MessageRead;
        setReads((current) => (current.some((r) => r.message_id === row.message_id && r.profile_id === row.profile_id) ? current : [...current, row]));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_pins" }, (payload) => {
        const row = payload.new as MessagePin;
        if (row.conversation_id !== params.conversationId) return;
        setPins((current) => (current.some((p) => p.id === row.id) ? current : [...current, row]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_pins" }, (payload) => {
        setPins((current) => current.filter((p) => p.id !== (payload.old as MessagePin).id));
      })
      .on("broadcast", { event: "typing" }, (payload) => {
        const { profileId, name, typing } = payload.payload as { profileId: string; name: string; typing: boolean };
        if (profileId === profile?.id) return;
        const timeouts = typingTimeoutsRef.current;
        const existing = timeouts.get(profileId);
        if (existing) clearTimeout(existing);
        if (!typing) {
          timeouts.delete(profileId);
          setTypingNames((current) => {
            if (!current.has(profileId)) return current;
            const next = new Map(current);
            next.delete(profileId);
            return next;
          });
          return;
        }
        setTypingNames((current) => new Map(current).set(profileId, name));
        timeouts.set(
          profileId,
          setTimeout(() => {
            timeouts.delete(profileId);
            setTypingNames((current) => {
              const next = new Map(current);
              next.delete(profileId);
              return next;
            });
          }, 3000)
        );
      })
      .subscribe();

    channelRef.current = channel;
    const timeouts = typingTimeoutsRef.current;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      timeouts.forEach((t) => clearTimeout(t));
      timeouts.clear();
    };
    // profile.id is intentionally omitted -- the typing broadcast handler
    // reads it via the `profile?.id` closure above, and re-subscribing the
    // whole channel every time profile loads would drop other realtime
    // state; profile is set once per page load, well before anyone types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.conversationId, loadTaskPreviews]);

  // Read receipts: batch-mark every currently-loaded message not authored by
  // me as read, debounced, instead of one write per message per render.
  useEffect(() => {
    if (!profile) return;
    const toMark = messages
      .filter((m) => m.author_id !== profile.id && !m.deleted_for_everyone)
      .filter((m) => !reads.some((r) => r.message_id === m.id && r.profile_id === profile.id))
      .map((m) => m.id);
    if (toMark.length === 0) return;
    const timeout = setTimeout(async () => {
      const rows = toMark.map((id) => ({ message_id: id, profile_id: profile.id }));
      const { error: readErr } = await supabase.from("message_reads").upsert(rows, { onConflict: "message_id,profile_id", ignoreDuplicates: true });
      if (!readErr) {
        setReads((current) => [...current, ...toMark.map((id) => ({ message_id: id, profile_id: profile.id, read_at: new Date().toISOString() }))]);
      }
    }, 600);
    return () => clearTimeout(timeout);
  }, [messages, reads, profile]);

  const topLevelMessages = messages.filter((m) => !m.reply_to_message_id);
  const activeThread = activeThreadId ? messages.find((m) => m.id === activeThreadId) ?? null : null;
  const threadReplies = activeThreadId ? messages.filter((m) => m.reply_to_message_id === activeThreadId) : [];
  const pinnedMessages = pins
    .map((p) => ({ pin: p, message: messages.find((m) => m.id === p.message_id) }))
    .filter((p): p is { pin: MessagePin; message: MessageRow } => !!p.message);

  function replyCount(messageId: string) {
    return messages.filter((m) => m.reply_to_message_id === messageId).length;
  }

  useEffect(() => {
    // A length change caused by loadOlderMessages/jumpToMessage prepending
    // older history must not also scroll to the bottom -- that flag is set
    // right before those merges and consumed here exactly once.
    if (suppressAutoScrollRef.current) {
      suppressAutoScrollRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [topLevelMessages.length]);

  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadReplies.length, activeThreadId]);

  function scrollToMessage(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Drafts: restore on mount / conversation switch, debounce-persist on
  // every change, and let the natural "body becomes empty" transition
  // (already happens on successful send) clear it -- no separate
  // clear-on-send code needed.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(`draft:${params.conversationId}`) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores a locally-persisted draft once per conversation switch
    if (saved) setBody(saved);
  }, [params.conversationId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const key = `draft:${params.conversationId}`;
      if (body) window.localStorage.setItem(key, body);
      else window.localStorage.removeItem(key);
    }, 400);
    return () => clearTimeout(timeout);
  }, [body, params.conversationId]);

  useEffect(() => {
    if (!activeThreadId) return;
    const saved = window.localStorage.getItem(`draft:${params.conversationId}:reply:${activeThreadId}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores a locally-persisted draft once per thread switch
    setReplyBody(saved ?? "");
  }, [activeThreadId, params.conversationId]);

  useEffect(() => {
    if (!activeThreadId) return;
    const timeout = setTimeout(() => {
      const key = `draft:${params.conversationId}:reply:${activeThreadId}`;
      if (replyBody) window.localStorage.setItem(key, replyBody);
      else window.localStorage.removeItem(key);
    }, 400);
    return () => clearTimeout(timeout);
  }, [replyBody, activeThreadId, params.conversationId]);

  // In-conversation search -- scoped to this conversation_id only (the
  // sidebar's search in layout.tsx already covers cross-conversation).
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale results when the search box is cleared/shortened
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, body, created_at, author:profiles(id,full_name,username,email)")
        .eq("conversation_id", params.conversationId)
        .ilike("body", `%${q}%`)
        .order("created_at", { ascending: false })
        .limit(30);
      setSearchResults((data ?? []) as unknown as SearchHit[]);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, searchOpen, params.conversationId]);

  // Jumps to a search hit. If it's already loaded (within the paginated
  // window), just scrolls; otherwise fetches a window of messages around
  // it and merges them in. This can leave a gap between that window and
  // whatever was already loaded -- loadOlderMessages keeps working forward
  // from the new (possibly earlier) oldest-loaded timestamp regardless,
  // it just won't automatically backfill that particular gap.
  async function jumpToMessage(messageId: string, createdAt: string) {
    setSearchOpen(false);
    if (messages.some((m) => m.id === messageId)) {
      requestAnimationFrame(() => scrollToMessage(messageId));
      return;
    }
    const me = await getProfile();
    const columns = "id, conversation_id, author_id, body, created_at, edited_at, deleted_at, deleted_for_everyone, reply_to_message_id, author:profiles(id,full_name,username,email)";
    const [{ data: beforeRows }, { data: afterRows }] = await Promise.all([
      supabase.from("messages").select(columns).eq("conversation_id", params.conversationId).lte("created_at", createdAt).order("created_at", { ascending: false }).limit(15),
      supabase.from("messages").select(columns).eq("conversation_id", params.conversationId).gt("created_at", createdAt).order("created_at", { ascending: true }).limit(15),
    ]);
    const windowRows = [...((beforeRows ?? []) as unknown as MessageRow[]).slice().reverse(), ...((afterRows ?? []) as unknown as MessageRow[])];

    let hiddenSet = new Set<string>();
    if (me) {
      const { data: hiddenRows } = await supabase.from("message_hidden_for").select("message_id").eq("profile_id", me.id).in("message_id", windowRows.map((r) => r.id));
      hiddenSet = new Set((hiddenRows ?? []).map((h) => h.message_id as string));
    }
    const visibleWindow = windowRows.filter((r) => !hiddenSet.has(r.id));
    const messageIds = windowRows.map((r) => r.id);
    const [{ data: attachmentRows }, { data: reactionRows }, { data: readRows }] = await Promise.all([
      supabase.from("message_attachments").select("id, message_id, storage_path, file_name, file_size, content_type").in("message_id", messageIds),
      supabase.from("message_reactions").select("id, message_id, profile_id, emoji").in("message_id", messageIds),
      supabase.from("message_reads").select("message_id, profile_id, read_at").in("message_id", messageIds),
    ]);

    suppressAutoScrollRef.current = true;
    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      const merged = [...current, ...visibleWindow.filter((r) => !known.has(r.id))];
      merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return merged;
    });
    setAttachments((current) => {
      const known = new Set(current.map((a) => a.id));
      return [...current, ...((attachmentRows ?? []) as Attachment[]).filter((a) => !known.has(a.id))];
    });
    setReactions((current) => {
      const known = new Set(current.map((r) => r.id));
      return [...current, ...((reactionRows ?? []) as Reaction[]).filter((r) => !known.has(r.id))];
    });
    setReads((current) => {
      const known = new Set(current.map((r) => `${r.message_id}:${r.profile_id}`));
      return [...current, ...((readRows ?? []) as MessageRead[]).filter((r) => !known.has(`${r.message_id}:${r.profile_id}`))];
    });

    const earliestInWindow = visibleWindow[0]?.created_at;
    if (earliestInWindow && (!oldestLoadedAtRef.current || earliestInWindow < oldestLoadedAtRef.current)) {
      oldestLoadedAtRef.current = earliestInWindow;
    }

    requestAnimationFrame(() => scrollToMessage(messageId));
  }

  function sendTyping(typing: boolean) {
    if (!profile) return;
    channelRef.current?.send({ type: "broadcast", event: "typing", payload: { profileId: profile.id, name: displayName(profile), typing } });
  }

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

    if (!value) {
      if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
      sendTyping(false);
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now;
      sendTyping(true);
    }
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    stopTypingTimeoutRef.current = setTimeout(() => sendTyping(false), 3000);
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
    const key = fileKey(file);
    const path = `${profile.organization_id}/messages/${params.conversationId}/${messageId}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await uploadFileWithProgress("org-drive", path, file, (percent) => {
      setUploadProgress((current) => new Map(current).set(key, percent));
    });
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
    setUploadProgress((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
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
      edited_at: null,
      deleted_at: null,
      deleted_for_everyone: false,
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
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    sendTyping(false);
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
      edited_at: null,
      deleted_at: null,
      deleted_for_everyone: false,
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

  function canEditMessage(message: MessageRow): boolean {
    if (!profile) return false;
    if (message.deleted_for_everyone) return false;
    if (profile.role === "org_super_admin") return true;
    // This is a display-only heuristic -- the RLS policy on `messages` is the
    // actual enforcement of the 15-minute window (server clock, not this
    // one), so an occasionally-stale menu item here has no security effect.
    // eslint-disable-next-line react-hooks/purity -- see comment above
    return message.author_id === profile.id && Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;
  }

  function canDeleteForEveryone(message: MessageRow): boolean {
    return canEditMessage(message);
  }

  function startEdit(message: MessageRow) {
    setEditingId(message.id);
    setEditBody(message.body);
    setOpenMenuId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditBody("");
  }

  async function saveEdit(messageId: string) {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase.from("messages").update({ body: trimmed, edited_at: nowIso }).eq("id", messageId);
    if (updErr) {
      flashError(updErr.message);
      return;
    }
    setMessages((current) => current.map((m) => (m.id === messageId ? { ...m, body: trimmed, edited_at: nowIso } : m)));
    setEditingId(null);
    setEditBody("");
  }

  async function deleteForMe(messageId: string) {
    if (!profile) return;
    if (!window.confirm("Delete this message for you? Others will still see it.")) return;
    const { error: delErr } = await supabase.from("message_hidden_for").insert({ message_id: messageId, profile_id: profile.id });
    if (delErr) {
      flashError(delErr.message);
      return;
    }
    setMessages((current) => current.filter((m) => m.id !== messageId));
    setOpenMenuId(null);
  }

  async function deleteForEveryone(messageId: string) {
    if (!window.confirm("Delete this message for everyone? This cannot be undone.")) return;
    const nowIso = new Date().toISOString();
    const { error: delErr } = await supabase.from("messages").update({ deleted_at: nowIso, deleted_for_everyone: true }).eq("id", messageId);
    if (delErr) {
      flashError(delErr.message);
      return;
    }
    setMessages((current) => current.map((m) => (m.id === messageId ? { ...m, deleted_at: nowIso, deleted_for_everyone: true } : m)));
    setOpenMenuId(null);
  }

  async function togglePin(messageId: string) {
    if (!profile) return;
    setOpenMenuId(null);
    const existing = pins.find((p) => p.message_id === messageId);
    if (existing) {
      await supabase.from("message_pins").delete().eq("id", existing.id);
      setPins((current) => current.filter((p) => p.id !== existing.id));
      return;
    }
    const { data, error: pinErr } = await supabase
      .from("message_pins")
      .insert({ conversation_id: params.conversationId, message_id: messageId, pinned_by: profile.id })
      .select("id, conversation_id, message_id, pinned_by, pinned_at")
      .single();
    if (pinErr) {
      flashError(pinErr.message.includes("at most 3") ? pinErr.message : "Could not pin this message.");
      return;
    }
    if (data) setPins((current) => [...current, data as MessagePin]);
  }

  async function loadForwardTargets() {
    if (!profile) return;
    const [{ data: depts }, { data: convos }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("organization_id", profile.organization_id),
      supabase.from("conversations").select("id, type, department_id, dm_profile_a, dm_profile_b"),
    ]);
    const rows = (convos ?? []) as ConversationRow[];
    const dmOtherIds = rows
      .filter((c) => c.type === "dm")
      .map((c) => (c.dm_profile_a === profile.id ? c.dm_profile_b : c.dm_profile_a))
      .filter((id): id is string => !!id);
    const { data: dmPeople } = dmOtherIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", dmOtherIds)
      : { data: [] as DirectoryPerson[] };
    const deptName = (id: string | null) => (depts ?? []).find((d) => d.id === id)?.name ?? "Department";
    const built: ForwardTarget[] = rows
      .filter((c) => c.id !== params.conversationId)
      .map((c) => {
        if (c.type === "announcement") return { id: c.id, label: "Announcements" };
        if (c.type === "department_channel") return { id: c.id, label: deptName(c.department_id) };
        const otherId = c.dm_profile_a === profile.id ? c.dm_profile_b! : c.dm_profile_a!;
        const other = (dmPeople ?? []).find((p) => p.id === otherId);
        return { id: c.id, label: other?.full_name || other?.email || "Direct message" };
      });
    setForwardTargets(built);
  }

  function openForward(messageId: string) {
    setForwardMessageId(messageId);
    setOpenMenuId(null);
    if (forwardTargets.length === 0) loadForwardTargets();
  }

  async function forwardTo(targetConversationId: string) {
    if (!profile || !forwardMessageId) return;
    const source = messages.find((m) => m.id === forwardMessageId);
    if (!source) return;
    setForwardBusy(true);
    const { data: newId, error: sendErr } = await supabase.rpc("post_message", {
      p_conversation_id: targetConversationId,
      p_body: source.body,
    });
    if (!sendErr && newId) {
      const sourceAttachments = attachments.filter((a) => a.message_id === forwardMessageId);
      if (sourceAttachments.length > 0) {
        await supabase.from("message_attachments").insert(
          sourceAttachments.map((a) => ({
            message_id: newId,
            uploaded_by: profile.id,
            storage_path: a.storage_path,
            file_name: a.file_name,
            file_size: a.file_size,
            content_type: a.content_type,
          }))
        );
      }
    }
    setForwardBusy(false);
    setForwardMessageId(null);
    if (sendErr) flashError(sendErr.message);
  }

  function copyMessageText(text: string) {
    navigator.clipboard?.writeText(text);
    setOpenMenuId(null);
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
  const typingLabel =
    typingNames.size === 0
      ? null
      : typingNames.size === 1
      ? `${Array.from(typingNames.values())[0]} is typing...`
      : `${Array.from(typingNames.values()).join(", ")} are typing...`;

  return (
    <div className="flex h-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {actionError && (
          <Alert tone="danger" className="m-3 mb-0">
            {actionError}
          </Alert>
        )}
        <div className="flex items-center justify-between border-b border-[var(--divider)] px-3 py-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 py-1 text-xs font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            Search
          </button>
        </div>
        {searchOpen && (
          <div className="border-b border-[var(--divider)] p-2.5 space-y-1.5">
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in this conversation..."
              className="w-full rounded-lg border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b5cf6]"
            />
            {searching && <p className="px-1 text-xs text-[var(--text-tertiary)]">Searching...</p>}
            {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <p className="px-1 text-xs text-[var(--text-tertiary)]">No matches.</p>
            )}
            {searchResults.length > 0 && (
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {searchResults.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => jumpToMessage(hit.id, hit.created_at)}
                    className="block w-full rounded-lg border-0 bg-transparent px-2 py-1.5 text-left hover:bg-[var(--surface-soft)] cursor-pointer"
                  >
                    <p className="text-xs font-semibold text-[var(--text-primary)]">
                      {personLabel(hit.author)} · {new Date(hit.created_at).toLocaleDateString()}
                    </p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">{hit.body}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {pinnedMessages.length > 0 && (
          <div className="flex flex-col gap-1 border-b border-[var(--divider)] bg-[var(--surface-soft)] p-2">
            {pinnedMessages.map(({ pin, message }) => (
              <button
                key={pin.id}
                type="button"
                onClick={() => scrollToMessage(message.id)}
                className="flex items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-med)] cursor-pointer"
              >
                <span aria-hidden>📌</span>
                <span className="truncate font-semibold text-[var(--text-primary)]">{personLabel(message.author)}:</span>
                <span className="truncate">{message.deleted_for_everyone ? "This message was deleted" : message.body}</span>
              </button>
            ))}
          </div>
        )}
        <div ref={messagesContainerRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          <div ref={sentinelRef} />
          {loadingOlder && <p className="text-center text-xs text-[var(--text-tertiary)]">Loading older messages...</p>}
          {!hasMoreOlder && messages.length > 0 && (
            <p className="text-center text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Start of conversation</p>
          )}
          {topLevelMessages.map((message, index) => {
            const previous = topLevelMessages[index - 1];
            const dayLabel = formatDayLabel(message.created_at);
            const showSeparator = !previous || dayLabel !== formatDayLabel(previous.created_at);
            const showHeader =
              showSeparator ||
              !previous ||
              previous.author_id !== message.author_id ||
              new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() > GROUP_GAP_MS;
            return (
              <div key={message.id} id={`message-${message.id}`}>
                {showSeparator && (
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-full bg-[var(--surface-soft)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                      {dayLabel}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={message}
                  isMe={message.author_id === profile.id}
                  showHeader={showHeader}
                  attachments={attachments.filter((a) => a.message_id === message.id)}
                  reactions={reactions.filter((r) => r.message_id === message.id)}
                  myProfileId={profile.id}
                  taskPreviews={taskPreviews}
                  onOpenTask={(id) => router.push(`/tasks/${id}`)}
                  onToggleReaction={(emoji) => toggleReaction(message.id, emoji)}
                  onDownloadFile={downloadFile}
                  replyCount={replyCount(message.id)}
                  onOpenThread={() => setActiveThreadId(message.id)}
                  isRead={reads.some((r) => r.message_id === message.id && r.profile_id !== profile.id)}
                  isPinned={pins.some((p) => p.message_id === message.id)}
                  canEdit={canEditMessage(message)}
                  canDeleteForEveryone={canDeleteForEveryone(message)}
                  menuOpen={openMenuId === message.id}
                  onToggleMenu={() => setOpenMenuId((current) => (current === message.id ? null : message.id))}
                  editing={editingId === message.id}
                  editBody={editBody}
                  onEditBodyChange={setEditBody}
                  onStartEdit={() => startEdit(message)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={() => saveEdit(message.id)}
                  onDeleteForMe={() => deleteForMe(message.id)}
                  onDeleteForEveryone={() => deleteForEveryone(message.id)}
                  onTogglePin={() => togglePin(message.id)}
                  onForward={() => openForward(message.id)}
                  onCopy={() => copyMessageText(message.body)}
                />
              </div>
            );
          })}
          {topLevelMessages.length === 0 && <p className="text-center text-sm text-[var(--text-tertiary)]">No messages yet. Say hello.</p>}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--divider)] p-3">
          {typingLabel && <p className="mb-1.5 px-1 text-xs italic text-[var(--text-tertiary)]">{typingLabel}</p>}
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
                  onBlur={() => { if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current); sendTyping(false); }}
                  rows={2}
                  placeholder="Message... use @ to mention, # to reference a task, Enter to send"
                  className="w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b5cf6] focus:ring-4 focus:ring-[#8b5cf6]/20 backdrop-blur-xl"
                />
              </div>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pendingFiles.map((file, i) => (
                    <div key={`${file.name}-${file.lastModified}-${i}`} className="rounded-lg border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                      <div className="flex items-center gap-2">
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
                      {sending && (
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/10">
                          <div className="h-full bg-[#8b5cf6] transition-all" style={{ width: `${uploadProgress.get(fileKey(file)) ?? 0}%` }} />
                        </div>
                      )}
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
              isRead={reads.some((r) => r.message_id === activeThread.id && r.profile_id !== profile.id)}
              isPinned={pins.some((p) => p.message_id === activeThread.id)}
              canEdit={canEditMessage(activeThread)}
              canDeleteForEveryone={canDeleteForEveryone(activeThread)}
              menuOpen={openMenuId === activeThread.id}
              onToggleMenu={() => setOpenMenuId((current) => (current === activeThread.id ? null : activeThread.id))}
              editing={editingId === activeThread.id}
              editBody={editBody}
              onEditBodyChange={setEditBody}
              onStartEdit={() => startEdit(activeThread)}
              onCancelEdit={cancelEdit}
              onSaveEdit={() => saveEdit(activeThread.id)}
              onDeleteForMe={() => deleteForMe(activeThread.id)}
              onDeleteForEveryone={() => deleteForEveryone(activeThread.id)}
              onTogglePin={() => togglePin(activeThread.id)}
              onForward={() => openForward(activeThread.id)}
              onCopy={() => copyMessageText(activeThread.body)}
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
                    isRead={reads.some((r) => r.message_id === reply.id && r.profile_id !== profile.id)}
                    isPinned={pins.some((p) => p.message_id === reply.id)}
                    canEdit={canEditMessage(reply)}
                    canDeleteForEveryone={canDeleteForEveryone(reply)}
                    menuOpen={openMenuId === reply.id}
                    onToggleMenu={() => setOpenMenuId((current) => (current === reply.id ? null : reply.id))}
                    editing={editingId === reply.id}
                    editBody={editBody}
                    onEditBodyChange={setEditBody}
                    onStartEdit={() => startEdit(reply)}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={() => saveEdit(reply.id)}
                    onDeleteForMe={() => deleteForMe(reply.id)}
                    onDeleteForEveryone={() => deleteForEveryone(reply.id)}
                    onTogglePin={() => togglePin(reply.id)}
                    onForward={() => openForward(reply.id)}
                    onCopy={() => copyMessageText(reply.body)}
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
                    <div key={`${file.name}-${file.lastModified}-${i}`} className="rounded-lg border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                      <div className="flex items-center gap-2">
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
                      {replySending && (
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/10">
                          <div className="h-full bg-[#8b5cf6] transition-all" style={{ width: `${uploadProgress.get(fileKey(file)) ?? 0}%` }} />
                        </div>
                      )}
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

      <Modal open={!!forwardMessageId} onClose={() => setForwardMessageId(null)} title="Forward message">
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {forwardTargets.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No other conversations to forward to.</p>}
          {forwardTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              disabled={forwardBusy}
              onClick={() => forwardTo(target.id)}
              className="block w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
            >
              {target.label}
            </button>
          ))}
        </div>
      </Modal>

      <FilePreviewModal target={preview.target} onClose={preview.close} />
    </div>
  );
}

function MessageBubble({
  message,
  isMe,
  showHeader = true,
  attachments,
  reactions,
  myProfileId,
  taskPreviews,
  onOpenTask,
  onToggleReaction,
  onDownloadFile,
  replyCount,
  onOpenThread,
  isRead,
  isPinned,
  canEdit,
  canDeleteForEveryone,
  menuOpen,
  onToggleMenu,
  editing,
  editBody,
  onEditBodyChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  onTogglePin,
  onForward,
  onCopy,
  compact,
}: {
  message: MessageRow;
  isMe: boolean;
  showHeader?: boolean;
  attachments: Attachment[];
  reactions: Reaction[];
  myProfileId: string;
  taskPreviews: Record<string, TaskPreview | null>;
  onOpenTask: (id: string) => void;
  onToggleReaction: (emoji: string) => void;
  onDownloadFile: (attachment: Attachment) => void;
  replyCount?: number;
  onOpenThread?: () => void;
  isRead: boolean;
  isPinned: boolean;
  canEdit: boolean;
  canDeleteForEveryone: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  editing: boolean;
  editBody: string;
  onEditBodyChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onTogglePin: () => void;
  onForward: () => void;
  onCopy: () => void;
  compact?: boolean;
}) {
  if (message.deleted_for_everyone) {
    return (
      <div className={`flex gap-3 ${!compact && isMe ? "flex-row-reverse" : ""}`}>
        {showHeader && <Avatar name={personLabel(message.author)} size="sm" />}
        {!showHeader && <div className="w-8 shrink-0" />}
        <div className={`min-w-0 ${compact ? "flex-1" : "max-w-[72%]"} ${!compact && isMe ? "items-end text-right" : ""}`}>
          <div className="mt-1 inline-block rounded-2xl border border-dashed border-[var(--glass-border-soft)] px-4 py-2.5 text-sm italic text-[var(--text-tertiary)]">
            This message was deleted
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex gap-3 ${!compact && isMe ? "flex-row-reverse" : ""}`}>
      {showHeader ? <Avatar name={personLabel(message.author)} size="sm" /> : <div className="w-8 shrink-0" />}
      <div className={`min-w-0 ${compact ? "flex-1" : "max-w-[72%]"} ${!compact && isMe ? "items-end text-right" : ""}`}>
        {showHeader && (
          <p className="text-xs font-semibold text-[var(--text-secondary)]">
            {personLabel(message.author)} · {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
        {isPinned && <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">📌 Pinned</p>}
        {editing ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              value={editBody}
              onChange={(e) => onEditBodyChange(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-[#8b5cf6] bg-[var(--glass-bg-strong)] p-2.5 text-sm text-[var(--text-primary)] outline-none"
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="button" onClick={onSaveEdit} className="h-8 px-3 text-xs">Save</Button>
              <button type="button" onClick={onCancelEdit} className="rounded-lg border-0 bg-transparent px-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          message.body.trim().length > 0 && (
            <div className={`mt-1 inline-block rounded-2xl px-4 py-2.5 text-sm ${!compact && isMe ? "bg-gradient-to-r from-[#8b5cf6] to-[#ec4899] text-white shadow-[0_4px_12px_rgba(139,92,246,0.25)]" : "bg-[var(--surface-soft)] border border-[var(--glass-border-soft)] text-[var(--text-primary)]"}`}>
              {parseMessageBody(message.body).map((segment, i) =>
                segment.type === "text" ? (
                  <span key={i} className="whitespace-pre-wrap">{segment.value}</span>
                ) : (
                  <TaskChip key={i} preview={taskPreviews[segment.id]} onOpen={() => onOpenTask(segment.id)} />
                )
              )}
              {message.edited_at && <span className="ml-1.5 text-[10px] opacity-70">(edited)</span>}
            </div>
          )
        )}
        {attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {attachments.map((a) =>
              isImage(a.content_type, a.file_name) ? (
                <ImageAttachment key={a.id} attachment={a} onOpen={() => onDownloadFile(a)} />
              ) : isVideo(a.content_type, a.file_name) ? (
                <MediaAttachment key={a.id} attachment={a} kind="video" />
              ) : isAudio(a.content_type, a.file_name) ? (
                <MediaAttachment key={a.id} attachment={a} kind="audio" />
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
          <MessageMenu
            open={menuOpen}
            onToggle={onToggleMenu}
            isPinned={isPinned}
            canEdit={canEdit}
            canDeleteForEveryone={canDeleteForEveryone}
            onCopy={onCopy}
            onForward={onForward}
            onStartEdit={onStartEdit}
            onDeleteForMe={onDeleteForMe}
            onDeleteForEveryone={onDeleteForEveryone}
            onTogglePin={onTogglePin}
          />
          {isMe && !compact && (
            <span className="text-[10px] text-[var(--text-tertiary)]" title={isRead ? "Read" : "Sent"}>
              {isRead ? "✓✓" : "✓"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageMenu({
  open,
  onToggle,
  isPinned,
  canEdit,
  canDeleteForEveryone,
  onCopy,
  onForward,
  onStartEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  onTogglePin,
}: {
  open: boolean;
  onToggle: () => void;
  isPinned: boolean;
  canEdit: boolean;
  canDeleteForEveryone: boolean;
  onCopy: () => void;
  onForward: () => void;
  onStartEdit: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Message actions"
        className="rounded-full border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-2 py-0.5 text-xs text-[var(--text-secondary)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--text-primary)] cursor-pointer"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-10 mb-1 w-44 rounded-xl glass-panel p-1 text-left shadow-lg">
          <button type="button" onClick={onCopy} className="block w-full rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer">
            Copy text
          </button>
          <button type="button" onClick={onForward} className="block w-full rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer">
            Forward
          </button>
          <button type="button" onClick={onTogglePin} className="block w-full rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer">
            {isPinned ? "Unpin" : "Pin"}
          </button>
          {canEdit && (
            <button type="button" onClick={onStartEdit} className="block w-full rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer">
              Edit
            </button>
          )}
          <button type="button" onClick={onDeleteForMe} className="block w-full rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--surface-soft)] cursor-pointer">
            Delete for me
          </button>
          {canDeleteForEveryone && (
            <button type="button" onClick={onDeleteForEveryone} className="block w-full rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-xs text-red-500 hover:bg-[var(--surface-soft)] cursor-pointer">
              Delete for everyone
            </button>
          )}
        </div>
      )}
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

// Same "fetch the signed URL once, cache it" shape as ImageAttachment, just
// rendering a native player instead of an <img>.
function MediaAttachment({ attachment, kind }: { attachment: Attachment; kind: "video" | "audio" }) {
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
    return <div className="grid h-16 w-52 place-items-center rounded-lg border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] text-[10px] text-[var(--text-tertiary)]">Loading…</div>;
  }

  if (kind === "video") {
    return <video src={url} controls className="max-h-52 max-w-[260px] rounded-lg" />;
  }
  return <audio src={url} controls className="max-w-[260px]" />;
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
