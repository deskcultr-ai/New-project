"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";

type Department = { id: string; name: string };
type Person = { id: string; full_name: string | null; email: string };

export default function DriveOverviewPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [team, setTeam] = useState<Person[]>([]);

  useEffect(() => {
    async function load() {
      const me = await getProfile();
      if (!me) {
        router.replace("/login");
        return;
      }
      setProfile(me);

      const { data: depts } = await supabase.from("departments").select("id, name").eq("organization_id", me.organization_id).order("name");
      const allDepts = (depts ?? []) as Department[];
      setDepartments(me.role === "super_admin" ? allDepts : allDepts.filter((d) => d.id === me.department_id));

      if (me.role !== "employee") {
        const query = supabase.from("profiles").select("id, full_name, email").eq("organization_id", me.organization_id).neq("id", me.id);
        const { data: people } = me.role === "admin" ? await query.eq("department_id", me.department_id) : await query;
        setTeam((people ?? []) as Person[]);
      }

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
    <AppShell profile={profile} title="Org Drive" subtitle="Files, organized to match your org chart -- automatically.">
      <div className="space-y-8">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Departments</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((dept) => (
              <Card key={dept.id} hover className="cursor-pointer" onClick={() => router.push(`/drive/departments/${dept.id}`)}>
                <p className="text-sm font-bold text-slate-900">{dept.name}</p>
                <p className="mt-1 text-xs text-slate-500">Resources &amp; task files</p>
              </Card>
            ))}
            {departments.length === 0 && <p className="text-sm text-slate-400">No departments yet.</p>}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">My files</h2>
          <div className="mt-3 max-w-xs">
            <Card hover className="cursor-pointer" onClick={() => router.push(`/drive/personal/${profile.id}`)}>
              <p className="text-sm font-bold text-slate-900">My Personal Folder</p>
              <p className="mt-1 text-xs text-slate-500">Private working space</p>
            </Card>
          </div>
        </div>

        {profile.role !== "employee" && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Team personal folders</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {team.map((person) => (
                <Card key={person.id} hover className="cursor-pointer" onClick={() => router.push(`/drive/personal/${person.id}`)}>
                  <p className="text-sm font-bold text-slate-900">{person.full_name || person.email}</p>
                  <p className="mt-1 text-xs text-slate-500">Personal folder</p>
                </Card>
              ))}
              {team.length === 0 && <p className="text-sm text-slate-400">Nobody here yet.</p>}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
