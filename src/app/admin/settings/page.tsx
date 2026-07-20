"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card, Alert } from "@/components/ui";
import { formatBytes } from "@/lib/drive";

export default function AdminSettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<{ total_bytes: number; file_count: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const me = await getProfile();
      if (!me) {
        router.replace("/login");
        return;
      }
      if (me.role !== "super_admin") {
        router.replace("/admin");
        return;
      }
      setProfile(me);

      const { data, error: usageError } = await supabase.rpc("org_storage_usage").maybeSingle();
      if (usageError) {
        setError(usageError.message);
      } else {
        setUsage(data as { total_bytes: number; file_count: number });
      }
      setLoading(false);
    }
    load();
  }, [router]);

  if (loading || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  return (
    <AppShell profile={profile} title="Settings">
      <div className="max-w-md space-y-6">
        <Card>
          <h2 className="text-base font-bold text-slate-900">Storage usage</h2>
          <p className="mt-1 text-xs text-slate-500">Total space used across task attachments, chat files, department resources, and personal folders.</p>
          {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
          {usage && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-2xl font-black text-slate-900">{formatBytes(usage.total_bytes)}</p>
                <p className="text-xs text-slate-500">Total used</p>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900">{usage.file_count}</p>
                <p className="text-xs text-slate-500">Files stored</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
