"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Card, Button, Alert } from "@/components/ui";
import { FilePreviewModal, useFilePreview } from "@/components/file-preview";
import { formatBytes, RESOURCES_PREFIX } from "@/lib/drive";

type Department = { id: string; name: string };
type Task = { id: string; title: string; status: string };
type TaskAttachment = { id: string; file_name: string; file_size: number; storage_path: string; content_type: string | null };
type ResourceFile = { name: string; size: number; contentType: string | null };

export default function DepartmentDrivePage() {
  const params = useParams<{ departmentId: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [resources, setResources] = useState<ResourceFile[]>([]);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceError, setResourceError] = useState("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [taskAttachments, setTaskAttachments] = useState<Record<string, TaskAttachment[]>>({});

  const canWriteResources = profile?.role === "super_admin" || (profile?.role === "admin" && profile.department_id === params.departmentId);

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
    const { error } = await supabase.storage.from("org-drive").upload(path, file, { upsert: true });
    setResourceBusy(false);
    if (error) {
      setResourceError(error.message);
      return;
    }
    loadResources(profile.organization_id);
  }

  if (loading || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (notFound || !department) {
    return (
      <AppShell profile={profile} title="Department not found">
        <Card className="text-center text-sm text-slate-500">This department doesn&apos;t exist, or you don&apos;t have access to it.</Card>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile} title={department.name} subtitle="Department Drive">
      <div className="space-y-8">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Resources</h2>
            {canWriteResources && (
              <label className="cursor-pointer text-xs font-bold text-primary">
                {resourceBusy ? "Uploading..." : "+ Upload"}
                <input type="file" onChange={uploadResource} disabled={resourceBusy} className="hidden" />
              </label>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">Templates, SOPs, and reference docs for this department.</p>
          {resourceError && <Alert tone="danger" className="mt-3">{resourceError}</Alert>}
          <div className="mt-4 space-y-2">
            {resources.map((file) => (
              <button
                key={file.name}
                type="button"
                onClick={() => downloadResource(file)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary-light"
              >
                <span className="truncate font-semibold text-slate-800">{file.name}</span>
                <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
              </button>
            ))}
            {resources.length === 0 && <p className="text-sm text-slate-400">No resources yet.</p>}
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-bold text-slate-900">Task folders</h2>
          <div className="mt-4 space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-slate-100">
                <button type="button" onClick={() => toggleTask(task.id)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                  <span className="font-semibold text-slate-800">{task.title}</span>
                  <span className="text-xs uppercase text-slate-400">{task.status.replace("_", " ")}</span>
                </button>
                {expandedTask === task.id && (
                  <div className="border-t border-slate-100 p-3">
                    <div className="space-y-1">
                      {(taskAttachments[task.id] ?? []).map((a) => (
                        <button key={a.id} type="button" onClick={() => downloadTaskFile(a)} className="block text-xs font-semibold text-primary hover:underline">
                          {a.file_name} ({formatBytes(a.file_size)})
                        </button>
                      ))}
                      {(taskAttachments[task.id] ?? []).length === 0 && <p className="text-xs text-slate-400">No files on this task.</p>}
                    </div>
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => router.push(`/tasks/${task.id}`)}>
                      Open task
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {tasks.length === 0 && <p className="text-sm text-slate-400">No tasks in this department yet.</p>}
          </div>
        </Card>
      </div>
      <FilePreviewModal target={preview.target} onClose={preview.close} />
    </AppShell>
  );
}
