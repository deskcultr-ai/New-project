"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Input, Select, Badge, Alert } from "@/components/ui";

type Department = { id: string; name: string };
type DirectoryPerson = { id: string; full_name: string | null; email: string; role: string; department_id: string | null };
type Invite = {
  id: string;
  email: string;
  role: "super_admin" | "admin" | "employee";
  department_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function inviteStatus(invite: Invite): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (invite.accepted_at) return { label: "Accepted", tone: "success" };
  if (invite.revoked_at) return { label: "Revoked", tone: "neutral" };
  if (new Date(invite.expires_at).getTime() < Date.now()) return { label: "Expired", tone: "danger" };
  return { label: "Pending", tone: "warning" };
}

export default function AdminPeoplePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);

  const [newDeptName, setNewDeptName] = useState("");
  const [deptBusy, setDeptBusy] = useState(false);
  const [deptError, setDeptError] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDeptId, setInviteDeptId] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");

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

    const [{ data: depts }, { data: directory }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("organization_id", me.organization_id).order("name"),
      supabase.from("profiles").select("id, full_name, email, role, department_id").order("full_name"),
    ]);
    setDepartments(depts ?? []);
    setPeople((directory ?? []) as DirectoryPerson[]);
    if (me.role === "admin" && me.department_id) setInviteDeptId(me.department_id);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (token) {
      const response = await fetch("/api/invites", { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (response.ok) setInvites(result.invites);
    }

    setLoading(false);
  }, [router]);

  useEffect(() => {
    async function run() {
      await load();
    }
    run();
  }, [load]);

  async function createDepartment(event: React.FormEvent) {
    event.preventDefault();
    if (!newDeptName.trim() || !profile) return;
    setDeptBusy(true);
    setDeptError("");

    const { error } = await supabase.from("departments").insert({
      organization_id: profile.organization_id,
      name: newDeptName.trim(),
    });

    setDeptBusy(false);
    if (error) {
      setDeptError(error.message);
      return;
    }
    setNewDeptName("");
    load();
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !inviteEmail.trim() || !inviteDeptId) return;
    setInviteBusy(true);
    setInviteError("");
    setInviteNotice("");

    const role = profile.role === "super_admin" ? "admin" : "employee";
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const response = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: inviteEmail.trim(), role, departmentId: inviteDeptId }),
    });
    const result = await response.json();

    setInviteBusy(false);
    if (!response.ok) {
      setInviteError(result.error ?? "Could not send the invite.");
      return;
    }

    setInviteEmail("");
    setInviteNotice(result.emailSent ? "Invite sent." : `Invite created, but the email failed to send: ${result.emailError}`);
    load();
  }

  if (loading || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const visiblePeople = profile.role === "super_admin" ? people : people.filter((p) => p.department_id === profile.department_id || p.id === profile.id);

  return (
    <AppShell profile={profile} title={profile.role === "super_admin" ? "Departments & People" : "Team"}>
      <div className="space-y-8">
        {profile.role === "super_admin" && (
          <Card>
            <h2 className="text-base font-bold text-slate-900">Departments</h2>
            <p className="mt-1 text-sm text-slate-500">Create the departments your organization is split into.</p>
            <form onSubmit={createDepartment} className="mt-4 flex gap-3">
              <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="e.g. Marketing" className="flex-1" />
              <Button type="submit" disabled={deptBusy || !newDeptName.trim()}>
                {deptBusy ? "Adding..." : "Add department"}
              </Button>
            </form>
            {deptError && <Alert tone="danger" className="mt-3">{deptError}</Alert>}
            <div className="mt-4 flex flex-wrap gap-2">
              {departments.map((d) => (
                <Badge key={d.id} tone="primary">{d.name}</Badge>
              ))}
              {departments.length === 0 && <p className="text-sm text-slate-400">No departments yet.</p>}
            </div>
          </Card>
        )}

        <Card>
          <h2 className="text-base font-bold text-slate-900">
            Invite {profile.role === "super_admin" ? "an Admin" : "an Employee"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {profile.role === "super_admin"
              ? "Sends a single-use link to become the Admin of one department."
              : `Sends a single-use link to join ${deptName(profile.department_id)}.`}
          </p>
          <form onSubmit={sendInvite} className="mt-4 flex flex-wrap gap-3">
            <Input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="person@company.com"
              className="min-w-[220px] flex-1"
            />
            {profile.role === "super_admin" ? (
              <Select value={inviteDeptId} onChange={(e) => setInviteDeptId(e.target.value)} className="w-56">
                <option value="">Select department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            ) : null}
            <Button type="submit" disabled={inviteBusy || !inviteEmail.trim() || !inviteDeptId}>
              {inviteBusy ? "Sending..." : "Send invite"}
            </Button>
          </form>
          {inviteError && <Alert tone="danger" className="mt-3">{inviteError}</Alert>}
          {inviteNotice && <Alert tone="success" className="mt-3">{inviteNotice}</Alert>}
        </Card>

        <Card>
          <h2 className="text-base font-bold text-slate-900">{profile.role === "super_admin" ? "Org directory" : "Your team"}</h2>
          <div className="mt-4 space-y-3">
            {visiblePeople.length === 0 && <p className="text-sm text-slate-400">Nobody here yet.</p>}
            {visiblePeople.map((person) => (
              <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{person.full_name || person.email}</p>
                  <p className="text-xs text-slate-500">{person.email} · {deptName(person.department_id)}</p>
                </div>
                <Badge tone={person.role === "super_admin" ? "primary" : person.role === "admin" ? "info" : "neutral"}>
                  {person.role.replace("_", " ")}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-bold text-slate-900">Invites</h2>
          <div className="mt-4 space-y-3">
            {invites.length === 0 && <p className="text-sm text-slate-400">No invites yet.</p>}
            {invites.map((invite) => {
              const status = inviteStatus(invite);
              return (
                <div key={invite.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{invite.email}</p>
                    <p className="text-xs text-slate-500">
                      {invite.role === "admin" ? "Admin" : "Employee"} · {deptName(invite.department_id)}
                    </p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
