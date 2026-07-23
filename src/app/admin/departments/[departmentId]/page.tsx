"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card, Badge } from "@/components/ui";
import { STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE, type TaskStatus, type TaskPriority } from "@/lib/tasks";

type Department = { id: string; name: string };
type PersonStatus = {
  profile_id: string;
  email: string;
  full_name: string | null;
  username: string | null;
  role: "org_super_admin" | "team_leader" | "manager" | "executive";
  department_id: string | null;
  invited_at: string | null;
  confirmed_at: string | null;
};
type DeptTask = { id: string; title: string; status: TaskStatus; priority: TaskPriority; due_date: string | null };
type ActivityLog = { id: string; action: string; details: Record<string, string>; created_at: string };

const ACTION_LABEL: Record<string, string> = {
  "department.created": "Department created",
  "task.created": "Task created",
  "task.completed": "Task completed",
  "member.joined": "Member joined",
};

export default function DepartmentDetailPage() {
  const params = useParams<{ departmentId: string }>();
  const router = useRouter();
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [department, setDepartment] = useState<Department | null>(null);
  const [members, setMembers] = useState<PersonStatus[]>([]);
  const [tasks, setTasks] = useState<DeptTask[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  const load = useCallback(async () => {
    const me = await getProfile();
    if (!me) {
      router.replace("/login");
      return;
    }
    if (me.role === "executive") {
      router.replace("/dashboard");
      return;
    }
    setProfile(me);
    sessionStorage.setItem("user_profile", JSON.stringify(me));

    const { data: dept, error: deptErr } = await supabase
      .from("departments")
      .select("id, name")
      .eq("id", params.departmentId)
      .maybeSingle();
    if (deptErr || !dept) {
      setNotFound(true);
      return;
    }
    setDepartment(dept as Department);

    const [{ data: peopleRows }, { data: taskRows }, { data: logRows }] = await Promise.all([
      supabase.rpc("org_people_status"),
      supabase.from("tasks").select("id, title, status, priority, due_date").eq("department_id", params.departmentId).order("created_at", { ascending: false }),
      supabase.from("activity_logs").select("id, action, details, created_at").eq("department_id", params.departmentId).order("created_at", { ascending: false }).limit(15),
    ]);

    setMembers(((peopleRows ?? []) as PersonStatus[]).filter((p) => p.department_id === params.departmentId));
    setTasks((taskRows ?? []) as DeptTask[]);
    setLogs((logRows ?? []) as unknown as ActivityLog[]);
  }, [params.departmentId, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount pattern used throughout the app
    load();
  }, [load]);

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (notFound) {
    return (
      <AppShell profile={profile} title="Department not found">
        <Card className="text-center text-sm text-[var(--text-tertiary)]">
          This department doesn&apos;t exist, or you don&apos;t have access to it.
        </Card>
      </AppShell>
    );
  }

  if (!department) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  function activityLine(log: ActivityLog) {
    switch (log.action) {
      case "department.created":
        return `${log.details.name ?? department!.name} was created`;
      case "task.created":
        return `Task "${log.details.title}" was created`;
      case "task.completed":
        return `Task "${log.details.title}" was completed`;
      case "member.joined":
        return `${log.details.full_name || log.details.email} joined as ${(log.details.role ?? "").replaceAll("_", " ")}`;
      default:
        return ACTION_LABEL[log.action] ?? log.action;
    }
  }

  return (
    <AppShell profile={profile} title={department.name} subtitle="Department overview">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="text-base font-bold text-[var(--text-primary)]">
            People · {members.length}
          </h2>
          <div className="mt-4 space-y-2">
            {members.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No members in this department yet.</p>}
            {members.map((person) => (
              <div key={person.profile_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--divider)] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{person.full_name || (person.username ? `@${person.username}` : person.email)}</p>
                  <p className="truncate text-xs text-[var(--text-secondary)]">{person.username ? `@${person.username}` : person.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={person.confirmed_at ? "success" : "warning"}>{person.confirmed_at ? "Active" : "Pending"}</Badge>
                  <Badge tone={person.role === "org_super_admin" ? "primary" : person.role === "team_leader" ? "info" : person.role === "manager" ? "warning" : "neutral"}>
                    {person.role.replaceAll("_", " ")}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Tasks · {tasks.length}</h2>
          <div className="mt-4 space-y-2">
            {tasks.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No tasks in this department yet.</p>}
            {tasks.map((task) => (
              <Card key={task.id} hover className="cursor-pointer !p-3" onClick={() => router.push(`/tasks/${task.id}`)}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-[var(--text-primary)]">{task.title}</p>
                  <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
                  <span>{STATUS_LABEL[task.status]}</span>
                  {task.due_date && <span>{new Date(task.due_date).toLocaleDateString()}</span>}
                </div>
              </Card>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Recent activity</h2>
          <div className="mt-4 space-y-2">
            {logs.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No recent activity.</p>}
            {logs.map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-3 border-b border-[var(--divider)] pb-2 text-sm last:border-0 last:pb-0">
                <span className="text-[var(--text-secondary)]">{activityLine(log)}</span>
                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{new Date(log.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
