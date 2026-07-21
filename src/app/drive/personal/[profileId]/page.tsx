"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card, Alert } from "@/components/ui";
import { FilePreviewModal, useFilePreview } from "@/components/file-preview";
import { formatBytes, PERSONAL_FOLDER_PREFIX } from "@/lib/drive";

type PersonalFile = { name: string; size: number; contentType: string | null };

export default function PersonalDrivePage() {
  const params = useParams<{ profileId: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<PersonalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async (me: Profile) => {
    const { data, error: listError } = await supabase.storage.from("org-drive").list(PERSONAL_FOLDER_PREFIX(me.organization_id, params.profileId));
    if (listError) {
      setError(listError.message);
      setFiles([]);
      return;
    }
    setFiles(
      ((data ?? []) as { name: string; metadata: { size: number; mimetype?: string } | null }[]).map((f) => ({
        name: f.name,
        size: f.metadata?.size ?? 0,
        contentType: f.metadata?.mimetype ?? null,
      }))
    );
    setError("");
  }, [params.profileId]);

  useEffect(() => {
    async function init() {
      const me = await getProfile();
      if (!me) {
        router.replace("/login");
        return;
      }
      setProfile(me);
      sessionStorage.setItem("user_profile", JSON.stringify(me));
      await load(me);
      setLoading(false);
    }
    init();
  }, [router, load]);

  async function uploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile) return;
    setBusy(true);
    setError("");

    const path = `${PERSONAL_FOLDER_PREFIX(profile.organization_id, params.profileId)}/${file.name}`;
    const { error: uploadError } = await supabase.storage.from("org-drive").upload(path, file, { upsert: true });
    setBusy(false);
    if (uploadError) {
      setError(uploadError.message);
      return;
    }
    load(profile);
  }

  function toggleSelected(name: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function deleteSelected() {
    if (!profile || selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} file${selected.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setDeleteBusy(true);
    setError("");

    const prefix = PERSONAL_FOLDER_PREFIX(profile.organization_id, params.profileId);
    const paths = Array.from(selected).map((name) => `${prefix}/${name}`);
    const { error: removeError } = await supabase.storage.from("org-drive").remove(paths);

    setDeleteBusy(false);
    if (removeError) {
      setError(removeError.message);
      return;
    }
    setSelected(new Set());
    load(profile);
  }

  const preview = useFilePreview();

  async function downloadFile(file: PersonalFile) {
    if (!profile) return;
    const path = `${PERSONAL_FOLDER_PREFIX(profile.organization_id, params.profileId)}/${file.name}`;
    const { data } = await supabase.storage.from("org-drive").createSignedUrl(path, 60);
    if (data) preview.open({ url: data.signedUrl, name: file.name, contentType: file.contentType });
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  const isOwn = params.profileId === profile.id;

  return (
    <AppShell profile={profile} title={isOwn ? "My Personal Folder" : "Personal Folder"}>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-secondary)]">Private working space. {isOwn ? "Only you" : "You"} and org admins can see this.</p>
          <div className="flex shrink-0 items-center gap-3">
            {selected.size > 0 && (
              <button
                type="button"
                onClick={deleteSelected}
                disabled={deleteBusy}
                className="text-xs font-bold text-red-500 hover:text-red-400 disabled:opacity-50 bg-transparent border-0 cursor-pointer"
              >
                {deleteBusy ? "Deleting..." : `Delete (${selected.size})`}
              </button>
            )}
            <label className="cursor-pointer text-xs font-bold text-primary">
              {busy ? "Uploading..." : "+ Upload"}
              <input type="file" onChange={uploadFile} disabled={busy} className="hidden" />
            </label>
          </div>
        </div>
        {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
        <div className="mt-4 space-y-2">
          {files.map((file) => (
            <div
              key={file.name}
              className="flex w-full items-center gap-3 rounded-xl border border-[var(--glass-border-soft)] px-3 py-2 text-sm hover:border-[#8b5cf6]/40 hover:bg-[var(--surface-soft)]"
            >
              <input
                type="checkbox"
                checked={selected.has(file.name)}
                onChange={() => toggleSelected(file.name)}
                className="h-4 w-4 shrink-0 rounded accent-primary"
              />
              <button type="button" onClick={() => downloadFile(file)} className="flex min-w-0 flex-1 items-center justify-between gap-2 bg-transparent border-0 p-0 text-left cursor-pointer">
                <span className="truncate font-semibold text-[var(--text-primary)]">{file.name}</span>
                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{formatBytes(file.size)}</span>
              </button>
            </div>
          ))}
          {files.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No files yet.</p>}
        </div>
      </Card>
      <FilePreviewModal target={preview.target} onClose={preview.close} />
    </AppShell>
  );
}
