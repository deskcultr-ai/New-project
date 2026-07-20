"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getPostAuthRedirectSafe } from "@/lib/auth-redirect";
import { withTimeout } from "@/lib/with-timeout";
import { Button, Input, Alert } from "@/components/ui";

type Mode = "password" | "otp";
type OtpStep = "email" | "code";

function authErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  if (typeof error === "object") {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}


export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [otpStep, setOtpStep] = useState<OtpStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setOtpStep("email");
    setCode("");
    setError("");
    setMessage("");
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const { error: signInError } = await withTimeout(supabase.auth.signInWithPassword({ email: email.trim(), password }), 15000);
      if (signInError) {
        setBusy(false);
        setError(authErrorMessage(signInError, "Unable to sign in. Check your email and password."));
        return;
      }
      router.replace(await getPostAuthRedirectSafe());
    } catch (timeoutError) {
      setBusy(false);
      setError(authErrorMessage(timeoutError, "Something went wrong. Try again."));
    }
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    let otpError: unknown = null;
    try {
      ({ error: otpError } = await withTimeout(supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } }), 15000));
    } catch (timeoutError) {
      otpError = timeoutError;
    }

    setBusy(false);
    if (otpError) {
      setError(authErrorMessage(otpError, "Could not send a code. Ask your admin for an invite if you don't have an account yet."));
      return;
    }
    setMessage("We sent a 6-digit code to your email.");
    setOtpStep("code");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const { error: verifyError } = await withTimeout(
        supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" }),
        15000
      );
      if (verifyError) {
        setBusy(false);
        setError(authErrorMessage(verifyError, "That code didn't work. Request a new one and use only the latest email."));
        return;
      }
      router.replace(await getPostAuthRedirectSafe());
    } catch (timeoutError) {
      setBusy(false);
      setError(authErrorMessage(timeoutError, "Something went wrong. Try again."));
    }
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
        <Link href="/request-org" className="text-sm font-bold text-indigo-600 hover:text-indigo-500">
          Request an organization
        </Link>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-md items-center py-8">
        <div className="w-full rounded-3xl border border-white/70 bg-white/82 p-7 shadow-[0_24px_60px_rgba(85,70,180,0.10)] backdrop-blur-xl sm:p-8">
          <div className="grid grid-cols-2 rounded-2xl bg-indigo-500/10 p-1 text-sm font-bold">
            <button
              type="button"
              onClick={() => switchMode("password")}
              className={`h-10 rounded-xl transition ${mode === "password" ? "bg-gradient-to-r from-indigo-600 to-violet-500 text-white shadow-md" : "text-slate-500"}`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => switchMode("otp")}
              className={`h-10 rounded-xl transition ${mode === "otp" ? "bg-gradient-to-r from-indigo-600 to-violet-500 text-white shadow-md" : "text-slate-500"}`}
            >
              Email code
            </button>
          </div>

          <h1 className="mt-7 text-2xl font-extrabold tracking-tight text-slate-950">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in to your DeskCulture workspace.</p>

          {mode === "password" ? (
            <form onSubmit={submitPassword} className="mt-6 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">
                Email address
                <Input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-2 h-12 rounded-2xl" />
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                Password
                <Input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 h-12 rounded-2xl" />
              </label>
              {error && <Alert tone="danger">{error}</Alert>}
              <Button type="submit" disabled={busy} className="h-12 w-full rounded-2xl">
                {busy ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          ) : otpStep === "email" ? (
            <form onSubmit={requestCode} className="mt-6 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">
                Email address
                <Input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-2 h-12 rounded-2xl" />
              </label>
              {error && <Alert tone="danger">{error}</Alert>}
              <Button type="submit" disabled={busy} className="h-12 w-full rounded-2xl">
                {busy ? "Sending..." : "Send code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="mt-6 space-y-4">
              {message && <Alert tone="info">{message}</Alert>}
              <label className="block text-sm font-semibold text-slate-700">
                6-digit code
                <Input
                  required
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="mt-2 h-12 rounded-2xl font-mono tracking-widest"
                />
                <span className="mt-1 block text-xs font-normal text-slate-400">Use the code from your most recent email only.</span>
              </label>
              {error && <Alert tone="danger">{error}</Alert>}
              <Button type="submit" disabled={busy} className="h-12 w-full rounded-2xl">
                {busy ? "Verifying..." : "Verify & sign in"}
              </Button>
              <button type="button" onClick={() => setOtpStep("email")} className="w-full text-center text-sm font-semibold text-slate-500 hover:text-slate-700">
                Use a different email
              </button>
            </form>
          )}

          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75M6 10.5h12a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5V12A1.5 1.5 0 0 1 6 10.5Z" />
            </svg>
            DeskCulture is invite-only. Accounts are created from an invite link, never a public sign-up form.
          </div>
        </div>
      </section>
    </main>
  );
}
