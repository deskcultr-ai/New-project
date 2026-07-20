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

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-6">
        <Card className="max-w-md text-center">
          <h1 className="text-lg font-bold text-slate-900">Not authorized</h1>
          <p className="mt-2 text-sm text-slate-600">
            This screen is restricted to the platform owner. Sign in with an allowlisted email.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Organization requests</h1>
        <p className="mt-1 text-sm text-slate-500">Approve a request to create the organization and email its Super Admin claim invite.</p>

        {notice && <Alert tone="success" className="mt-4">{notice}</Alert>}
        {error && <Alert tone="danger" className="mt-4">{error}</Alert>}

        <div className="mt-6 space-y-4">
          {requests.length === 0 && <Card className="text-center text-sm text-slate-500">No requests yet.</Card>}
          {requests.map((req) => (
            <Card key={req.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-slate-900">{req.company_name}</h2>
                  <Badge tone={req.status === "pending" ? "warning" : req.status === "approved" ? "success" : "danger"}>
                    {req.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {req.contact_name} — {req.work_email}
                  {req.phone ? ` — ${req.phone}` : ""}
                </p>
                <p className="mt-1 text-xs text-slate-400">Requested {new Date(req.created_at).toLocaleString()}</p>
                {req.rejection_reason && <p className="mt-1 text-xs text-red-500">Reason: {req.rejection_reason}</p>}
              </div>
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
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
