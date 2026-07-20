"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, Alert } from "@/components/ui";

export default function RequestOrgPage() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const response = await fetch("/api/org-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, contactName, workEmail, phone }),
    });
    const result = await response.json();

    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "Could not submit your request. Try again.");
      return;
    }
    setSubmitted(true);
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
        <Link href="/login" className="text-sm font-bold text-indigo-600 hover:text-indigo-500">
          Sign in
        </Link>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-md items-center py-8">
        <div className="w-full rounded-3xl border border-white/70 bg-white/82 p-7 shadow-[0_24px_60px_rgba(85,70,180,0.10)] backdrop-blur-xl sm:p-8">
          {submitted ? (
            <div className="text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-6 w-6">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <h1 className="mt-5 text-2xl font-black tracking-tight">Request received</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Thanks — we&apos;ll review your request and email the contact address with next steps once your
                organization is approved.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Request an organization</h1>
              <p className="mt-2 text-sm text-slate-600">
                Tell us about your company. Once approved, we&apos;ll email the contact address an invite to become
                your organization&apos;s Super Admin.
              </p>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <label className="block text-sm font-semibold text-slate-700">
                  Company name
                  <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc" className="mt-2 h-12 rounded-2xl" />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Contact person
                  <Input required value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jordan Lee" className="mt-2 h-12 rounded-2xl" />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Work email
                  <Input required type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} placeholder="jordan@acme.com" className="mt-2 h-12 rounded-2xl" />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Phone (optional)
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" className="mt-2 h-12 rounded-2xl" />
                </label>

                {error && <Alert tone="danger">{error}</Alert>}

                <Button type="submit" disabled={busy} className="h-12 w-full rounded-2xl">
                  {busy ? "Submitting..." : "Request access"}
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
