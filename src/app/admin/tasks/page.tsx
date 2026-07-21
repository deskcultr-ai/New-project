"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Input, Select, Badge, Alert } from "@/components/ui";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL, PRIORITY_TONE, type Task, type TaskPriority } from "@/lib/tasks";

type Department = { id: string; name: string };
type DirectoryPerson = { id: string; full_name: string | null; username: string | null; email: string; role: string };
type ForwardRequest = {
  id: string;
  task_id: string;
  reason: string;
  status: string;
  created_at: string;
  requested_by: { id: string; full_name: string | null; username: string | null; email: string } | null;
  forward_to: { id: string; full_name: string | null; username: string | null; email: string } | null;
  task: { id: string; title: string; department_id: string } | null;
};

export default function AdminTasksPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [assignees, setAssignees] = useState<DirectoryPerson[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [forwardRequests, setForwardRequests] = useState<ForwardRequest[]>([]);
  const [forwardBusyId, setForwardBusyId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});
  const [forwardNotice, setForwardNotice] = useState("");

  const load = useCallback(async () => {
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
    if (me.role === "admin" && me.department_id) setDepartmentId(me.department_id);

    const [{ data: depts }, { data: people }, { data: taskRows }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("organization_id", me.organization_id).order("name"),
      supabase.from("profiles").select("id, full_name, username, email, role").order("full_name"),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    ]);

    setDepartments(depts ?? []);
    const eligibleRoles = me.role === "super_admin" ? ["admin", "employee"] : ["employee"];
    setAssignees(((people ?? []) as DirectoryPerson[]).filter((p) => eligibleRoles.includes(p.role)));
    setTasks((taskRows ?? []) as Task[]);

    // Load pending forward requests
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (token) {
      const res = await fetch("/api/task-forward", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (res.ok) setForwardRequests(json.requests ?? []);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    async function run() {
      await load();
    }
    run();
  }, [load]);

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !title.trim() || !departmentId) return;
    setBusy(true);
    setError("");

    const { error: insertError } = await supabase.from("tasks").insert({
      organization_id: profile.organization_id,
      department_id: departmentId,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: dueDate || null,
      created_by: profile.id,
      assigned_to: assigneeId || null,
    });

    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setAssigneeId("");
    load();
  }

  async function reviewForward(requestId: string, action: "approve" | "reject") {
    setForwardBusyId(requestId);
    setForwardNotice("");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/task-forward", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId, action, rejectionNote: rejectNote[requestId] }),
    });
    const json = await res.json();
    setForwardBusyId(null);
    if (!res.ok) { setError(json.error ?? "Failed to review request."); return; }
    setForwardNotice(action === "approve" ? "✅ Task reassigned successfully!" : "❌ Request rejected.");
    setForwardRequests((prev) => prev.filter((r) => r.id !== requestId));
    load();
  }

  const personDisplayName = (p: { full_name: string | null; username: string | null; email: string } | null) =>
    p ? (p.username ? `@${p.username}` : p.full_name || p.email) : "Unknown";

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const personName = (id: string | null) => {
    if (!id) return "Unassigned";
    const p = assignees.find((a) => a.id === id);
    if (!p) return "—";
    return p.username ? `@${p.username}` : p.full_name || p.email;
  };

  return (
    <AppShell profile={profile} title="Tasks" subtitle="Org-wide board">
      <div className="space-y-8">
        <Card>
          <h2 className="text-base font-bold text-[var(--text-primary)]">New task</h2>
          <form onSubmit={createTask} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                Title
                <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Design the onboarding email" className="mt-2" />
              </label>
              <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                Due date
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-2" />
              </label>
            </div>
            <label className="block text-sm font-semibold text-[var(--text-secondary)]">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-2 w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b5cf6] focus:ring-4 focus:ring-[#8b5cf6]/20 backdrop-blur-xl"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                Department
                <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="mt-2">
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                Priority
                <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="mt-2">
                  {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                Assign to
                <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="mt-2">
                  <option value="">Unassigned</option>
                  {assignees.map((p) => (
                    <option key={p.id} value={p.id}>{p.username ? `@${p.username}` : p.full_name || p.email} ({p.role})</option>
                  ))}
                </Select>
              </label>
            </div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" disabled={busy || !title.trim() || !departmentId}>
              {busy ? "Creating..." : "Create task"}
            </Button>
          </form>
        </Card>

        {/* Forward Requests Panel */}
        {forwardRequests.length > 0 && (
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              </span>
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)] m-0">Reassignment Requests</h2>
                <p className="text-xs text-[var(--text-tertiary)] m-0">{forwardRequests.length} pending</p>
              </div>
            </div>
            {forwardNotice && <Alert tone="success" className="mb-4">{forwardNotice}</Alert>}
            <div className="space-y-4">
              {forwardRequests.map((req) => (
                <div key={req.id} className="rounded-xl border border-[var(--divider)] bg-[var(--surface-faint)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[var(--text-primary)] m-0">{req.task?.title ?? "(deleted task)"}</p>
                      <p className="text-xs text-[var(--text-secondary)] m-0 mt-1">
                        <span className="font-semibold text-purple-400">{personDisplayName(req.requested_by)}</span>
                        {" → "}
                        <span className="font-semibold text-emerald-400">{personDisplayName(req.forward_to)}</span>
                      </p>
                      <p className="mt-2 text-xs text-[var(--text-secondary)] italic">"{req.reason}"</p>
                      {req.status === "pending" && (
                        <div className="mt-3 space-y-2">
                          <Input
                            value={rejectNote[req.id] ?? ""}
                            onChange={(e) => setRejectNote((prev) => ({ ...prev, [req.id]: e.target.value }))}
                            placeholder="Rejection note (optional)"
                            className="h-9 text-xs"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              disabled={forwardBusyId === req.id}
                              onClick={() => reviewForward(req.id, "approve")}
                              className="h-8 text-xs px-3"
                            >
                              {forwardBusyId === req.id ? "..." : "✅ Approve"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={forwardBusyId === req.id}
                              onClick={() => reviewForward(req.id, "reject")}
                              className="h-8 text-xs px-3 text-red-400 hover:bg-red-500/10"
                            >
                              ❌ Reject
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-[var(--text-tertiary)] shrink-0">
                      {new Date(req.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-4">
          {STATUS_ORDER.map((status) => (
            <div key={status}>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                {STATUS_LABEL[status]} · {tasks.filter((t) => t.status === status).length}
              </h3>
              <div className="space-y-3">
                {tasks.filter((t) => t.status === status).map((task) => (
                  <Card
                    key={task.id}
                    hover
                    className="cursor-pointer"
                    onClick={() => router.push(`/tasks/${task.id}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-[var(--text-primary)]">{task.title}</p>
                      {task.is_blocked && <Badge tone="danger">Blocked</Badge>}
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">{personName(task.assigned_to)} · {deptName(task.department_id)}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
                      {task.due_date && <span className="text-xs text-[var(--text-tertiary)]">{new Date(task.due_date).toLocaleDateString()}</span>}
                    </div>
                  </Card>
                ))}
                {tasks.filter((t) => t.status === status).length === 0 && (
                  <p className="text-sm text-[var(--text-tertiary)]">No tasks.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
