"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getPostAuthRedirect } from "@/lib/auth-redirect";
import LandingVisual from "@/components/landing-visual";

type Feature = { label: string; description: string; accent: string; icon: React.ReactNode };

const features: Feature[] = [
  {
    label: "Tasks",
    description: "Plan and track work",
    accent: "bg-indigo-500/10 text-indigo-600",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    ),
  },
  {
    label: "Meetings",
    description: "Schedule and join meetings",
    accent: "bg-emerald-500/10 text-emerald-600",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="m15.75 10.5 4.72-2.36a.75.75 0 0 1 1.03.67v9.38a.75.75 0 0 1-1.03.67l-4.72-2.36M4.5 6.75h9a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Z"
      />
    ),
  },
  {
    label: "Reviews",
    description: "Review work and approvals",
    accent: "bg-violet-500/10 text-violet-600",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="m11.48 3.499 1.912 3.878a.6.6 0 0 0 .45.328l4.28.622c.49.071.686.674.331 1.02l-3.098 3.02a.6.6 0 0 0-.173.531l.731 4.262c.084.487-.428.858-.865.629l-3.83-2.014a.6.6 0 0 0-.558 0l-3.83 2.014c-.437.23-.949-.142-.865-.63l.731-4.26a.6.6 0 0 0-.173-.531l-3.098-3.02c-.355-.346-.159-.949.331-1.02l4.28-.622a.6.6 0 0 0 .45-.328l1.912-3.878c.219-.44.844-.44 1.063 0Z"
      />
    ),
  },
  {
    label: "Reports",
    description: "Track performance and trends",
    accent: "bg-cyan-500/10 text-cyan-600",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21M7.5 15.75V12M12 15.75V8.25M16.5 15.75v-4.5M21 15.75V6"
      />
    ),
  },
  {
    label: "Attendance",
    description: "Mark and manage attendance",
    accent: "bg-blue-500/10 text-blue-600",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M12 6.75V12l3 1.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    ),
  },
  {
    label: "Team",
    description: "Collaborate across departments",
    accent: "bg-purple-500/10 text-purple-600",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    ),
  },
];

const solutions: { title: string; blurb: string; points: string[] }[] = [
  {
    title: "For Managers",
    blurb: "Stay on top of approvals and team output without chasing updates.",
    points: ["Approve tasks and requests", "Track team performance", "Audit every decision"],
  },
  {
    title: "For Teams",
    blurb: "One place to plan work, meet, and share files across departments.",
    points: ["Plan and assign tasks", "Schedule and join meetings", "Collaborate in real time"],
  },
  {
    title: "For Operations",
    blurb: "Keep attendance, registrations, and reporting accurate and simple.",
    points: ["Manage attendance", "Handle registrations", "Export clear reports"],
  },
];

const resources: { title: string; blurb: string }[] = [
  { title: "Documentation", blurb: "Step-by-step guides to set up your workspace and roles." },
  { title: "Product Guides", blurb: "Learn how tasks, meetings, and approvals fit together." },
  { title: "Changelog", blurb: "See what's new and improved across DeskCulture." },
  { title: "Support", blurb: "Reach the team when you need a hand getting unblocked." },
];

const pricing: { name: string; price: string; note: string; features: string[]; featured: boolean }[] = [
  {
    name: "Starter",
    price: "Free",
    note: "For small teams getting organized.",
    features: ["Up to 10 members", "Tasks & meetings", "Basic reports"],
    featured: false,
  },
  {
    name: "Team",
    price: "$8",
    note: "Per member / month. For growing teams.",
    features: ["Unlimited members", "Approvals & reviews", "Attendance & registrations", "Advanced reports"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    note: "For organizations that need control.",
    features: ["SSO & audit logs", "Custom roles", "Priority support", "Dedicated onboarding"],
    featured: false,
  },
];

export default function HomePage() {
  const [signedIn, setSignedIn] = useState(false);
  const [appHref, setAppHref] = useState("/dashboard");

  // The landing page is public: never auto-redirect a signed-in visitor away
  // from it. Just swap the nav for a link into their workspace.
  useEffect(() => {
    async function check() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      setSignedIn(true);
      setAppHref(await getPostAuthRedirect());
    }
    check();
  }, []);

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[linear-gradient(180deg,#f7efff_0%,#f0e9ff_58%,#faeaf8_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-36 -top-36 h-[520px] w-[520px] rounded-full bg-[#c7b6ff]/45 blur-3xl" />
        <div className="absolute -right-40 top-40 h-[620px] w-[620px] rounded-full bg-[#f7b8dc]/35 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-[460px] w-[460px] rounded-full bg-[#bfe9ff]/35 blur-3xl" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#7b61ff] to-[#5d42df] text-base font-black text-white shadow-[0_16px_40px_rgba(99,70,230,0.35)]">
            D
          </div>
          <span className="text-lg font-black tracking-tight text-slate-950">DeskCulture</span>
        </Link>

        <nav className="hidden items-center gap-9 text-sm font-medium text-slate-700 md:flex">
          <a href="#features" className="transition hover:text-indigo-600">
            Features
          </a>
          <a href="#solutions" className="transition hover:text-indigo-600">
            Solutions
          </a>
          <a href="#resources" className="transition hover:text-indigo-600">
            Resources
          </a>
          <a href="#pricing" className="transition hover:text-indigo-600">
            Pricing
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-slate-800 transition hover:text-indigo-600 sm:inline"
          >
            Log In
          </Link>
          {signedIn ? (
            <Link
              href={appHref}
              className="inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-[#6f51f5] to-[#7f50f0] px-6 text-sm font-bold text-white shadow-[0_16px_40px_rgba(99,70,230,0.35)] transition hover:-translate-y-0.5"
            >
              Go to workspace
            </Link>
          ) : (
            <Link
              href="/register"
              className="inline-flex h-10 items-center justify-center rounded-full bg-gradient-to-r from-[#6f51f5] to-[#7f50f0] px-6 text-sm font-bold text-white shadow-[0_16px_40px_rgba(99,70,230,0.35)] transition hover:-translate-y-0.5"
            >
              Sign Up
            </Link>
          )}
        </div>
      </header>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-10 px-6 pb-24 pt-20 lg:min-h-[calc(100vh-92px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] lg:pt-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/65 px-4 py-1.5 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M12 2.5c.3 0 .57.2.66.48l1.72 5.14 5.14 1.72a.7.7 0 0 1 0 1.32l-5.14 1.72-1.72 5.14a.7.7 0 0 1-1.32 0l-1.72-5.14-5.14-1.72a.7.7 0 0 1 0-1.32l5.14-1.72 1.72-5.14a.7.7 0 0 1 .66-.48Z" />
            </svg>
            All-in-one Team Productivity Platform
          </span>
          <h1 className="mt-7 max-w-2xl text-5xl font-black leading-[1.02] tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
            Work
            <br />
            <span className="text-[#6b4ff6]">Beautifully.</span>
            <br />
            Together.
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-slate-500 sm:text-lg sm:leading-8">
            A modern workspace to manage your team, tasks, files and communication — all in one place.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-[#6f51f5] to-[#6b4ff6] px-7 text-sm font-bold text-white shadow-[0_16px_40px_rgba(99,70,230,0.35)] transition hover:-translate-y-0.5"
            >
              Get Started Free
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </Link>
            <a
              href="#features"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/70 bg-white/65 px-7 text-sm font-bold text-slate-800 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11.88-6.86a1 1 0 0 0 0-1.74L9.5 4.27A1 1 0 0 0 8 5.14Z" />
              </svg>
              Explore Features
            </a>
          </div>

          <div className="mt-10 flex items-center gap-4">
            <div className="flex -space-x-3">
              <span className="h-9 w-9 rounded-full border-2 border-white bg-[#f08a85]" />
              <span className="h-9 w-9 rounded-full border-2 border-white bg-[#82a8e6]" />
              <span className="h-9 w-9 rounded-full border-2 border-white bg-[#95d492]" />
              <span className="h-9 w-9 rounded-full border-2 border-white bg-[#f2ad77]" />
              <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[#6b4ff6] text-[11px] font-bold text-white">+</span>
            </div>
            <p className="max-w-xs text-xs leading-5 text-slate-500">
              <span className="block font-bold text-slate-900">Trusted by 10,000+ teams</span>
              across 20+ countries
            </p>
          </div>
        </div>

        <div className="relative flex min-h-[520px] items-center justify-center lg:min-h-[660px]">
          <LandingVisual />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 mx-auto w-full max-w-[1500px] px-6 py-20 lg:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold uppercase tracking-wider text-indigo-600">Features</span>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            Everything your team needs
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            One workspace for tasks, meetings, reviews, reporting, attendance, and collaboration.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.label}
              className="rounded-3xl border border-white/70 bg-white/70 p-7 shadow-[0_10px_30px_rgba(91,77,255,0.05)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-lg"
            >
              <span className={`grid h-12 w-12 place-items-center rounded-2xl ${feature.accent}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-6 w-6">
                  {feature.icon}
                </svg>
              </span>
              <h3 className="mt-5 text-lg font-bold text-slate-900">{feature.label}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solutions */}
      <section id="solutions" className="relative z-10 bg-white/50">
        <div className="mx-auto w-full max-w-[1500px] px-6 py-20 lg:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-bold uppercase tracking-wider text-indigo-600">Solutions</span>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Built for how your team works
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              Whether you lead, build, or keep operations running — DeskCulture fits your role.
            </p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {solutions.map((solution) => (
              <div
                key={solution.title}
                className="rounded-3xl border border-white/70 bg-white/80 p-8 shadow-[0_16px_40px_rgba(91,77,255,0.06)] backdrop-blur-xl"
              >
                <h3 className="text-xl font-black text-slate-900">{solution.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{solution.blurb}</p>
                <ul className="mt-6 space-y-3">
                  {solution.points.map((point) => (
                    <li key={point} className="flex items-center gap-3 text-sm text-slate-700">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5 shrink-0 text-indigo-600">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Resources */}
      <section id="resources" className="relative z-10 mx-auto w-full max-w-[1500px] px-6 py-20 lg:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold uppercase tracking-wider text-indigo-600">Resources</span>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            Resources to help you succeed
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Guides, docs, and support to get your workspace running smoothly.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {resources.map((resource) => (
            <div
              key={resource.title}
              className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[0_10px_30px_rgba(91,77,255,0.05)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-lg"
            >
              <h3 className="text-base font-bold text-slate-900">{resource.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{resource.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative z-10 bg-white/50">
        <div className="mx-auto w-full max-w-[1500px] px-6 py-20 lg:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-bold uppercase tracking-wider text-indigo-600">Pricing</span>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              Start free and upgrade as your team grows.
            </p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {pricing.map((tier) => (
              <div
                key={tier.name}
                className={`flex flex-col rounded-3xl border p-8 backdrop-blur-xl transition hover:-translate-y-1 ${
                  tier.featured
                    ? "border-transparent bg-gradient-to-br from-indigo-600 to-violet-500 text-white shadow-[0_24px_60px_rgba(99,102,241,0.35)]"
                    : "border-white/70 bg-white/80 text-slate-900 shadow-[0_16px_40px_rgba(91,77,255,0.06)]"
                }`}
              >
                <h3 className={`text-lg font-black ${tier.featured ? "text-white" : "text-slate-900"}`}>{tier.name}</h3>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-4xl font-black">{tier.price}</span>
                  {tier.price !== "Free" && tier.price !== "Custom" && (
                    <span className={`pb-1 text-sm ${tier.featured ? "text-indigo-100" : "text-slate-500"}`}>/mo</span>
                  )}
                </div>
                <p className={`mt-2 text-sm ${tier.featured ? "text-indigo-100" : "text-slate-500"}`}>{tier.note}</p>
                <ul className="mt-6 space-y-3">
                  {tier.features.map((item) => (
                    <li key={item} className={`flex items-center gap-3 text-sm ${tier.featured ? "text-indigo-50" : "text-slate-700"}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={`h-5 w-5 shrink-0 ${tier.featured ? "text-white" : "text-indigo-600"}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`mt-8 h-12 w-full rounded-xl text-sm font-bold transition hover:-translate-y-0.5 ${
                    tier.featured
                      ? "bg-white text-indigo-600 shadow-md"
                      : "bg-gradient-to-r from-indigo-600 to-violet-500 text-white shadow-[0_12px_28px_rgba(99,102,241,0.25)]"
                  }`}
                >
                  Get Started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/60 bg-white/40 backdrop-blur-xl">
        <div className="mx-auto grid w-full max-w-[1500px] gap-10 px-6 py-14 lg:grid-cols-[1.4fr_1fr] lg:px-10">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-indigo-600 to-violet-500 text-sm font-bold text-white">
                DC
              </div>
              <span className="text-xl font-extrabold tracking-tight text-slate-950">DeskCulture</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              All your work, in one beautiful workspace.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <a href="#features" className="text-sm font-medium text-slate-600 transition hover:text-indigo-600">Features</a>
            <a href="#solutions" className="text-sm font-medium text-slate-600 transition hover:text-indigo-600">Solutions</a>
            <a href="#resources" className="text-sm font-medium text-slate-600 transition hover:text-indigo-600">Resources</a>
            <a href="#pricing" className="text-sm font-medium text-slate-600 transition hover:text-indigo-600">Pricing</a>
          </nav>
        </div>
        <div className="border-t border-white/60 px-6 py-6 text-center text-xs text-slate-500 lg:px-10">
          © {new Date().getFullYear()} DeskCulture. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
