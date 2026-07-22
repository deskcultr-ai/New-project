"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Input, Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ConversationType } from "@/lib/messaging";

type ConversationRow = {
  id: string;
  type: ConversationType;
  department_id: string | null;
  dm_profile_a: string | null;
  dm_profile_b: string | null;
};
type DirectoryPerson = { id: string; full_name: string | null; email: string };
type ListItem = { id: string; type: ConversationType; label: string; unread: number; otherId?: string };
type SearchResult = {
  id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  author: { username: string | null; full_name: string | null; email: string } | null;
};

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [items, setItems] = useState<ListItem[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);

  const [messageSearch, setMessageSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async (me: Profile) => {
    const [{ data: depts }, { data: convos }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("organization_id", me.organization_id),
      supabase.from("conversations").select("id, type, department_id, dm_profile_a, dm_profile_b"),
    ]);

    const deptName = (id: string | null) => (depts ?? []).find((d) => d.id === id)?.name ?? "Department";
    const rows = (convos ?? []) as ConversationRow[];

    const dmOtherIds = rows
      .filter((c) => c.type === "dm")
      .map((c) => (c.dm_profile_a === me.id ? c.dm_profile_b : c.dm_profile_a))
      .filter((id): id is string => !!id);

    const { data: dmPeople } = dmOtherIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", dmOtherIds)
      : { data: [] as DirectoryPerson[] };

    const { data: reads } = await supabase.from("conversation_reads").select("conversation_id, last_read_at").eq("profile_id", me.id);
    const readMap = new Map((reads ?? []).map((r) => [r.conversation_id, r.last_read_at as string]));

    const unreadCounts = await Promise.all(
      rows.map(async (c) => {
        const since = readMap.get(c.id);
        const query = supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", c.id);
        const { count } = since ? await query.gt("created_at", since) : await query;
        return count ?? 0;
      })
    );

    const built: ListItem[] = rows.map((c, index) => {
      if (c.type === "announcement") return { id: c.id, type: c.type, label: "Announcements", unread: unreadCounts[index] };
      if (c.type === "department_channel") return { id: c.id, type: c.type, label: deptName(c.department_id), unread: unreadCounts[index] };
      const otherId = c.dm_profile_a === me.id ? c.dm_profile_b! : c.dm_profile_a!;
      const other = (dmPeople ?? []).find((p) => p.id === otherId);
      return { id: c.id, type: c.type, label: other?.full_name || other?.email || "Direct message", unread: unreadCounts[index], otherId };
    });

    built.sort((a, b) => {
      const order = { announcement: 0, department_channel: 1, dm: 2 };
      return order[a.type] - order[b.type] || a.label.localeCompare(b.label);
    });

    setItems(built);
  }, []);

  useEffect(() => {
    async function init() {
      const me = await getProfile();
      if (!me) {
        router.replace("/login");
        return;
      }
      setProfile(me);
      sessionStorage.setItem("user_profile", JSON.stringify(me));
      await load(me);
      setLoading(false);

      const { data: directoryData } = await supabase.from("profiles").select("id, full_name, email").neq("id", me.id).order("full_name");
      setDirectory((directoryData ?? []) as DirectoryPerson[]);

      const presenceChannel = supabase.channel(`presence:org:${me.organization_id}`, { config: { presence: { key: me.id } } });
      presenceChannel
        .on("presence", { event: "sync" }, () => {
          setOnline(new Set(Object.keys(presenceChannel.presenceState())));
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await presenceChannel.track({ online_at: new Date().toISOString() });
          }
        });

      // The conversation list + unread badges otherwise only ever loaded
      // once on mount -- a new message anywhere, or a brand new DM someone
      // else started, never showed up without a manual reload. Realtime
      // already enforces RLS on these subscriptions, so an unfiltered
      // listen only ever delivers rows this user can actually see.
      const myProfile: Profile = me;
      let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
      function scheduleReload() {
        if (reloadTimeout) clearTimeout(reloadTimeout);
        reloadTimeout = setTimeout(() => load(myProfile), 400);
      }
      const sidebarChannel = supabase
        .channel(`messages-sidebar:${me.id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, scheduleReload)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversations" }, scheduleReload)
        .subscribe();

      return () => {
        if (reloadTimeout) clearTimeout(reloadTimeout);
        supabase.removeChannel(sidebarChannel);
        supabase.removeChannel(presenceChannel);
      };
    }
    const cleanupPromise = init();
    return () => {
      cleanupPromise.then((cleanup) => cleanup?.());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    const query = messageSearch.trim();
    if (query.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale results when the search box is cleared/shortened
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = setTimeout(async () => {
      // RLS on messages already scopes this to conversations the caller can access.
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, body, created_at, author:profiles(username,full_name,email)")
        .ilike("body", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(25);
      setSearchResults((data ?? []) as unknown as SearchResult[]);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [messageSearch]);

  function conversationLabel(conversationId: string) {
    return items.find((i) => i.id === conversationId)?.label ?? "Conversation";
  }

  function highlightMatch(body: string, query: string) {
    const idx = body.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return body.length > 100 ? body.slice(0, 100) + "…" : body;
    const start = Math.max(0, idx - 30);
    const end = Math.min(body.length, idx + query.length + 40);
    return (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "");
  }

  async function startDm(personId: string) {
    const { data, error } = await supabase.rpc("get_or_create_dm", { other_profile_id: personId });
    if (error || !data) return;
    setPickerOpen(false);
    setPickerQuery("");
    if (profile) await load(profile);
    router.push(`/messages/${data}`);
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  const filteredDirectory = directory.filter((p) =>
    (p.full_name || p.email).toLowerCase().includes(pickerQuery.trim().toLowerCase())
  );

  return (
    <AppShell profile={profile} title="Messages">
      <div className="grid h-[calc(100vh-8rem)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex flex-col overflow-hidden glass-panel">
          <div className="border-b border-[var(--divider)] p-3 space-y-2">
            <Input
              value={messageSearch}
              onChange={(e) => setMessageSearch(e.target.value)}
              placeholder="Search messages..."
              className="h-9"
            />
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-3.5 py-2 text-left text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--surface-med)] transition-all cursor-pointer"
            >
              + New message
            </button>
            {pickerOpen && (
              <div className="mt-2 space-y-2">
                <Input value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Search people..." className="h-9" />
                <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--divider)] bg-[var(--glass-bg)]">
                  {filteredDirectory.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => startDm(p.id)}
                      className="flex w-full items-center justify-between border-0 bg-transparent px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {p.full_name || p.email}
                      {online.has(p.id) && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                    </button>
                  ))}
                  {filteredDirectory.length === 0 && <p className="px-3 py-3 text-center text-xs text-[var(--text-tertiary)]">No matches.</p>}
                </div>
              </div>
            )}
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            {messageSearch.trim().length >= 2 ? (
              <>
                {searching && <p className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">Searching...</p>}
                {!searching && searchResults.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">No messages match &quot;{messageSearch.trim()}&quot;.</p>
                )}
                {!searching && searchResults.map((result) => (
                  <Link
                    key={result.id}
                    href={`/messages/${result.conversation_id}`}
                    onClick={() => setMessageSearch("")}
                    className="block rounded-xl px-3.5 py-2.5 text-sm decoration-none text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-bold text-[var(--text-primary)]">{conversationLabel(result.conversation_id)}</span>
                      <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">{new Date(result.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
                      {result.author?.username ? `@${result.author.username}` : result.author?.full_name || result.author?.email}: {highlightMatch(result.body, messageSearch.trim())}
                    </p>
                  </Link>
                ))}
              </>
            ) : (
              <>
                {items.map((item) => {
                  const active = pathname === `/messages/${item.id}`;
                  return (
                    <Link
                      key={item.id}
                      href={`/messages/${item.id}`}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition decoration-none",
                        active ? "active-route text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {item.type === "dm" && item.otherId && (
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", online.has(item.otherId) ? "bg-emerald-500" : "bg-slate-300")} />
                        )}
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.unread > 0 && <Badge tone="danger">{item.unread > 9 ? "9+" : item.unread}</Badge>}
                    </Link>
                  );
                })}
                {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">No conversations yet.</p>}
              </>
            )}
          </nav>
        </div>
        <div className="min-w-0 overflow-hidden glass-panel">{children}</div>
      </div>
    </AppShell>
  );
}
