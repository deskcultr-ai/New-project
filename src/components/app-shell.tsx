"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import { displayName, type Profile } from "@/lib/session";

type NavItem = { label: string; href: string; icon: React.ReactNode };
type NotificationType =
  | "mention"
  | "dm"
  | "thread_reply"
  | "task_assigned"
  | "task_forward"
  | "member_joined"
  | "file_uploaded"
  | "department_created";
type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const NOTIFICATION_ICON: Record<NotificationType, string> = {
  mention: "💬",
  dm: "✉️",
  thread_reply: "↩️",
  task_assigned: "✅",
  task_forward: "🔁",
  member_joined: "👋",
  file_uploaded: "📎",
  department_created: "🏢",
};

function icon(d: string) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-[18px] w-[18px] shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M2.25 12l8.954-8.955a1.125 1.125 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75",
  people: "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z",
  check: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  chat: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155",
  bell: "M14.86 17.08a2.25 2.25 0 0 1-5.72 0M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z",
  folder: "M3 7h5l2 2h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  gear: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.28c-.062-.375-.312-.687-.644-.87a6.52 6.52 0 0 1-.22-.128c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.93 6.93 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z",
};

function navForRole(role: Profile["role"] | undefined): NavItem[] {
  if (role === "super_admin") {
    return [
      { label: "Overview", href: "/admin", icon: icon(ICONS.home) },
      { label: "Departments & People", href: "/admin/people", icon: icon(ICONS.people) },
      { label: "Tasks", href: "/admin/tasks", icon: icon(ICONS.check) },
      { label: "Messages", href: "/messages", icon: icon(ICONS.chat) },
      { label: "Drive", href: "/drive", icon: icon(ICONS.folder) },
      { label: "Settings", href: "/admin/settings", icon: icon(ICONS.gear) },
      { label: "Profile", href: "/profile", icon: icon("M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z") },
    ];
  }
  if (role === "admin") {
    return [
      { label: "Overview", href: "/admin", icon: icon(ICONS.home) },
      { label: "Team", href: "/admin/people", icon: icon(ICONS.people) },
      { label: "Tasks", href: "/admin/tasks", icon: icon(ICONS.check) },
      { label: "Messages", href: "/messages", icon: icon(ICONS.chat) },
      { label: "Drive", href: "/drive", icon: icon(ICONS.folder) },
      { label: "Profile", href: "/profile", icon: icon("M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z") },
    ];
  }
  return [
    { label: "My Tasks", href: "/dashboard", icon: icon(ICONS.check) },
    { label: "Messages", href: "/messages", icon: icon(ICONS.chat) },
    { label: "Drive", href: "/drive", icon: icon(ICONS.folder) },
    { label: "Profile", href: "/profile", icon: icon("M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z") },
  ];
}

function NavLinks({ items, pathname, sidebarCollapsed, onNavigate }: { items: NavItem[]; pathname: string; sidebarCollapsed?: boolean; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1 p-0 list-none w-full">
      {items.map((item) => {
        const active = item.href === "/admin" || item.href === "/dashboard"
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              title={sidebarCollapsed ? item.label : undefined}
              className={cn(
                "nav-link-item flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition decoration-none",
                sidebarCollapsed ? "justify-center px-0" : "",
                active ? "active-route text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as "dark" | "light" | null;
    const currentTheme = savedTheme || "dark";
    setTheme(currentTheme);
    document.documentElement.setAttribute("data-theme", currentTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  return (
    <div className="theme-toggle-premium" onClick={toggleTheme} role="button" aria-label="Toggle light and dark theme">
      <svg className="toggle-track-icon sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
      </svg>
      <svg className="toggle-track-icon moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>
      </svg>
      <div className="toggle-knob">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" width="13" height="13">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
        </svg>
      </div>
    </div>
  );
}

function NotificationBell({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });

  // The header's real height varies per page (some pass extra actions/a
  // search bar), so a fixed CSS offset for the panel doesn't line up with
  // where the bell actually is on every page. Anchor to the bell's real
  // on-screen position instead -- the same approach GitHub's dropdowns use.
  function positionPanel() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
  }

  function toggleOpen() {
    if (!open) positionPanel();
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) return;
    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open]);

  // Browser popup notifications (Notification API) -- shows an OS-level
  // toast while this tab is open in the background, same behavior as any
  // site you've granted notification permission to. Doesn't require the
  // browser to be closed/open in advance -- just asks once.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Fetch notifications from the last 2 hours
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("notifications")
        .select("id, type, title, body, link, read_at, created_at")
        .eq("profile_id", profileId)
        .gte("created_at", twoHoursAgo)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!cancelled) setItems((data as NotificationItem[]) ?? []);
    }
    load();

    const channel = supabase
      .channel(`notifications:${profileId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `profile_id=eq.${profileId}` },
        (payload) => {
          const item = payload.new as NotificationItem;
          setItems((current) => [item, ...current].slice(0, 30));

          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
            const popup = new Notification(item.title, { body: item.body ?? undefined, tag: item.id, icon: "/favicon.ico" });
            popup.onclick = () => {
              window.focus();
              if (item.link) router.push(item.link);
              popup.close();
            };
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [profileId, router]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      // The panel is portaled to document.body (see below), so it's not a
      // DOM descendant of wrapperRef anymore -- check both explicitly.
      const insideButton = wrapperRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideButton && !insidePanel) {
        setOpen(false);
      }
    }
    // Defer attaching the listener to the next tick. Without this, the
    // mousedown that just opened the panel (still in-flight the moment
    // this effect runs) can be picked up by the SAME listener and close it
    // right back -- the classic "dropdown closes itself immediately" bug.
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const unreadCount = items.filter((item) => !item.read_at).length;

  async function openNotification(item: NotificationItem) {
    if (!item.read_at) {
      const readAt = new Date().toISOString();
      setItems((current) => current.map((n) => (n.id === item.id ? { ...n, read_at: readAt } : n)));
      await supabase.from("notifications").update({ read_at: readAt }).eq("id", item.id);
    }
    setOpen(false);
    if (item.link) router.push(item.link);
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        aria-label="Notifications"
        onClick={toggleOpen}
        className="ping-btn glass-panel"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="ping-dot"></span>
        )}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {/* Rendered via a portal straight onto <body>: several ancestors
                in this design use .glass-panel, which sets backdrop-filter --
                and a backdrop-filter/filter/transform on ANY ancestor makes
                position:fixed resolve relative to that ancestor instead of
                the viewport (a real CSS behavior, not a bug in the math
                here). Escaping the DOM tree entirely is what actually makes
                "fixed" mean "fixed to the viewport" again on every page. */}
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
            <div
              ref={panelRef}
              className="fixed z-50 w-[320px] max-w-[86vw] overflow-hidden glass-panel shadow-2xl"
              style={{ top: panelPos.top, right: panelPos.right }}
            >
              <div className="border-b border-[var(--divider)] px-4 py-3">
                <p className="text-sm font-bold text-[var(--text-primary)] m-0">Notifications</p>
              </div>
              <div className="max-h-[320px] overflow-y-auto p-2">
                {items.length > 0 ? (
                  items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openNotification(item)}
                      className="flex w-full gap-3 rounded-xl border-0 bg-transparent px-3 py-3 text-left hover:bg-[var(--surface-soft)] text-[var(--text-primary)] cursor-pointer"
                    >
                      <span className="mt-0.5 shrink-0 text-base leading-none">{NOTIFICATION_ICON[item.type] ?? "🔔"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-[var(--text-primary)]">{item.title}</span>
                        {item.body && <span className="mt-0.5 block line-clamp-2 text-xs font-semibold text-[var(--text-secondary)]">{item.body}</span>}
                      </span>
                      {!item.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                    </button>
                  ))
                ) : (
                  <p className="rounded-lg px-3 py-6 text-center text-sm font-semibold text-[var(--text-secondary)] m-0">No notifications yet.</p>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

export function AppShell({
  profile,
  title,
  subtitle,
  children,
  actions,
}: {
  profile: Profile | null;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar_collapsed") === "true";
    }
    return false;
  });

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebar_collapsed", String(next));
    }
  };

  const items = navForRole(profile?.role);

  async function signOut() {
    await supabase.auth.signOut();
    sessionStorage.removeItem("user_profile");
    router.replace("/login");
  }

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : profile?.email?.substring(0, 2).toUpperCase() || "DC";

  return (
    <div className={cn("dashboard-container p-5 transition-all duration-300", sidebarCollapsed ? "sidebar-collapsed" : "")}>
      {/* SIDEBAR */}
      <aside className={cn("admin-sidebar glass-panel hidden lg:flex", sidebarCollapsed ? "w-[72px]" : "w-[260px]")}>
        <div className={cn("logo-section flex items-center text-[var(--text-primary)] w-full mb-6", sidebarCollapsed ? "flex-col gap-3 justify-center px-0 pb-4 border-b border-[var(--divider)]" : "justify-between")}>
          <Link href="/" className="flex items-center gap-3 decoration-none text-inherit min-w-0">
            <div className="logo-box shrink-0">D</div>
            {!sidebarCollapsed && <span className="logo-text truncate font-extrabold text-base">DeskCulture</span>}
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--text-primary)] hover:bg-[var(--surface-soft)] border-0 bg-transparent cursor-pointer shrink-0"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <nav className="side-navigation w-full">
          <NavLinks items={items} pathname={pathname} sidebarCollapsed={sidebarCollapsed} />
        </nav>
        <div className="profile-footer w-full">
          <Link href="/profile" className="profile-avatar decoration-none" title="Profile Settings">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="h-full w-full rounded-full object-cover" />
            ) : (
              initials
            )}
            <span className="online-indicator"></span>
          </Link>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="profile-name-text truncate text-[var(--text-primary)] m-0 leading-tight">
                {profile?.username ? `@${profile.username}` : (profile?.full_name || displayName(profile))}
              </p>
              <p className="profile-email-text truncate text-[var(--text-tertiary)] m-0 mt-0.5 leading-none">{profile?.email}</p>
            </div>
          )}
        </div>
        <button onClick={signOut} className={cn("btn-signout-premium flex items-center justify-center gap-2", sidebarCollapsed ? "px-0 py-2.5" : "")} title="Sign Out">
          {sidebarCollapsed ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
            </svg>
          ) : (
            "Sign Out"
          )}
        </button>
      </aside>

      {/* MOBILE NAV (Drawer) */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/35 border-0"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative flex h-full w-[280px] max-w-[86vw] flex-col glass-panel shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4">
              <Link href="/" className="logo-section text-[var(--text-primary)] decoration-none" onClick={() => setMobileNavOpen(false)}>
                <div className="logo-box">D</div>
                <span className="logo-text">DeskCulture</span>
              </Link>
              <button
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-[var(--text-primary)] hover:bg-[var(--surface-soft)] border-0 bg-transparent cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 pb-4">
              <NavLinks items={items} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
            </nav>
            <div className="p-4 border-t border-[var(--divider)]">
              <button
                onClick={signOut}
                className="btn-signout-premium"
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* MAIN VIEW */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <header className="header-topbar">
          <button
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--text-primary)] hover:bg-[var(--surface-soft)] lg:hidden border-0 bg-transparent cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          
          <div className="welcome-greet">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          
          <div className="actions-topbar">
            {actions}
            <ThemeToggle />
            {profile && <NotificationBell profileId={profile.id} />}
          </div>
        </header>

        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
}
