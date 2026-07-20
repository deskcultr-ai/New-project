"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui";
import { displayName, type Profile } from "@/lib/session";

type NavItem = { label: string; href: string; icon: React.ReactNode };

function icon(d: string) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-[18px] w-[18px] shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M2.25 12l8.954-8.955a1.125 1.125 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75",
  people: "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z",
  check: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
};

function navForRole(role: Profile["role"] | undefined): NavItem[] {
  if (role === "super_admin") {
    return [
      { label: "Overview", href: "/admin", icon: icon(ICONS.home) },
      { label: "Departments & People", href: "/admin/people", icon: icon(ICONS.people) },
      { label: "Tasks", href: "/admin/tasks", icon: icon(ICONS.check) },
    ];
  }
  if (role === "admin") {
    return [
      { label: "Overview", href: "/admin", icon: icon(ICONS.home) },
      { label: "Team", href: "/admin/people", icon: icon(ICONS.people) },
      { label: "Tasks", href: "/admin/tasks", icon: icon(ICONS.check) },
    ];
  }
  return [{ label: "My Tasks", href: "/dashboard", icon: icon(ICONS.check) }];
}

function NavLinks({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                active ? "bg-primary-light text-primary" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({
  profile,
  title,
  subtitle,
  children,
  actions,
}: {
  profile: Profile | null;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const items = navForRole(profile?.role);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <Link href="/" className="flex items-center gap-3 px-6 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-sm font-bold text-white">
            DC
          </div>
          <span className="text-lg font-extrabold tracking-tight text-slate-900">DeskCulture</span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3">
          <NavLinks items={items} pathname={pathname} />
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={displayName(profile)} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900">{profile?.full_name || displayName(profile)}</p>
              <p className="truncate text-xs capitalize text-slate-500">{profile?.role?.replace("_", " ")}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="mt-3 w-full rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative flex h-full w-[280px] max-w-[86vw] flex-col border-r border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4">
              <Link href="/" className="flex items-center gap-3" onClick={() => setMobileNavOpen(false)}>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-sm font-bold text-white">DC</div>
                <span className="text-lg font-extrabold tracking-tight text-slate-900">DeskCulture</span>
              </Link>
              <button
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 pb-4">
              <NavLinks items={items} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
            </nav>
            <div className="border-t border-slate-200 p-4">
              <button
                onClick={signOut}
                className="w-full rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/85 px-4 py-4 backdrop-blur-xl sm:px-6">
          <button
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-h3 text-slate-900">{title}</h1>
            {subtitle && <p className="truncate text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
