"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Input, Select, Badge, Alert } from "@/components/ui";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL, PRIORITY_TONE, type Task, type TaskPriority } from "@/lib/tasks";

type Department = { id: string; name: string };
type DirectoryPerson = { id: string; full_name: string | null; email: string; role: string };

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
      supabase.from("profiles").select("id, full_name, email, role").order("full_name"),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    ]);

    setDepartments(depts ?? []);
    const eligibleRoles = me.role === "super_admin" ? ["admin", "employee"] : ["employee"];
    setAssignees(((people ?? []) as DirectoryPerson[]).filter((p) => eligibleRoles.includes(p.role)));
    setTasks((taskRows ?? []) as Task[]);
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

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const personName = (id: string | null) => (id ? assignees.find((p) => p.id === id)?.full_name || assignees.find((p) => p.id === id)?.email || "—" : "Unassigned");

  return (
    <AppShell profile={profile} title="Tasks" subtitle={profile.role === "super_admin" ? "Org-wide board" : "Your department's board"}>
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
              {profile.role === "super_admin" ? (
                <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                  Department
                  <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="mt-2">
                    <option value="">Select department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </Select>
                </label>
              ) : (
                <div className="text-sm font-semibold text-[var(--text-secondary)]">
                  Department
                  <p className="mt-2 rounded-xl border border-[var(--glass-border-soft)] bg-[var(--surface-soft)] px-3.5 py-2.5 text-sm text-[var(--text-secondary)]">{deptName(departmentId)}</p>
                </div>
              )}
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
                    <option key={p.id} value={p.id}>{p.full_name || p.email} ({p.role})</option>
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
