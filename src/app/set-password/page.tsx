"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getPostAuthRedirectSafe } from "@/lib/auth-redirect";
import { withTimeout } from "@/lib/with-timeout";
import { Button, Input, Alert } from "@/components/ui";

export default function SetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function check() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? "");
      setChecking(false);
    }
    check();
  }, [router]);

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
    try {
      const { error: updateError } = await withTimeout(supabase.auth.updateUser({ password }), 15000);
      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
      router.replace(await getPostAuthRedirectSafe());
    } catch (timeoutError) {
      setBusy(false);
      setError(timeoutError instanceof Error ? timeoutError.message : "Something went wrong. Try again.");
    }
  }

  async function skip() {
    router.replace(await getPostAuthRedirectSafe());
  }

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f7efff_0%,#f0e9ff_58%,#faeaf8_100%)] px-6 py-8 text-slate-900">
      <div className="pointer-events-none absolute -left-36 -top-36 h-[520px] w-[520px] rounded-full bg-[#c7b6ff]/45 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 top-40 h-[620px] w-[620px] rounded-full bg-[#f7b8dc]/35 blur-3xl" />

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-md items-center py-8">
        <div className="w-full rounded-3xl border border-white/70 bg-white/82 p-7 shadow-[0_24px_60px_rgba(85,70,180,0.10)] backdrop-blur-xl sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Set a password</h1>
          <p className="mt-2 text-sm text-slate-600">
            You&apos;re signed in as <strong>{email}</strong>. Set a password now, or skip and always sign in with an
            emailed code instead.
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
              {busy ? "Saving..." : "Set password & continue"}
            </Button>
          </form>

          <button type="button" onClick={skip} className="mt-4 w-full text-center text-sm font-semibold text-slate-500 hover:text-slate-700">
            Skip — I&apos;ll sign in with an emailed code
          </button>
        </div>
      </section>
    </main>
  );
}
