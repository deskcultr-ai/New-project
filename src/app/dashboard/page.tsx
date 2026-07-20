"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, displayName, type Profile } from "@/lib/session";
import { Card, Button } from "@/components/ui";

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const me = await getProfile();
      if (!me) {
        router.replace("/login");
        return;
      }
      if (me.role !== "employee") {
        router.replace("/admin");
        return;
      }
      setProfile(me);
      setLoading(false);
    }
    load();
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <Card>
          <h1 className="text-xl font-black tracking-tight text-slate-900">Welcome, {displayName(profile)}.</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Your account is active. Tasks, meetings, chat, attendance, and the rest of your workspace land here in
            the next build steps.
          </p>
          <Button variant="secondary" className="mt-6" onClick={signOut}>
            Sign out
          </Button>
        </Card>
      </div>
    </main>
  );
}
