"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getPostAuthRedirect } from "@/lib/auth-redirect";
import { Button, Input, Alert } from "@/components/ui";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  employee: "Employee",
};

type InviteInfo = {
  email: string;
  role: string;
  organizationName: string;
  departmentName: string | null;
};

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function lookup() {
      if (!token) {
        setLookupError("This invite link is missing its token.");
        setLoading(false);
        return;
      }
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`);
      const result = await response.json();
      if (!response.ok) {
        setLookupError(result.error ?? "This invite link is invalid.");
      } else {
        setInvite(result);
      }
      setLoading(false);
    }
    lookup();
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10) {
      setError("Use a password with at least 10 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");

    const response = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const result = await response.json();

    if (!response.ok) {
      setBusy(false);
      setError(result.error ?? "Could not activate your account.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: result.email, password });
    setBusy(false);
    if (signInError) {
      setError("Your account was created, but automatic sign-in failed. Please sign in from the login page.");
      return;
    }

    router.replace(await getPostAuthRedirect());
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f7efff_0%,#f0e9ff_58%,#faeaf8_100%)] px-6 py-8 text-slate-900">
      <div className="pointer-events-none absolute -left-36 -top-36 h-[520px] w-[520px] rounded-full bg-[#c7b6ff]/45 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 top-40 h-[620px] w-[620px] rounded-full bg-[#f7b8dc]/35 blur-3xl" />

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#7b61ff] to-[#5d42df] text-base font-black text-white shadow-[0_16px_40px_rgba(99,70,230,0.35)]">
            D
          </span>
          <span className="text-lg font-black tracking-tight text-slate-950">DeskCulture</span>
        </Link>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-md items-center py-8">
        <div className="w-full rounded-3xl border border-white/70 bg-white/82 p-7 shadow-[0_24px_60px_rgba(85,70,180,0.10)] backdrop-blur-xl sm:p-8">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
              <p className="text-sm font-semibold text-slate-600">Checking your invite...</p>
            </div>
          ) : lookupError ? (
            <div className="text-center">
              <h1 className="text-xl font-black tracking-tight text-slate-950">This invite isn&apos;t valid</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">{lookupError}</p>
              <Link href="/login" className="mt-5 inline-flex text-sm font-bold text-indigo-600 hover:text-indigo-500">
                Back to sign in
              </Link>
            </div>
          ) : invite ? (
            <>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">
                Join {invite.organizationName}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                You&apos;re accepting an invite as <strong>{ROLE_LABEL[invite.role] ?? invite.role}</strong>
                {invite.departmentName ? (
                  <>
                    {" "}
                    in <strong>{invite.departmentName}</strong>
                  </>
                ) : null}
                . Set a password to activate <strong>{invite.email}</strong>.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <label className="block text-sm font-semibold text-slate-700">
                  Password
                  <Input required type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 h-12 rounded-2xl" />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Confirm password
                  <Input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-2 h-12 rounded-2xl" />
                </label>
                {error && <Alert tone="danger">{error}</Alert>}
                <Button type="submit" disabled={busy} className="h-12 w-full rounded-2xl">
                  {busy ? "Activating..." : "Activate account"}
                </Button>
              </form>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteContent />
    </Suspense>
  );
}
