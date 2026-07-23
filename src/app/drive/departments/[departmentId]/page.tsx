"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card, Button, Alert } from "@/components/ui";
import { FilePreviewModal, useFilePreview } from "@/components/file-preview";
import { formatBytes, RESOURCES_PREFIX } from "@/lib/drive";
import { uploadFileWithRetry } from "@/lib/storage-upload";

type Department = { id: string; name: string };
type Task = { id: string; title: string; status: string };
type TaskAttachment = { id: string; file_name: string; file_size: number; storage_path: string; content_type: string | null };
type ResourceFile = { name: string; size: number; contentType: string | null };

export default function DepartmentDrivePage() {
  const params = useParams<{ departmentId: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [department, setDepartment] = useState<Department | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [resources, setResources] = useState<ResourceFile[]>([]);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [taskAttachments, setTaskAttachments] = useState<Record<string, TaskAttachment[]>>({});

  const canWriteResources = profile?.role === "org_super_admin" || (profile?.role === "team_leader" && profile.department_id === params.departmentId);

  const preview = useFilePreview();

  const loadResources = useCallback(async (organizationId: string) => {
    const { data } = await supabase.storage.from("org-drive").list(RESOURCES_PREFIX(organizationId, params.departmentId));
    setResources(
      ((data ?? []) as { name: string; metadata: { size: number; mimetype?: string } | null }[]).map((f) => ({
        name: f.name,
        size: f.metadata?.size ?? 0,
        contentType: f.metadata?.mimetype ?? null,
      }))
    );
  }, [params.departmentId]);

  useEffect(() => {
    async function load() {
      const me = await getProfile();
      if (!me) {
        router.replace("/login");
        return;
      }
      setProfile(me);
      sessionStorage.setItem("user_profile", JSON.stringify(me));

      const { data: dept, error: deptErr } = await supabase.from("departments").select("id, name").eq("id", params.departmentId).maybeSingle();
      if (deptErr || !dept) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setDepartment(dept as Department);

      const [{ data: taskRows }] = await Promise.all([
        supabase.from("tasks").select("id, title, status").eq("department_id", params.departmentId).order("created_at", { ascending: false }),
        loadResources(me.organization_id),
      ]);
      setTasks((taskRows ?? []) as Task[]);
      setLoading(false);
    }
    load();
  }, [params.departmentId, router, loadResources]);

  async function toggleTask(taskId: string) {
    if (expandedTask === taskId) {
      setExpandedTask(null);
      return;
    }
    setExpandedTask(taskId);
    if (!taskAttachments[taskId]) {
      const { data } = await supabase.from("task_attachments").select("id, file_name, file_size, storage_path, content_type").eq("task_id", taskId);
      setTaskAttachments((current) => ({ ...current, [taskId]: (data ?? []) as TaskAttachment[] }));
    }
  }

  async function downloadTaskFile(attachment: TaskAttachment) {
    const { data } = await supabase.storage.from("org-drive").createSignedUrl(attachment.storage_path, 60);
    if (data) preview.open({ url: data.signedUrl, name: attachment.file_name, contentType: attachment.content_type });
  }

  async function downloadResource(file: ResourceFile) {
    if (!profile) return;
    const path = `${RESOURCES_PREFIX(profile.organization_id, params.departmentId)}/${file.name}`;
    const { data } = await supabase.storage.from("org-drive").createSignedUrl(path, 60);
    if (data) preview.open({ url: data.signedUrl, name: file.name, contentType: file.contentType });
  }

  async function uploadResource(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile) return;
    setResourceBusy(true);
    setResourceError("");

    const path = `${RESOURCES_PREFIX(profile.organization_id, params.departmentId)}/${file.name}`;
    const { error } = await uploadFileWithRetry("org-drive", path, file, { upsert: true });
    setResourceBusy(false);
    if (error) {
      setResourceError(error.message);
      return;
    }
    loadResources(profile.organization_id);
  }

  function toggleResourceSelected(name: string) {
    setSelectedResources((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function deleteSelectedResources() {
    if (!profile || selectedResources.size === 0) return;
    if (!window.confirm(`Delete ${selectedResources.size} file${selectedResources.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setDeleteBusy(true);
    setResourceError("");

    const prefix = RESOURCES_PREFIX(profile.organization_id, params.departmentId);
    const paths = Array.from(selectedResources).map((name) => `${prefix}/${name}`);
    const { error } = await supabase.storage.from("org-drive").remove(paths);

    setDeleteBusy(false);
    if (error) {
      setResourceError(error.message);
      return;
    }
    setSelectedResources(new Set());
    loadResources(profile.organization_id);
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (notFound || !department) {
    return (
      <AppShell profile={profile} title="Department not found">
        <Card className="text-center text-sm text-[var(--text-tertiary)]">This department doesn&apos;t exist, or you don&apos;t have access to it.</Card>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile} title={department.name} subtitle="Department Drive">
      <div className="space-y-8">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[var(--text-primary)]">Resources</h2>
            <div className="flex items-center gap-3">
              {canWriteResources && selectedResources.size > 0 && (
                <button
                  type="button"
                  onClick={deleteSelectedResources}
                  disabled={deleteBusy}
                  className="text-xs font-bold text-red-500 hover:text-red-400 disabled:opacity-50 bg-transparent border-0 cursor-pointer"
                >
                  {deleteBusy ? "Deleting..." : `Delete (${selectedResources.size})`}
                </button>
              )}
              {canWriteResources && (
                <label className="cursor-pointer text-xs font-bold text-primary">
                  {resourceBusy ? "Uploading..." : "+ Upload"}
                  <input type="file" onChange={uploadResource} disabled={resourceBusy} className="hidden" />
                </label>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Templates, SOPs, and reference docs for this department.</p>
          {resourceError && <Alert tone="danger" className="mt-3">{resourceError}</Alert>}
          <div className="mt-4 space-y-2">
            {resources.map((file) => (
              <div
                key={file.name}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--glass-border-soft)] px-3 py-2 text-sm hover:border-[#8b5cf6]/40 hover:bg-[var(--surface-soft)]"
              >
                {canWriteResources && (
                  <input
                    type="checkbox"
                    checked={selectedResources.has(file.name)}
                    onChange={() => toggleResourceSelected(file.name)}
                    className="h-4 w-4 shrink-0 rounded accent-primary"
                  />
                )}
                <button type="button" onClick={() => downloadResource(file)} className="flex min-w-0 flex-1 items-center justify-between gap-2 bg-transparent border-0 p-0 text-left cursor-pointer">
                  <span className="truncate font-semibold text-[var(--text-primary)]">{file.name}</span>
                  <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{formatBytes(file.size)}</span>
                </button>
              </div>
            ))}
            {resources.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No resources yet.</p>}
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Task folders</h2>
          <div className="mt-4 space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-[var(--divider)]">
                <button type="button" onClick={() => toggleTask(task.id)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-[var(--surface-soft)] bg-transparent border-0 cursor-pointer">
                  <span className="font-semibold text-[var(--text-primary)]">{task.title}</span>
                  <span className="text-xs uppercase text-[var(--text-tertiary)]">{task.status.replace("_", " ")}</span>
                </button>
                {expandedTask === task.id && (
                  <div className="border-t border-[var(--divider)] p-3">
                    <div className="space-y-1">
                      {(taskAttachments[task.id] ?? []).map((a) => (
                        <button key={a.id} type="button" onClick={() => downloadTaskFile(a)} className="block text-xs font-semibold text-primary hover:underline border-0 bg-transparent cursor-pointer">
                          {a.file_name} ({formatBytes(a.file_size)})
                        </button>
                      ))}
                      {(taskAttachments[task.id] ?? []).length === 0 && <p className="text-xs text-[var(--text-tertiary)]">No files on this task.</p>}
                    </div>
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => router.push(`/tasks/${task.id}`)}>
                      Open task
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {tasks.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No tasks in this department yet.</p>}
          </div>
        </Card>
      </div>
      <FilePreviewModal target={preview.target} onClose={preview.close} />
    </AppShell>
  );
}
