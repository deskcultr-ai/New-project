"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button, Card, Badge, Alert } from "@/components/ui";

type OrgRequest = {
  id: string;
  company_name: string;
  contact_name: string;
  work_email: string;
  phone: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

function isAllowedOwner(email: string | null | undefined) {
  const allowlist = process.env.NEXT_PUBLIC_PLATFORM_OWNER_EMAILS ?? "";
  const list = allowlist.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

export default function PlatformAdminRequestsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [requests, setRequests] = useState<OrgRequest[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!isAllowedOwner(session.user.email)) {
      setAuthorized(false);
      setLoading(false);
      return;
    }
    setAuthorized(true);

    const response = await fetch("/api/platform-admin/requests", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Could not load requests.");
    } else {
      setRequests(result.requests);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    async function run() {
      // Platform admin page always uses the dark theme since it's outside AppShell
      const savedTheme = typeof window !== "undefined" ? localStorage.getItem("theme") as "dark" | "light" | null : null;
      document.documentElement.setAttribute("data-theme", savedTheme ?? "dark");
      await load();
    }
    run();
  }, [load]);

  async function act(requestId: string, action: "approve" | "reject") {
    setBusyId(requestId);
    setError("");
    setNotice("");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const rejectionReason =
      action === "reject" ? window.prompt("Reason for rejecting (optional):") ?? undefined : undefined;

    const response = await fetch("/api/platform-admin/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId, action, rejectionReason }),
    });
    const result = await response.json();

    setBusyId(null);
    if (!response.ok) {
      setError(result.error ?? "Could not update this request.");
      return;
    }

    if (action === "approve") {
      setNotice(result.emailSent ? "Approved — the Super Admin claim invite was emailed." : `Approved, but the invite email failed to send: ${result.emailError}`);
    } else {
      setNotice("Request rejected.");
    }

    load();
  }

  async function deleteRequest(requestId: string, status: OrgRequest["status"]) {
    const confirmMessage =
      status === "approved"
        ? "This organization is live. Deleting it will permanently remove the org, every person in it (Super Admin, Admins, Employees -- nobody will be able to log in again), all their tasks/messages/files, and this request. They'd need to submit a brand new request to get back in. Continue?"
        : "Are you sure you want to delete this request permanently?";
    if (!window.confirm(confirmMessage)) return;
    setBusyId(requestId);
    setError("");
    setNotice("");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const response = await fetch(`/api/platform-admin/requests?id=${requestId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json().catch(() => ({}));

    setBusyId(null);
    if (!response.ok) {
      setError(result.error ?? "Could not delete this request.");
      return;
    }

    setNotice(status === "approved" ? "Organization and everyone in it were deleted." : "Request deleted successfully.");
    load();
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 px-6">
        <Card className="max-w-md text-center">
          <h1 className="text-lg font-bold text-[var(--text-primary)]">Not authorized</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            This screen is restricted to the platform owner. Sign in with an allowlisted email.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">Organization requests</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Approve a request to create the organization and email its Super Admin claim invite.</p>

        {notice && <Alert tone="success" className="mt-4">{notice}</Alert>}
        {error && <Alert tone="danger" className="mt-4">{error}</Alert>}

        <div className="mt-6 space-y-4">
          {requests.length === 0 && <Card className="text-center text-sm text-[var(--text-tertiary)]">No requests yet.</Card>}
          {requests.map((req) => (
            <Card key={req.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-[var(--text-primary)] m-0">{req.company_name}</h2>
                  <Badge tone={req.status === "pending" ? "warning" : req.status === "approved" ? "success" : "danger"}>
                    {req.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)] m-0">
                  {req.contact_name} — {req.work_email}
                  {req.phone ? ` — ${req.phone}` : ""}
                </p>
                <p className="mt-1 text-xs text-[var(--text-tertiary)] m-0">Requested {new Date(req.created_at).toLocaleString()}</p>
                {req.rejection_reason && <p className="mt-1 text-xs text-red-500 m-0">Reason: {req.rejection_reason}</p>}
              </div>
              <div className="flex items-center gap-3">
                {req.status === "pending" && (
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={busyId === req.id} onClick={() => act(req.id, "reject")}>
                      Reject
                    </Button>
                    <Button disabled={busyId === req.id} onClick={() => act(req.id, "approve")}>
                      {busyId === req.id ? "Working..." : "Approve"}
                    </Button>
                  </div>
                )}
                <button
                  type="button"
                  disabled={busyId === req.id}
                  onClick={() => deleteRequest(req.id, req.status)}
                  className="grid h-10 w-10 place-items-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50 transition cursor-pointer shrink-0"
                  title={req.status === "approved" ? "Delete organization and everyone in it" : "Delete Request"}
                  aria-label={req.status === "approved" ? "Delete organization and everyone in it" : "Delete Request"}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
