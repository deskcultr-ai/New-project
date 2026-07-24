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
  role: "org_super_admin" | "team_leader" | "manager" | "executive";
  department_id: string | null;
  manager_id: string | null;
  invited_at: string | null;
  confirmed_at: string | null;
};

function roleBadgeTone(role: PersonStatus["role"]): "primary" | "info" | "warning" | "neutral" {
  if (role === "org_super_admin") return "primary";
  if (role === "team_leader") return "info";
  if (role === "manager") return "warning";
  return "neutral";
}

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
  const [inviteRole, setInviteRole] = useState<"team_leader" | "manager" | "executive">("executive");
  const [inviteManagerId, setInviteManagerId] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [managerAssignBusyId, setManagerAssignBusyId] = useState<string | null>(null);
  const [managerAssignError, setManagerAssignError] = useState("");

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

    const { data: depts } = await supabase.from("departments").select("id, name").eq("organization_id", me.organization_id).order("name");
    setDepartments(depts ?? []);
    if ((me.role === "team_leader" || me.role === "manager") && me.department_id) setInviteDeptId(me.department_id);
    if (me.role === "org_super_admin") setInviteRole("team_leader");

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

    const role = profile.role === "manager" ? "executive" : inviteRole;
    const managerId = role === "executive" && ["team_leader", "org_super_admin"].includes(profile.role) && inviteManagerId ? inviteManagerId : undefined;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const response = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ emails: inviteEmails, role, departmentId: inviteDeptId, ...(managerId ? { managerId } : {}) }),
    });
    const result = await response.json();

    setInviteBusy(false);
    if (!response.ok) {
      setInviteError(result.error ?? "Could not send the invites.");
      return;
    }

    const { succeeded = [], failed = [] } = result;
    setInviteEmails([]);
    setInviteManagerId("");

    if (succeeded.length > 0 && failed.length === 0) {
      setInviteNotice(`✓ Invite${succeeded.length > 1 ? "s" : ""} sent to ${succeeded.join(", ")}`);
    } else if (succeeded.length > 0 && failed.length > 0) {
      setInviteNotice(`✓ Sent to ${succeeded.join(", ")}. Failed: ${failed.map((f: {email:string}) => f.email).join(", ")}`);
    } else {
      setInviteError(`Failed to send invites. ${result.emailError ?? ""}`);
    }
    load();
  }

  async function reassignManager(executiveId: string, managerId: string) {
    setManagerAssignBusyId(executiveId);
    setManagerAssignError("");
    const { error } = await supabase.rpc("assign_executive_manager", {
      p_executive_id: executiveId,
      p_manager_id: managerId || null,
    });
    setManagerAssignBusyId(null);
    if (error) {
      setManagerAssignError(error.message);
      return;
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
            {profile.role === "org_super_admin"
              ? "Create the departments your organization is split into. Click any department to see its people, tasks, and activity."
              : profile.role === "manager"
              ? "Your department. Click it to see its people, tasks, and activity."
              : "Every department in your organization. Click one to see its people, tasks, and activity."}
          </p>
          {profile.role === "org_super_admin" && (
            <form onSubmit={createDepartment} className="mt-4 flex gap-3">
              <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="e.g. Marketing" className="flex-1" />
              <Button type="submit" disabled={deptBusy || !newDeptName.trim()}>
                {deptBusy ? "Adding..." : "Add department"}
              </Button>
            </form>
          )}
          {deptError && <Alert tone="danger" className="mt-3">{deptError}</Alert>}
          {deleteError && <Alert tone="danger" className="mt-3">{deleteError}</Alert>}

          {/* Grid of Department Cards -- Manager only ever sees their own department */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(profile.role === "manager" ? departments.filter((d) => d.id === profile.department_id) : departments).map((d, index) => {
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
                    {profile.role === "org_super_admin" && (
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
            {(profile.role === "manager" ? departments.filter((d) => d.id === profile.department_id) : departments).length === 0 && (
              <p className="text-sm text-[var(--text-tertiary)] col-span-full py-4 text-center">No departments yet.</p>
            )}
          </div>
        </Card>

        {/* Define deptName helper */}
        {(() => {
          const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
          return (
            <>
              <Card>
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Invite {profile.role === "org_super_admin" ? "People" : profile.role === "team_leader" ? "Managers or Executives" : "Executives"}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {profile.role === "org_super_admin"
                    ? "Pick a role and department, then add email addresses to invite."
                    : `Add email addresses and send invites to join ${deptName(profile.department_id)}.`}
                </p>
                <form onSubmit={sendInvite} className="mt-4 space-y-3">
                  <EmailChipsInput
                    emails={inviteEmails}
                    onChange={setInviteEmails}
                    placeholder={`Add ${inviteRole === "team_leader" ? "team leader" : inviteRole === "manager" ? "manager" : "executive"} email addresses...`}
                    disabled={inviteBusy}
                  />
                  <p className="text-xs text-[var(--text-tertiary)]">Type an email and press Enter, Tab, Space, or comma to add it. Paste multiple emails at once.</p>
                  <div className="flex flex-wrap gap-3 items-center">
                    {(profile.role === "org_super_admin" || profile.role === "team_leader") && (
                      <Select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as "team_leader" | "manager" | "executive")}
                        className="w-44"
                      >
                        {profile.role === "org_super_admin" && <option value="team_leader">As Team Leader</option>}
                        <option value="manager">As Manager</option>
                        <option value="executive">As Executive</option>
                      </Select>
                    )}
                    {profile.role === "org_super_admin" && (
                      <Select value={inviteDeptId} onChange={(e) => setInviteDeptId(e.target.value)} className="w-56">
                        <option value="">Select department</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </Select>
                    )}
                    {["team_leader", "org_super_admin"].includes(profile.role) && inviteRole === "executive" && (
                      <Select value={inviteManagerId} onChange={(e) => setInviteManagerId(e.target.value)} className="w-52">
                        <option value="">No manager (assign later)</option>
                        {people.filter((p) => p.role === "manager" && p.department_id === inviteDeptId).map((m) => (
                          <option key={m.profile_id} value={m.profile_id}>Reports to {m.full_name || personSubtitle(m)}</option>
                        ))}
                      </Select>
                    )}
                    <Button type="submit" disabled={inviteBusy || inviteEmails.length === 0 || !inviteDeptId}>
                      {inviteBusy ? `Sending ${inviteEmails.length > 1 ? `${inviteEmails.length} invites` : "invite"}...` : `Send ${inviteEmails.length > 1 ? `${inviteEmails.length} invites` : "invite"}`}
                    </Button>
                  </div>
                </form>
                {inviteError && <Alert tone="danger" className="mt-3">{inviteError}</Alert>}
                {inviteNotice && <Alert tone="success" className="mt-3">{inviteNotice}</Alert>}
              </Card>

              <Card>
                <h2 className="text-base font-bold text-[var(--text-primary)]">{profile.role === "org_super_admin" ? "Org directory" : profile.role === "team_leader" ? "Org directory" : "Your team"}</h2>
                {profile.role === "team_leader" && (
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">Everyone in your organization. You can reassign which Manager an Executive reports to below.</p>
                )}
                {profile.role === "manager" && (
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">Only Executives assigned to you.</p>
                )}
                {managerAssignError && <Alert tone="danger" className="mt-3">{managerAssignError}</Alert>}
                <div className="mt-4 space-y-3">
                  {(() => {
                    // org_people_status() already scopes rows correctly per role
                    // (org-wide for org_super_admin/team_leader, assigned-only for manager).
                    const visiblePeople = people;
                    if (visiblePeople.length === 0) return <p className="text-sm text-[var(--text-tertiary)]">Nobody here yet.</p>;
                    return visiblePeople.map((person) => {
                      const deptManagers = people.filter((p) => p.role === "manager" && p.department_id === person.department_id);
                      // Reassignment RPC scopes Team Leader to their own department; Org Super Admin can reassign anyone.
                      const canReassign = profile.role === "org_super_admin" || (profile.role === "team_leader" && person.department_id === profile.department_id);
                      return (
                        <div key={person.profile_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--divider)] pb-3 last:border-0 last:pb-0">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)] m-0">{person.full_name || personSubtitle(person)}</p>
                            <p className="text-xs text-[var(--text-secondary)] m-0 mt-1">{personSubtitle(person)} · {deptName(person.department_id)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone={person.confirmed_at ? "success" : "warning"}>{person.confirmed_at ? "Active" : "Pending"}</Badge>
                            <Badge tone={roleBadgeTone(person.role)}>
                              {person.role.replaceAll("_", " ")}
                            </Badge>
                            {person.role === "executive" && canReassign && (
                              <Select
                                value={person.manager_id ?? ""}
                                onChange={(e) => reassignManager(person.profile_id, e.target.value)}
                                disabled={managerAssignBusyId === person.profile_id}
                                className="h-8 w-40 text-xs"
                              >
                                <option value="">Unassigned</option>
                                {deptManagers.map((m) => (
                                  <option key={m.profile_id} value={m.profile_id}>{m.full_name || personSubtitle(m)}</option>
                                ))}
                              </Select>
                            )}
                          </div>
                        </div>
                      );
                    });
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
