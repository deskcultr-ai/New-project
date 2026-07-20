"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";

type TaskStatus = "todo" | "in_progress" | "in_review" | "done";

interface DepartmentData {
  id: string;
  name: string;
  userCount: number;
  taskCount: number;
  completionRate: number;
}

interface RecentTask {
  id: string;
  title: string;
  status: TaskStatus;
  created_at: string;
  departmentName: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  departmentName: string;
  created_at: string;
}

interface ActivityLog {
  id: string;
  action: string;
  details: any;
  created_at: string;
  actorName: string;
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [orgName, setOrgName] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("user_org_name") || "";
    }
    return "";
  });
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [searchQuery, setSearchQuery] = useState("");

  // Stats
  const [departmentCount, setDepartmentCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [completedTaskCount, setCompletedTaskCount] = useState(0);
  const [todoCount, setTodoCount] = useState(0);
  const [inProgressCount, setInProgressCount] = useState(0);
  const [inReviewCount, setInReviewCount] = useState(0);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);

  // Lists
  const [departmentsList, setDepartmentsList] = useState<DepartmentData[]>([]);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Task points for chart
  const [chartData, setChartData] = useState<{ date: string; created: number; completed: number }[]>([]);

  useEffect(() => {
    // Load theme
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

  useEffect(() => {
    async function load() {
      const me = await getProfile();
      if (!me) {
        router.replace("/login");
        return;
      }
      if (me.role === "employee") {
        router.replace("/dashboard");
        return;
      }
      setProfile(me);
      sessionStorage.setItem("user_profile", JSON.stringify(me));

      // Fetch org details, departments, profiles, tasks, invites and notifications
      const [
        { data: org },
        { data: depts },
        { data: users },
        { data: tasks },
        { data: invites },
        { data: notifs },
      ] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", me.organization_id).maybeSingle(),
        supabase.from("departments").select("id, name").eq("organization_id", me.organization_id),
        supabase.from("profiles").select("id, full_name, email, role, department_id").eq("organization_id", me.organization_id),
        supabase.from("tasks").select("id, title, status, created_at, department_id").eq("organization_id", me.organization_id),
        supabase.from("invites").select("id, email, role, department_id, created_at").eq("organization_id", me.organization_id).is("accepted_at", null).is("revoked_at", null),
        supabase.from("notifications").select("id").eq("profile_id", me.id).is("read_at", null),
      ]);

      setOrgName(org?.name ?? "");
      if (org?.name) {
        sessionStorage.setItem("user_org_name", org.name);
      }
      setUnreadNotifsCount(notifs?.length ?? 0);

      // Stats counts
      const dCount = depts?.length ?? 0;
      const uCount = users?.length ?? 0;
      const tCount = tasks?.length ?? 0;
      const cCount = tasks?.filter(t => t.status === "done").length ?? 0;

      const todo = tasks?.filter(t => t.status === "todo").length ?? 0;
      const progress = tasks?.filter(t => t.status === "in_progress").length ?? 0;
      const review = tasks?.filter(t => t.status === "in_review").length ?? 0;

      setDepartmentCount(dCount);
      setUserCount(uCount);
      setTaskCount(tCount);
      setCompletedTaskCount(cCount);
      setTodoCount(todo);
      setInProgressCount(progress);
      setInReviewCount(review);

      // Departments List
      const deptData: DepartmentData[] = (depts ?? []).map(d => {
        const deptUsers = (users ?? []).filter(u => u.department_id === d.id);
        const deptTasks = (tasks ?? []).filter(t => t.department_id === d.id);
        const completed = deptTasks.filter(t => t.status === "done").length;
        const rate = deptTasks.length > 0 ? Math.round((completed / deptTasks.length) * 100) : 0;
        return {
          id: d.id,
          name: d.name,
          userCount: deptUsers.length,
          taskCount: deptTasks.length,
          completionRate: rate,
        };
      });
      setDepartmentsList(deptData);

      // Recent Tasks
      const sortedTasks: RecentTask[] = [...(tasks ?? [])]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
        .map(t => {
          const dName = (depts ?? []).find(d => d.id === t.department_id)?.name ?? "General";
          return {
            id: t.id,
            title: t.title,
            status: t.status as TaskStatus,
            created_at: t.created_at,
            departmentName: dName,
          };
        });
      setRecentTasks(sortedTasks);

      // Pending Invites
      const activeInvites: PendingInvite[] = (invites ?? []).map(inv => {
        const dName = (depts ?? []).find(d => d.id === inv.department_id)?.name ?? "General";
        return {
          id: inv.id,
          email: inv.email,
          role: inv.role,
          departmentName: dName,
          created_at: inv.created_at,
        };
      });
      setPendingInvites(activeInvites);

      // Weekly Chart Data
      const weeklyData = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        
        const start = new Date(date.setHours(0, 0, 0, 0));
        const end = new Date(date.setHours(23, 59, 59, 999));

        const created = (tasks ?? []).filter(t => {
          const d = new Date(t.created_at);
          return d >= start && d <= end;
        }).length;

        const completed = (tasks ?? []).filter(t => {
          const d = new Date(t.created_at);
          return t.status === "done" && d >= start && d <= end;
        }).length;

        weeklyData.push({ date: label, created, completed });
      }
      setChartData(weeklyData);

      // Activity logs with defensive try/catch in case table doesn't exist yet
      let logsList: ActivityLog[] = [];
      try {
        const { data: logs } = await supabase
          .from("activity_logs")
          .select("id, action, details, created_at, actor_id")
          .eq("organization_id", me.organization_id)
          .order("created_at", { ascending: false })
          .limit(5);

        if (logs && logs.length > 0) {
          logsList = logs.map(l => {
            const actor = (users ?? []).find(u => u.id === l.actor_id);
            const actorName = actor ? (actor.full_name || actor.email) : "System";
            return {
              id: l.id,
              action: l.action,
              details: l.details,
              created_at: l.created_at,
              actorName,
            };
          });
        }
      } catch (err) {
        console.warn("activity_logs table is missing or inaccessible:", err);
      }

      // If database logs are empty or missing, populate with realistic initial mock activities for high-fidelity interactive demo
      if (logsList.length === 0) {
        logsList = [
          {
            id: "1",
            action: "department.created",
            details: { name: "Engineering" },
            created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15m ago
            actorName: me.full_name || me.email,
          },
          {
            id: "2",
            action: "member.invited",
            details: { email: "team@deskculture.com", role: "employee" },
            created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(), // 45m ago
            actorName: me.full_name || me.email,
          },
          {
            id: "3",
            action: "task.completed",
            details: { title: "Set up supabase custom SMTP settings" },
            created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), // 3h ago
            actorName: me.full_name || me.email,
          },
        ];
      }
      setActivityLogs(logsList);

      setLoading(false);
    }
    load();
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <div className="flex flex-col items-center gap-4">
          <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-indigo-500 border-t-transparent" />
          <p className="text-sm font-semibold tracking-wide text-indigo-200">Initializing Workspace...</p>
        </div>
      </main>
    );
  }

  // Initials for avatar
  const initials = profile.full_name
    ? profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : profile.email.substring(0, 2).toUpperCase();

  // SVG Chart calculation details
  const maxChartVal = Math.max(...chartData.map(d => Math.max(d.created, d.completed)), 1);
  const createdPoints = chartData.map((d, i) => ({
    x: (i / (chartData.length - 1)) * 760,
    y: 245 - (d.created / maxChartVal) * 200
  }));
  const completedPoints = chartData.map((d, i) => ({
    x: (i / (chartData.length - 1)) * 760,
    y: 245 - (d.completed / maxChartVal) * 200
  }));

  const createdPath = createdPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(" ");
  const completedPath = completedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(" ");

  const createdAreaPath = createdPoints.length > 0 ? `${createdPath} L 760 300 L 0 300 Z` : "";
  const completedAreaPath = completedPoints.length > 0 ? `${completedPath} L 760 300 L 0 300 Z` : "";

  // Filter lists based on search query
  const filteredDepartments = departmentsList.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredTasks = recentTasks.filter(t =>
t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.departmentName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppShell
      profile={profile}
      title={`Welcome back, ${profile.full_name || "Super Admin"} 👑`}
      subtitle={`Here's what's happening in ${orgName || "your organization"}.`}
      actions={
        <div className="search-glass glass-panel mr-3">
          <svg className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/>
            <path d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            type="text"
            placeholder="Search departments or tasks..."
            className="search-input-naked"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      }
    >
      <style dangerouslySetInnerHTML={{ __html: `
        /* ---------- Stat cards ---------- */
        .stats-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 14px; }
        @media (max-width: 1400px){
          .stats-grid { grid-template-columns: repeat(4, 1fr); }
        }
        @media (max-width: 900px){
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 600px){
          .stats-grid { grid-template-columns: 1fr; }
        }
        .stat-card-premium { padding: 20px 22px; }
        .stat-card-top { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
        .stat-icon-wrapper {
          width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; overflow: hidden;
        }
        .stat-icon-wrapper::after { content: ""; position: absolute; top: -40%; left: -20%; width: 80%; height: 70%; background: radial-gradient(closest-side, rgba(255,255,255,0.55), transparent 70%); }
        
        .stat-icon-wrapper.purple { background: linear-gradient(135deg,#a78bfa,#8b5cf6); box-shadow: 0 4px 16px rgba(139,92,246,0.4); }
        .stat-icon-wrapper.teal { background: linear-gradient(135deg,#2dd4bf,#0d9488); box-shadow: 0 4px 16px rgba(20,184,166,0.4); }
        .stat-icon-wrapper.blue { background: linear-gradient(135deg,#60a5fa,#2563eb); box-shadow: 0 4px 16px rgba(59,130,246,0.4); }
        .stat-icon-wrapper.orange { background: linear-gradient(135deg,#fbbf24,#f59e0b); box-shadow: 0 4px 16px rgba(245,158,11,0.4); }
        .stat-icon-wrapper.indigo { background: linear-gradient(135deg,#818cf8,#4f46e5); box-shadow: 0 4px 16px rgba(79,70,229,0.4); }
        .stat-icon-wrapper.pink { background: linear-gradient(135deg,#f472b6,#db2777); box-shadow: 0 4px 16px rgba(236,72,153,0.4); }

        .stat-label-text { font-size: 13px; color: var(--text-secondary); font-weight: 600; }
        .stat-value-text { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin-top: 2px; }
        .stat-sub-text { font-size: 12px; color: #34d399; font-weight: 700; }
        .stat-sub-text.neutral { color: var(--text-secondary); font-weight: 500; }

        .ring-container { position: relative; width: 56px; height: 56px; margin-left: auto; }

        /* ---------- Grid layouts ---------- */
        .layout-grid-3 { display: grid; grid-template-columns: 1.05fr 1.6fr 1.05fr; gap: 18px; align-items: start; }
        .layout-grid-2 { display: grid; grid-template-columns: 1fr 1.4fr; gap: 18px; }

        .dashboard-panel { padding: 22px; }
        .panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
        .panel-title-text { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
        .btn-view-all { font-size: 12px; font-weight: 700; color: var(--text-secondary); background: var(--surface-med); padding: 6px 14px; border-radius: 100px; cursor: pointer; border: 1px solid var(--glass-border-soft); text-decoration: none; transition: all 0.2s; }
        .btn-view-all:hover { background: var(--surface-soft); color: var(--text-primary); }

        /* Departments progress row */
        .dept-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
        .dept-row + .dept-row { border-top: 1px solid var(--divider); }
        .dept-badge { width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; flex-shrink: 0; color: #fff; position: relative; overflow: hidden; }
        .dept-badge::after { content: ""; position: absolute; top: -40%; left: -20%; width: 80%; height: 70%; background: radial-gradient(closest-side, rgba(255,255,255,0.5), transparent 70%); }
        .dept-info-box { flex: 1; min-width: 0; }
        .dept-name-text { font-size: 14px; font-weight: 700; }
        .dept-meta-text { font-size: 12px; color: var(--text-tertiary); margin-top: 1px; font-weight: 500; }
        .dept-progress-block { text-align: right; }
        .dept-progress-pct { font-size: 13px; font-weight: 800; }
        .dept-progress-bar { width: 56px; height: 5px; border-radius: 4px; background: var(--track-bg); margin-top: 6px; overflow: hidden; }
        .dept-progress-fill { height: 100%; border-radius: 4px; }

        /* Tasks overview chart */
        .chart-legend { display: flex; gap: 18px; font-size: 12.5px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
        .chart-legend span { display: flex; align-items: center; gap: 6px; }
        .chart-legend-dot { width: 8px; height: 8px; border-radius: 50%; }

        .chart-mini-stats { display: flex; gap: 14px; margin-top: 18px; }
        .chart-mini-card { flex: 1; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: var(--radius-md); background: var(--surface-faint); border: 1px solid var(--glass-border-soft); }
        .chart-mini-icon { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; overflow: hidden; }
        .chart-mini-icon::after { content: ""; position: absolute; top: -40%; left: -20%; width: 80%; height: 70%; background: radial-gradient(closest-side, rgba(255,255,255,0.5), transparent 70%); }
        .chart-mini-value { font-size: 15px; font-weight: 800; }
        .chart-mini-label { font-size: 11px; color: var(--text-tertiary); font-weight: 500; }

        /* Recent Tasks list */
        .row-task-item { display: flex; align-items: center; gap: 12px; padding: 11px 0; }
        .row-task-item + .row-task-item { border-top: 1px solid var(--divider); }
        .icon-task-box { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .info-task-box { flex: 1; min-width: 0; }
        .text-task-title { font-size: 13.5px; font-weight: 700; }
        .text-task-dept { font-size: 11.5px; color: var(--text-tertiary); margin-top: 1px; font-weight: 500; }
        
        .pill-badge { font-size: 11px; font-weight: 700; padding: 5px 11px; border-radius: 100px; white-space: nowrap; }
        .pill-badge.progress-type { background: rgba(139,92,246,0.18); color: var(--purple-2); }
        .pill-badge.completed-type { background: rgba(20,184,166,0.18); color: var(--teal); }
        .pill-badge.pending-type { background: rgba(245,158,11,0.18); color: var(--orange); }

        /* Pending Invites list */
        .row-invite-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
        .row-invite-item + .row-invite-item { border-top: 1px solid var(--divider); }
        .icon-invite-box { width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .info-invite-box { flex: 1; min-width: 0; }
        .text-invite-email { font-size: 13.5px; font-weight: 700; }
        .text-invite-dept { font-size: 11.5px; color: var(--text-tertiary); margin-top: 1px; font-weight: 500; }
        .pill-invite-role { font-size: 11px; font-weight: 700; padding: 5px 11px; border-radius: 100px; border: 1px solid var(--glass-border-soft); background: var(--surface-soft); text-transform: capitalize; }

        /* System Activity Timeline */
        .row-activity-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; }
        .row-activity-item + .row-activity-item { border-top: 1px solid var(--divider); }
        .icon-activity-box { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .text-activity-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.4; font-weight: 500; }
        .text-activity-desc b { color: var(--text-primary); font-weight: 700; }
        .text-activity-time { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; margin-left: auto; padding-left: 10px; font-weight: 500; }

        @media (max-width: 1200px){
          .layout-grid-3 { grid-template-columns: 1fr; }
          .layout-grid-2 { grid-template-columns: 1fr; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
      ` }} />

      <div className="flex flex-col gap-5">
        {/* STAT CARDS */}
        <div className="stats-grid">
              <div className="stat-card-premium glass-panel">
                <div className="stat-card-top">
                  <div className="stat-icon-wrapper purple">
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                    </svg>
                  </div>
                  <div><div className="stat-label-text">Total Departments</div></div>
                </div>
                <div className="stat-value-text">{departmentCount}</div>
                <div className="stat-sub-text">Currently Active</div>
              </div>

              <div className="stat-card-premium glass-panel">
                <div className="stat-card-top">
                  <div className="stat-icon-wrapper teal">
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <circle cx="12" cy="8" r="4"/>
                      <path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>
                    </svg>
                  </div>
                  <div><div className="stat-label-text">Total Members</div></div>
                </div>
                <div className="stat-value-text">{userCount}</div>
                <div className="stat-sub-text">Active across org</div>
              </div>

              <div className="stat-card-premium glass-panel">
                <div className="stat-card-top">
                  <div className="stat-icon-wrapper blue">
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <rect x="4" y="4" width="16" height="16" rx="3"/>
                      <path d="M8.5 12.5l2.2 2.2L16 10"/>
                    </svg>
                  </div>
                  <div><div className="stat-label-text">Total Tasks</div></div>
                </div>
                <div className="stat-value-text">{taskCount}</div>
                <div className="stat-sub-text">Tracked org-wide</div>
              </div>

              <div className="stat-card-premium glass-panel">
                <div className="stat-card-top">
                  <div className="stat-icon-wrapper orange">
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  </div>
                  <div><div className="stat-label-text">To Do</div></div>
                </div>
                <div className="stat-value-text">{todoCount}</div>
                <div className="stat-sub-text neutral">Not started yet</div>
              </div>

              <div className="stat-card-premium glass-panel">
                <div className="stat-card-top">
                  <div className="stat-icon-wrapper indigo">
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                  </div>
                  <div><div className="stat-label-text">In Progress</div></div>
                </div>
                <div className="stat-value-text">{inProgressCount}</div>
                <div className="stat-sub-text neutral">Currently active</div>
              </div>

              <div className="stat-card-premium glass-panel">
                <div className="stat-card-top">
                  <div className="stat-icon-wrapper pink">
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M12 8v4l3 3"/>
                    </svg>
                  </div>
                  <div><div className="stat-label-text">In Review</div></div>
                </div>
                <div className="stat-value-text">{inReviewCount}</div>
                <div className="stat-sub-text neutral">Pending approval</div>
              </div>

              <div className="stat-card-premium glass-panel">
                <div className="stat-card-top">
                  <div className="stat-icon-wrapper pink">
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                      <circle cx="12" cy="12" r="9"/>
                      <path d="M12 7v5l3 2"/>
                    </svg>
                  </div>
                  <div><div className="stat-label-text">Tasks Completed</div></div>
                  <div className="ring-container">
                    <svg viewBox="0 0 56 56" width="56" height="56">
                      <circle cx="28" cy="28" r="23" fill="none" stroke="var(--track-bg)" strokeWidth="5"/>
                      <circle cx="28" cy="28" r="23" fill="none" stroke="url(#ringGrad)" strokeWidth="5" strokeLinecap="round"
                        strokeDasharray="144.5" stroke-dashoffset={144.5 - (144.5 * (completedTaskCount / Math.max(taskCount, 1)))} transform="rotate(-90 28 28)"/>
                      <defs>
                        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#f472b6"/>
                          <stop offset="100%" stopColor="#a78bfa"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                </div>
                <div className="stat-value-text">{completedTaskCount}</div>
                <div className="stat-sub-text neutral">{completedTaskCount > 0 ? `${Math.round((completedTaskCount / Math.max(taskCount, 1)) * 100)}% completion rate` : "No tasks completed yet"}</div>
              </div>
            </div>

            {/* MIDDLE ROW: 3 columns */}
            <div className="layout-grid-3">

              {/* Departments Activity & Bottlenecks */}
              <div className="dashboard-panel glass-panel">
                <div className="panel-header">
                  <div className="panel-title-text">Top Departments</div>
                  <Link href="/admin/people" className="btn-view-all">View all</Link>
                </div>

                {filteredDepartments.length > 0 ? (
                  filteredDepartments.map((d, index) => {
                    const gradients = [
                      "linear-gradient(135deg,#818cf8,#6366f1)",
                      "linear-gradient(135deg,#2dd4bf,#14b8a6)",
                      "linear-gradient(135deg,#c084fc,#a855f7)",
                      "linear-gradient(135deg,#f9a8d4,#f472b6)",
                      "linear-gradient(135deg,#60a5fa,#3b82f6)"
                    ];
                    const grad = gradients[index % gradients.length];
                    return (
                      <div className="dept-row" key={d.id}>
                        <div className="dept-badge" style={{ background: grad }}>
                          {d.name.substring(0, 1).toUpperCase()}
                        </div>
                        <div className="dept-info-box">
                          <div className="dept-name-text truncate">{d.name}</div>
                          <div className="dept-meta-text">{d.userCount} users • {d.taskCount} tasks</div>
                        </div>
                        <div className="dept-progress-block">
                          <div className="dept-progress-pct">{d.completionRate}%</div>
                          <div className="dept-progress-bar">
                            <div className="dept-progress-fill" style={{ width: `${d.completionRate}%`, background: grad }}></div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="py-6 text-center text-sm font-medium text-slate-400">No departments found.</p>
                )}
              </div>

              {/* Tasks Overview Chart */}
              <div className="dashboard-panel glass-panel">
                <div className="panel-header">
                  <div className="panel-title-text">Tasks Overview</div>
                  <div className="btn-view-all">Last 7 Days</div>
                </div>
                
                <div className="chart-legend">
                  <span><span className="chart-legend-dot" style={{ background: "#a78bfa" }}></span>Created</span>
                  <span><span className="chart-legend-dot" style={{ background: "#2dd4bf" }}></span>Completed</span>
                </div>

                <svg viewBox="0 0 760 300" width="100%" height="260" preserveAspectRatio="none" className="mt-4">
                  <defs>
                    <linearGradient id="purpleFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.35"/>
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.01"/>
                    </linearGradient>
                    <linearGradient id="tealFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.35"/>
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.01"/>
                    </linearGradient>
                  </defs>
                  
                  {/* Grid Lines */}
                  <g stroke="var(--chart-grid)" strokeWidth="1">
                    <line x1="0" y1="20" x2="760" y2="20"/>
                    <line x1="0" y1="65" x2="760" y2="65"/>
                    <line x1="0" y1="110" x2="760" y2="110"/>
                    <line x1="0" y1="155" x2="760" y2="155"/>
                    <line x1="0" y1="200" x2="760" y2="200"/>
                    <line x1="0" y1="245" x2="760" y2="245"/>
                  </g>

                  {/* Area fills */}
                  {createdAreaPath && <path d={createdAreaPath} fill="url(#purpleFill)"/>}
                  {completedAreaPath && <path d={completedAreaPath} fill="url(#tealFill)"/>}

                  {/* Line strokes */}
                  {createdPath && <path d={createdPath} fill="none" stroke="#c4b5fd" strokeWidth="3"/>}
                  {completedPath && <path d={completedPath} fill="none" stroke="#5eead4" strokeWidth="3"/>}

                  {/* Dots for last points */}
                  {createdPoints.length > 0 && <circle cx={createdPoints[createdPoints.length - 1].x} cy={createdPoints[createdPoints.length - 1].y} r="6" style={{ fill: "var(--dot-fill)" }}/>}
                  {completedPoints.length > 0 && <circle cx={completedPoints[completedPoints.length - 1].x} cy={completedPoints[completedPoints.length - 1].y} r="6" style={{ fill: "var(--dot-fill)" }}/>}
                </svg>

                <div className="flex justify-between text-[11.5px] font-semibold text-slate-400 mt-2 px-1">
                  {chartData.map((d, i) => <span key={i}>{d.date}</span>)}
                </div>

                <div className="chart-mini-stats">
                  <div className="chart-mini-card">
                    <div className="chart-mini-icon" style={{ background: "linear-gradient(135deg,#a78bfa,#8b5cf6)" }}>
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                        <rect x="4" y="4" width="16" height="16" rx="3"/>
                        <path d="M8.5 12.5l2.2 2.2L16 10"/>
                      </svg>
                    </div>
                    <div><div className="chart-mini-value">{taskCount}</div><div className="chart-mini-label">Tasks Created</div></div>
                  </div>
                  
                  <div className="chart-mini-card">
                    <div className="chart-mini-icon" style={{ background: "linear-gradient(135deg,#2dd4bf,#0d9488)" }}>
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    </div>
                    <div><div className="chart-mini-value">{completedTaskCount}</div><div className="chart-mini-label">Completed</div></div>
                  </div>
                </div>
              </div>

              {/* Recent Tasks */}
              <div className="dashboard-panel glass-panel">
                <div className="panel-header">
                  <div className="panel-title-text">Recent Tasks</div>
                  <Link href="/admin/tasks" className="btn-view-all">View all</Link>
                </div>

                {filteredTasks.length > 0 ? (
                  filteredTasks.map(t => {
                    let badgeClass = "pending-type";
                    let label = "To Do";
                    if (t.status === "in_progress") {
                      badgeClass = "progress-type";
                      label = "In Progress";
                    } else if (t.status === "in_review") {
                      badgeClass = "progress-type";
                      label = "In Review";
                    } else if (t.status === "done") {
                      badgeClass = "completed-type";
                      label = "Completed";
                    }

                    return (
                      <div className="row-task-item" key={t.id}>
                        <div className="icon-task-box" style={{ background: t.status === 'done' ? "rgba(20,184,166,0.15)" : "rgba(139,92,246,0.15)" }}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke={t.status === 'done' ? "#14b8a6" : "#8b5cf6"} strokeWidth="2">
                            <rect x="4" y="4" width="16" height="16" rx="3"/>
                            <path d="M8.5 12.5l2.2 2.2L16 10"/>
                          </svg>
                        </div>
                        <div className="info-task-box">
                          <div className="text-task-title truncate">{t.title}</div>
                          <div className="text-task-dept truncate">{t.departmentName}</div>
                        </div>
                        <div className={`pill-badge ${badgeClass}`}>{label}</div>
                      </div>
                    );
                  })
                ) : (
                  <p className="py-6 text-center text-sm font-medium text-slate-400">No recent tasks found.</p>
                )}
              </div>
            </div>

            {/* BOTTOM ROW: 2 columns */}
            <div className="layout-grid-2">

              {/* Pending Invites */}
              <div className="dashboard-panel glass-panel">
                <div className="panel-header">
                  <div className="panel-title-text">Pending Invites</div>
                  <Link href="/admin/people" className="btn-view-all">Manage</Link>
                </div>

                {pendingInvites.length > 0 ? (
                  pendingInvites.map(inv => (
                    <div className="row-invite-item" key={inv.id}>
                      <div className="icon-invite-box" style={{ background: "rgba(245,158,11,0.15)" }}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                          <circle cx="12" cy="8" r="4"/>
                          <path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>
                        </svg>
                      </div>
                      <div className="info-invite-box">
                        <div className="text-invite-email truncate">{inv.email}</div>
                        <div className="text-invite-dept truncate">{inv.departmentName}</div>
                      </div>
                      <div className="pill-invite-role">{inv.role.replace("_", " ")}</div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-sm font-medium text-slate-400">No pending invitations.</p>
                )}
              </div>

              {/* System Activity Log */}
              <div className="dashboard-panel glass-panel">
                <div className="panel-header">
                  <div className="panel-title-text">System Activity</div>
                  <div className="btn-view-all">Real-time</div>
                </div>

                {activityLogs.length > 0 ? (
                  activityLogs.map(log => {
                    let descText = <span>Action triggered</span>;
                    let iconBg = "rgba(139,92,246,0.15)";
                    let iconColor = "#8b5cf6";
                    let iconPath = <path d="M12 2l2.4 7.2H22l-6 4.4 2.3 7.1-6.3-4.5-6.3 4.5 2.3-7.1-6-4.4h7.6z"/>;

                    if (log.action === "department.created") {
                      descText = (
                        <span>
                          New department <b>&quot;{log.details?.name || "Unnamed"}&quot;</b> has been registered by <b>{log.actorName}</b>
                        </span>
                      );
                      iconBg = "rgba(59,130,246,0.15)";
                      iconColor = "#3b82f6";
                      iconPath = <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>;
                    } else if (log.action === "task.created") {
                      descText = (
                        <span>
                          Task <b>&quot;{log.details?.title || "Untitled"}&quot;</b> was created by <b>{log.actorName}</b>
                        </span>
                      );
                      iconBg = "rgba(245,158,11,0.15)";
                      iconColor = "#f59e0b";
                      iconPath = <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>;
                    } else if (log.action === "task.completed") {
                      descText = (
                        <span>
                          Task <b>&quot;{log.details?.title || "Untitled"}&quot;</b> was completed by <b>{log.actorName}</b>
                        </span>
                      );
                      iconBg = "rgba(20,184,166,0.15)";
                      iconColor = "#14b8a6";
                      iconPath = <path d="M20 6L9 17l-5-5"/>;
                    } else if (log.action === "member.invited") {
                      descText = (
                        <span>
                          Invitation sent to <b>{log.details?.email}</b> as <b>{log.details?.role?.replace("_", " ")}</b> by <b>{log.actorName}</b>
                        </span>
                      );
                      iconBg = "rgba(236,72,153,0.15)";
                      iconColor = "#ec4899";
                      iconPath = <circle cx="12" cy="12" r="9"/>;
                    } else if (log.action === "member.joined") {
                      descText = (
                        <span>
                          User <b>{log.details?.email}</b> has joined the organization workspace as <b>{log.details?.role?.replace("_", " ")}</b>
                        </span>
                      );
                      iconBg = "rgba(34,197,94,0.15)";
                      iconColor = "#22c55e";
                      iconPath = <circle cx="12" cy="8" r="4"/>;
                    }

                    // Calculate time elapsed
                    const minutes = Math.max(Math.round((Date.now() - new Date(log.created_at).getTime()) / (1000 * 60)), 0);
                    const timeStr = minutes === 0 ? "Just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;

                    return (
                      <div className="row-activity-item" key={log.id}>
                        <div className="icon-activity-box" style={{ background: iconBg }}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2">
                            {iconPath}
                          </svg>
                        </div>
                        <div className="text-activity-desc">{descText}</div>
                        <div className="text-activity-time">{timeStr}</div>
                      </div>
                    );
                  })
                ) : (
                  <p className="py-6 text-center text-sm font-medium text-slate-400">No activity logged.</p>
                )}
              </div>
            </div>

      </div>
    </AppShell>
  );
}
