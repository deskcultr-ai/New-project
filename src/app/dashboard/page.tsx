"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, displayName, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Badge, Input, Select, Alert } from "@/components/ui";
import { STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE, getDueUrgency, DUE_URGENCY_LABEL, DUE_URGENCY_TONE, type Task, type TaskPriority } from "@/lib/tasks";

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [tasks, setTasks] = useState<Task[]>([]);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  const load = useCallback(async () => {
    const me = await getProfile();
    if (!me) {
      router.replace("/login");
      return;
    }
    if (me.role !== "executive") {
      router.replace("/admin");
      return;
    }
    setProfile(me);
    sessionStorage.setItem("user_profile", JSON.stringify(me));

    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("assigned_to", me.id)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false });
    setTasks((data ?? []) as Task[]);
  }, [router]);

  useEffect(() => {
    async function run() {
      await load();
    }
    run();
  }, [load]);

  async function createOwnTask(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !newTitle.trim()) return;
    setCreateBusy(true);
    setCreateError("");

    const { error } = await supabase.from("tasks").insert({
      organization_id: profile.organization_id,
      department_id: profile.department_id,
      title: newTitle.trim(),
      description: newDescription.trim() || null,
      priority: newPriority,
      due_date: newDueDate || null,
      created_by: profile.id,
      assigned_to: profile.id,
    });

    setCreateBusy(false);
    if (error) {
      setCreateError(error.message);
      return;
    }
    setNewTitle("");
    setNewDescription("");
    setNewPriority("medium");
    setNewDueDate("");
    load();
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  return (
    <AppShell profile={profile} title="My Tasks" subtitle={`Welcome, ${displayName(profile)}.`}>
      <div className="space-y-6">
        <Card>
          <h2 className="text-base font-bold text-slate-900">New task</h2>
          <p className="mt-1 text-sm text-slate-500">Create a task for yourself.</p>
          <form onSubmit={createOwnTask} className="mt-4 space-y-3">
            <Input required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              placeholder="Description (optional)"
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20"
            />
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={newPriority} onChange={(e) => setNewPriority(e.target.value as TaskPriority)} className="w-40">
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
              <Input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="w-44" />
              <Button type="submit" disabled={createBusy || !newTitle.trim()}>
                {createBusy ? "Creating..." : "Create task"}
              </Button>
            </div>
          </form>
          {createError && <Alert tone="danger" className="mt-3">{createError}</Alert>}
        </Card>

        {tasks.length === 0 && (
          <Card className="text-center text-sm text-slate-500">Nothing assigned to you yet.</Card>
        )}
        {tasks.map((task) => {
          const urgency = getDueUrgency(task.due_date, task.status);
          return (
            <Card key={task.id} hover className="cursor-pointer" onClick={() => router.push(`/tasks/${task.id}`)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{task.title}</p>
                  {task.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{task.description}</p>}
                </div>
                {task.is_blocked && <Badge tone="danger">Blocked</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{STATUS_LABEL[task.status]}</Badge>
                <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
                {urgency && <Badge tone={DUE_URGENCY_TONE[urgency]}>{DUE_URGENCY_LABEL[urgency]}</Badge>}
                {task.due_date && <span className="text-xs text-slate-400">Due {new Date(task.due_date).toLocaleDateString()}</span>}
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
