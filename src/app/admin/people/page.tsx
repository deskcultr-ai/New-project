"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Input, Select, Badge, Alert } from "@/components/ui";
import { EmailChipsInput } from "@/components/email-chips-input";

type Department = { id: string; name: string };
type PersonStatus = {
  profile_id: string;
  email: string;
  full_name: string | null;
  username: string | null;
  role: "super_admin" | "admin" | "employee";
  department_id: string | null;
  invited_at: string | null;
  confirmed_at: string | null;
};

function personSubtitle(person: PersonStatus): string {
  return person.username ? `@${person.username}` : person.email;
}

export default function AdminPeoplePage() {
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
  const [people, setPeople] = useState<PersonStatus[]>([]);

  const [newDeptName, setNewDeptName] = useState("");
  const [deptBusy, setDeptBusy] = useState(false);
  const [deptError, setDeptError] = useState("");

  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [inviteDeptId, setInviteDeptId] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");
  const [deleteError, setDeleteError] = useState("");

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

    const { data: depts } = await supabase.from("departments").select("id, name").eq("organization_id", me.organization_id).order("name");
    setDepartments(depts ?? []);
    if (me.role === "admin" && me.department_id) setInviteDeptId(me.department_id);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (token) {
      const response = await fetch("/api/invites", { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (response.ok) setPeople(result.people);
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

  async function deleteDepartment(deptId: string, event: React.MouseEvent) {
    event.stopPropagation();
    setDeleteError("");
    const confirmDelete = window.confirm("Are you sure you want to delete this department? This cannot be undone.");
    if (!confirmDelete) return;

    // Check if department contains members
    const hasMembers = people.some((p) => p.department_id === deptId);
    if (hasMembers) {
      alert("Cannot delete department. Please reassign or remove all members of this department first.");
      return;
    }

    // Check if department has tasks
    const { count, error: countErr } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("department_id", deptId);

    if (countErr) {
      setDeleteError("Failed to check tasks status: " + countErr.message);
      return;
    }

    if (count && count > 0) {
      alert(`Cannot delete department. It contains ${count} task(s). Reassign or delete tasks first.`);
      return;
    }

    const { error } = await supabase.from("departments").delete().eq("id", deptId);
    if (error) {
      setDeleteError("Deletion failed: " + error.message);
      return;
    }

    load();
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || inviteEmails.length === 0 || !inviteDeptId) return;
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
      body: JSON.stringify({ emails: inviteEmails, role, departmentId: inviteDeptId }),
    });
    const result = await response.json();

    setInviteBusy(false);
    if (!response.ok) {
      setInviteError(result.error ?? "Could not send the invites.");
      return;
    }

    const { succeeded = [], failed = [] } = result;
    setInviteEmails([]);

    if (succeeded.length > 0 && failed.length === 0) {
      setInviteNotice(`✓ Invite${succeeded.length > 1 ? "s" : ""} sent to ${succeeded.join(", ")}`);
    } else if (succeeded.length > 0 && failed.length > 0) {
      setInviteNotice(`✓ Sent to ${succeeded.join(", ")}. Failed: ${failed.map((f: {email:string}) => f.email).join(", ")}`);
    } else {
      setInviteError(`Failed to send invites. ${result.emailError ?? ""}`);
    }
    load();
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  return (
    <AppShell profile={profile} title="Departments & People">
      <div className="space-y-8">
        <Card>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Departments</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {profile.role === "super_admin"
              ? "Create the departments your organization is split into. Click any department to see its people, tasks, and activity."
              : "Every department in your organization. Click one to see its people, tasks, and activity."}
          </p>
          {profile.role === "super_admin" && (
            <form onSubmit={createDepartment} className="mt-4 flex gap-3">
              <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="e.g. Marketing" className="flex-1" />
              <Button type="submit" disabled={deptBusy || !newDeptName.trim()}>
                {deptBusy ? "Adding..." : "Add department"}
              </Button>
            </form>
          )}
          {deptError && <Alert tone="danger" className="mt-3">{deptError}</Alert>}
          {deleteError && <Alert tone="danger" className="mt-3">{deleteError}</Alert>}

          {/* Grid of Department Cards */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((d, index) => {
              const deptMembers = people.filter((p) => p.department_id === d.id);
              const gradients = [
                "linear-gradient(135deg,#818cf8,#6366f1)",
                "linear-gradient(135deg,#2dd4bf,#14b8a6)",
                "linear-gradient(135deg,#c084fc,#a855f7)",
                "linear-gradient(135deg,#f9a8d4,#f472b6)",
                "linear-gradient(135deg,#60a5fa,#3b82f6)"
              ];
              const grad = gradients[index % gradients.length];

              return (
                <div
                  key={d.id}
                  onClick={() => router.push(`/admin/departments/${d.id}`)}
                  className="glass-panel p-4 cursor-pointer hover:border-purple-500 transition-all rounded-2xl border border-[var(--glass-border-soft)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl flex items-center justify-center font-bold text-white text-sm shrink-0" style={{ background: grad }}>
                        {d.name.substring(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-[var(--text-primary)] m-0 truncate text-sm">{d.name}</p>
                        <p className="text-[var(--text-secondary)] m-0 mt-0.5 text-xs font-semibold">
                          {deptMembers.length} member{deptMembers.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    {profile.role === "super_admin" && (
                      <button
                        type="button"
                        onClick={(e) => deleteDepartment(d.id, e)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1.5 rounded-lg border-0 bg-transparent cursor-pointer shrink-0 transition-colors"
                        title="Delete Department"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-[18px] w-[18px]">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {departments.length === 0 && <p className="text-sm text-[var(--text-tertiary)] col-span-full py-4 text-center">No departments yet.</p>}
          </div>
        </Card>

        {/* Define deptName helper */}
        {(() => {
          const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
          return (
            <>
              <Card>
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Invite {profile.role === "super_admin" ? "Admins" : "Employees"}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {profile.role === "super_admin"
                    ? "Add email addresses and send invites to multiple admins at once."
                    : `Add email addresses and send invites to join ${deptName(profile.department_id)}.`}
                </p>
                <form onSubmit={sendInvite} className="mt-4 space-y-3">
                  <EmailChipsInput
                    emails={inviteEmails}
                    onChange={setInviteEmails}
                    placeholder={profile.role === "super_admin" ? "Add admin email addresses..." : "Add employee email addresses..."}
                    disabled={inviteBusy}
                  />
                  <p className="text-xs text-[var(--text-tertiary)]">Type an email and press Enter, Tab, Space, or comma to add it. Paste multiple emails at once.</p>
                  <div className="flex flex-wrap gap-3 items-center">
                    {profile.role === "super_admin" ? (
                      <Select value={inviteDeptId} onChange={(e) => setInviteDeptId(e.target.value)} className="w-56">
                        <option value="">Select department</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </Select>
                    ) : null}
                    <Button type="submit" disabled={inviteBusy || inviteEmails.length === 0 || !inviteDeptId}>
                      {inviteBusy ? `Sending ${inviteEmails.length > 1 ? `${inviteEmails.length} invites` : "invite"}...` : `Send ${inviteEmails.length > 1 ? `${inviteEmails.length} invites` : "invite"}`}
                    </Button>
                  </div>
                </form>
                {inviteError && <Alert tone="danger" className="mt-3">{inviteError}</Alert>}
                {inviteNotice && <Alert tone="success" className="mt-3">{inviteNotice}</Alert>}
              </Card>

              <Card>
                <h2 className="text-base font-bold text-[var(--text-primary)]">{profile.role === "super_admin" ? "Org directory" : "Your team"}</h2>
                {profile.role === "admin" && (
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    Your own department. Click any department card above to see people in other departments.
                  </p>
                )}
                <div className="mt-4 space-y-3">
                  {(() => {
                    const visiblePeople = profile.role === "admin" ? people.filter((p) => p.department_id === profile.department_id) : people;
                    if (visiblePeople.length === 0) return <p className="text-sm text-[var(--text-tertiary)]">Nobody here yet.</p>;
                    return visiblePeople.map((person) => (
                      <div key={person.profile_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--divider)] pb-3 last:border-0 last:pb-0">
                        <div>
                          <p className="text-sm font-semibold text-[var(--text-primary)] m-0">{person.full_name || personSubtitle(person)}</p>
                          <p className="text-xs text-[var(--text-secondary)] m-0 mt-1">{personSubtitle(person)} · {deptName(person.department_id)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={person.confirmed_at ? "success" : "warning"}>{person.confirmed_at ? "Active" : "Pending"}</Badge>
                          <Badge tone={person.role === "super_admin" ? "primary" : person.role === "admin" ? "info" : "neutral"}>
                            {person.role.replace("_", " ")}
                          </Badge>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </Card>
            </>
          );
        })()}
      </div>
    </AppShell>
  );
}
