"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Select, Badge, Alert } from "@/components/ui";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL, PRIORITY_TONE, type TaskStatus, type TaskPriority } from "@/lib/tasks";

type PersonRef = { id: string; full_name: string | null; email: string } | null;
type TaskDetail = {
  id: string;
  organization_id: string;
  department_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  is_blocked: boolean;
  priority: TaskPriority;
  due_date: string | null;
  assigned_to: string | null;
  created_by: string;
  department: { name: string } | null;
  assignee: PersonRef;
  creator: PersonRef;
};
type Comment = { id: string; body: string; created_at: string; author: PersonRef };
type Attachment = { id: string; storage_path: string; file_name: string; file_size: number; created_at: string; uploader: PersonRef };
type DirectoryPerson = { id: string; full_name: string | null; email: string; role: string };

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [assignees, setAssignees] = useState<DirectoryPerson[]>([]);

  const [status, setStatus] = useState<TaskStatus>("todo");
  const [isBlocked, setIsBlocked] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [taskError, setTaskError] = useState("");

  const [commentBody, setCommentBody] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState("");

  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const load = useCallback(async () => {
    const me = await getProfile();
    if (!me) {
      router.replace("/login");
      return;
    }
    setProfile(me);

    const [{ data: taskRow, error: taskErr }, { data: commentRows }, { data: attachmentRows }] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, organization_id, department_id, title, description, status, is_blocked, priority, due_date, assigned_to, created_by, department:departments(name), assignee:profiles!tasks_assigned_to_fkey(id,full_name,email), creator:profiles!tasks_created_by_fkey(id,full_name,email)"
        )
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("task_comments")
        .select("id, body, created_at, author:profiles(id,full_name,email)")
        .eq("task_id", params.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("task_attachments")
        .select("id, storage_path, file_name, file_size, created_at, uploader:profiles(id,full_name,email)")
        .eq("task_id", params.id)
        .order("created_at", { ascending: true }),
    ]);

    if (taskErr || !taskRow) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const detail = taskRow as unknown as TaskDetail;
    setTask(detail);
    setStatus(detail.status);
    setIsBlocked(detail.is_blocked);
    setPriority(detail.priority);
    setAssigneeId(detail.assigned_to ?? "");
    setComments((commentRows ?? []) as unknown as Comment[]);
    setAttachments((attachmentRows ?? []) as unknown as Attachment[]);

    if (me.role !== "employee") {
      const { data: people } = await supabase.from("profiles").select("id, full_name, email, role").order("full_name");
      const eligibleRoles = me.role === "super_admin" ? ["admin", "employee"] : ["employee"];
      setAssignees(((people ?? []) as DirectoryPerson[]).filter((p) => eligibleRoles.includes(p.role)));
    }

    setLoading(false);
  }, [params.id, router]);

  useEffect(() => {
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const canEditFully = profile?.role === "super_admin" || profile?.role === "admin";

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if (!task) return;
    setSavingTask(true);
    setTaskError("");

    const patch: Record<string, unknown> = { status, is_blocked: isBlocked };
    if (canEditFully) {
      patch.priority = priority;
      patch.assigned_to = assigneeId || null;
    }

    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    setSavingTask(false);
    if (error) {
      setTaskError(error.message);
      return;
    }
    load();
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !task || !commentBody.trim()) return;
    setCommentBusy(true);
    setCommentError("");

    const { error } = await supabase.from("task_comments").insert({
      task_id: task.id,
      author_id: profile.id,
      body: commentBody.trim(),
    });

    setCommentBusy(false);
    if (error) {
      setCommentError(error.message);
      return;
    }
    setCommentBody("");
    load();
  }

  async function uploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile || !task) return;
    setUploadBusy(true);
    setUploadError("");

    const path = `${task.organization_id}/${task.department_id}/tasks/${task.id}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage.from("org-drive").upload(path, file);
    if (uploadErr) {
      setUploadBusy(false);
      setUploadError(uploadErr.message);
      return;
    }

    const { error: insertErr } = await supabase.from("task_attachments").insert({
      task_id: task.id,
      uploaded_by: profile.id,
      storage_path: path,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || null,
    });

    setUploadBusy(false);
    if (insertErr) {
      setUploadError(insertErr.message);
      return;
    }
    load();
  }

  async function downloadFile(attachment: Attachment) {
    const { data, error } = await supabase.storage.from("org-drive").createSignedUrl(attachment.storage_path, 60);
    if (error || !data) {
      setUploadError(error?.message ?? "Could not create a download link.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (loading || !profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (notFound || !task) {
    return (
      <AppShell profile={profile} title="Task not found">
        <Card className="text-center text-sm text-slate-500">
          This task doesn&apos;t exist, or you don&apos;t have access to it.
        </Card>
      </AppShell>
    );
  }

  const personLabel = (person: PersonRef) => (person ? person.full_name || person.email : "Unassigned");

  return (
    <AppShell profile={profile} title={task.title} subtitle={task.department?.name ?? undefined}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
              {task.is_blocked && <Badge tone="danger">Blocked</Badge>}
              <Badge tone="neutral">{STATUS_LABEL[task.status]}</Badge>
            </div>
            {task.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{task.description}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500">
              <div>
                <dt className="font-semibold uppercase tracking-wide">Assignee</dt>
                <dd className="mt-1 text-slate-700">{personLabel(task.assignee)}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide">Created by</dt>
                <dd className="mt-1 text-slate-700">{personLabel(task.creator)}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide">Due date</dt>
                <dd className="mt-1 text-slate-700">{task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="text-base font-bold text-slate-900">Update</h2>
            <form onSubmit={saveTask} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">
                Status
                <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="mt-2">
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={isBlocked} onChange={(e) => setIsBlocked(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
                Blocked
              </label>
              {canEditFully && (
                <>
                  <label className="block text-sm font-semibold text-slate-700">
                    Priority
                    <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="mt-2">
                      {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Assignee
                    <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="mt-2">
                      <option value="">Unassigned</option>
                      {assignees.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.email} ({p.role})</option>
                      ))}
                    </Select>
                  </label>
                </>
              )}
              {taskError && (
                <div className="sm:col-span-2">
                  <Alert tone="danger">{taskError}</Alert>
                </div>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={savingTask}>
                  {savingTask ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <h2 className="text-base font-bold text-slate-900">Comments</h2>
            <div className="mt-4 space-y-4">
              {comments.length === 0 && <p className="text-sm text-slate-400">No comments yet.</p>}
              {comments.map((comment) => (
                <div key={comment.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <p className="text-xs font-semibold text-slate-500">
                    {personLabel(comment.author)} · {new Date(comment.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>
                </div>
              ))}
            </div>
            <form onSubmit={addComment} className="mt-4 space-y-3">
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={3}
                placeholder="Add a comment..."
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-primary focus:ring-4 focus:ring-primary-light"
              />
              {commentError && <Alert tone="danger">{commentError}</Alert>}
              <Button type="submit" disabled={commentBusy || !commentBody.trim()}>
                {commentBusy ? "Posting..." : "Post comment"}
              </Button>
            </form>
          </Card>
        </div>

        <div>
          <Card>
            <h2 className="text-base font-bold text-slate-900">Attachments</h2>
            <div className="mt-4 space-y-3">
              {attachments.length === 0 && <p className="text-sm text-slate-400">No files yet.</p>}
              {attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => downloadFile(attachment)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2.5 text-left text-sm hover:border-primary/40 hover:bg-primary-light"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-800">{attachment.file_name}</span>
                    <span className="block text-xs text-slate-500">{(attachment.file_size / 1024).toFixed(0)} KB · {personLabel(attachment.uploader)}</span>
                  </span>
                </button>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="sr-only">Upload a file</span>
              <input type="file" onChange={uploadFile} disabled={uploadBusy} className="text-sm" />
            </label>
            {uploadBusy && <p className="mt-2 text-xs text-slate-500">Uploading...</p>}
            {uploadError && <Alert tone="danger" className="mt-3">{uploadError}</Alert>}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
