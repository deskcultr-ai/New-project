"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, displayName, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card, Badge } from "@/components/ui";
import { STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE, getDueUrgency, DUE_URGENCY_LABEL, DUE_URGENCY_TONE, type Task } from "@/lib/tasks";

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

  useEffect(() => {
    async function load() {
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
    }
    load();
  }, [router]);

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  return (
    <AppShell profile={profile} title="My Tasks" subtitle={`Welcome, ${displayName(profile)}.`}>
      <div className="space-y-3">
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
