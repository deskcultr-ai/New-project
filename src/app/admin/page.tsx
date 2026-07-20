"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { STATUS_LABEL, STATUS_ORDER, type TaskStatus } from "@/lib/tasks";

export default function AdminOverviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orgName, setOrgName] = useState("");
  const [departmentCount, setDepartmentCount] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<TaskStatus, number>>({
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
  });

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

      const [{ data: org }, { count: deptCount }, { data: tasks }] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", me.organization_id).maybeSingle(),
        supabase.from("departments").select("id", { count: "exact", head: true }).eq("organization_id", me.organization_id),
        supabase.from("tasks").select("status"),
      ]);

      setOrgName(org?.name ?? "");
      setDepartmentCount(deptCount ?? 0);

      const counts: Record<TaskStatus, number> = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
      for (const task of tasks ?? []) {
        const status = task.status as TaskStatus;
        counts[status] = (counts[status] ?? 0) + 1;
      }
      setStatusCounts(counts);
      setLoading(false);
    }
    load();
  }, [router]);

  if (loading || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  return (
    <AppShell profile={profile} title="Overview" subtitle={orgName}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Departments</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{departmentCount}</p>
        </Card>
        {STATUS_ORDER.map((status) => (
          <Card key={status}>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{STATUS_LABEL[status]}</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{statusCounts[status]}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-sm text-slate-500">
        {profile.role === "super_admin"
          ? "Task counts are org-wide."
          : "Task counts cover your department's tasks and tasks assigned to your team."}
      </p>
    </AppShell>
  );
}
