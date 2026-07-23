"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getProfile, type Profile } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Select, Badge, Alert } from "@/components/ui";
import { FilePreviewModal, useFilePreview } from "@/components/file-preview";
import { uploadFileWithRetry } from "@/lib/storage-upload";
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_LABEL, PRIORITY_TONE, getDueUrgency, DUE_URGENCY_LABEL, DUE_URGENCY_TONE, type TaskStatus, type TaskPriority } from "@/lib/tasks";

type PersonRef = { id: string; full_name: string | null; username?: string | null; email: string } | null;
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
type Attachment = {
  id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  content_type: string | null;
  created_at: string;
  uploader: PersonRef;
};
type DirectoryPerson = { id: string; full_name: string | null; username: string | null; email: string; role: string };

function groupAttachmentVersions(attachments: Attachment[]) {
  const byName = new Map<string, Attachment[]>();
  for (const a of attachments) {
    const list = byName.get(a.file_name) ?? [];
    list.push(a);
    byName.set(a.file_name, list);
  }
  return Array.from(byName.values()).map((versions) => versions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("user_profile");
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  });
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [assignees, setAssignees] = useState<DirectoryPerson[]>([]);
  const preview = useFilePreview();

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

  // Task forward (executive only)
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardQuery, setForwardQuery] = useState("");
  const [forwardTo, setForwardTo] = useState<DirectoryPerson | null>(null);
  const [forwardReason, setForwardReason] = useState("");
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardError, setForwardError] = useState("");
  const [forwardSuccess, setForwardSuccess] = useState("");

  const load = useCallback(async () => {
    const me = await getProfile();
    if (!me) {
      router.replace("/login");
      return;
    }
    setProfile(me);
    sessionStorage.setItem("user_profile", JSON.stringify(me));

    const [{ data: taskRow, error: taskErr }, { data: commentRows }, { data: attachmentRows }] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, organization_id, department_id, title, description, status, is_blocked, priority, due_date, assigned_to, created_by, department:departments(name), assignee:profiles!tasks_assigned_to_fkey(id,full_name,username,email), creator:profiles!tasks_created_by_fkey(id,full_name,username,email)"
        )
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("task_comments")
        .select("id, body, created_at, author:profiles(id,full_name,username,email)")
        .eq("task_id", params.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("task_attachments")
        .select("id, storage_path, file_name, file_size, content_type, created_at, uploader:profiles(id,full_name,username,email)")
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

    if (me.role !== "executive") {
      // Org Super Admin/Team Leader browse the org-wide directory; Manager is
      // scoped to their own department (matches org_people_status()'s scope).
      const query = supabase.from("profiles").select("id, full_name, username, email, role").order("full_name");
      const { data: people } = me.role === "manager" ? await query.eq("department_id", me.department_id ?? "") : await query;
      const eligibleRoles = me.role === "org_super_admin" ? ["team_leader", "manager", "executive"] : me.role === "team_leader" ? ["manager", "executive"] : ["executive"];
      setAssignees(((people ?? []) as DirectoryPerson[]).filter((p) => eligibleRoles.includes(p.role)));
    } else {
      // Executives need the dept directory to search for forward-to person
      const { data: people } = await supabase.from("profiles").select("id, full_name, username, email, role").eq("department_id", me.department_id ?? "").order("full_name");
      setAssignees(((people ?? []) as DirectoryPerson[]).filter((p) => p.role === "executive" && p.id !== me.id));
    }

    setLoading(false);
  }, [params.id, router]);

  useEffect(() => {
    async function run() {
      await load();
    }
    run();
  }, [load]);

  const canEditFully = !!profile && ["org_super_admin", "team_leader", "manager"].includes(profile.role);

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
    const { error: uploadErr } = await uploadFileWithRetry("org-drive", path, file);
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

  async function openFile(attachment: Attachment) {
    const { data, error } = await supabase.storage.from("org-drive").createSignedUrl(attachment.storage_path, 60);
    if (error || !data) {
      setUploadError(error?.message ?? "Could not create a download link.");
      return;
    }
    preview.open({ url: data.signedUrl, name: attachment.file_name, contentType: attachment.content_type });
  }

  async function submitForwardRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !task || !forwardTo || !forwardReason.trim()) return;
    setForwardBusy(true);
    setForwardError("");
    setForwardSuccess("");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/task-forward", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ taskId: task.id, forwardTo: forwardTo.id, reason: forwardReason.trim() }),
    });
    const json = await res.json();
    setForwardBusy(false);
    if (!res.ok) { setForwardError(json.error ?? "Could not submit request."); return; }
    setForwardSuccess("✅ Reassignment request sent to your admin!");
    setForwardOpen(false);
    setForwardTo(null);
    setForwardReason("");
    setForwardQuery("");
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-900 text-indigo-400">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (notFound || !task) {
    return (
      <AppShell profile={profile} title="Task not found">
        <Card className="text-center text-sm text-[var(--text-tertiary)]">
          This task doesn&apos;t exist, or you don&apos;t have access to it.
        </Card>
      </AppShell>
    );
  }

  const personLabel = (person: PersonRef) => (person ? (person.username ? `@${person.username}` : person.full_name || person.email) : "Unassigned");

  return (
    <AppShell profile={profile} title={task.title} subtitle={task.department?.name ?? undefined}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
              {task.is_blocked && <Badge tone="danger">Blocked</Badge>}
              <Badge tone="neutral">{STATUS_LABEL[task.status]}</Badge>
              {(() => {
                const urgency = getDueUrgency(task.due_date, task.status);
                return urgency ? <Badge tone={DUE_URGENCY_TONE[urgency]}>{DUE_URGENCY_LABEL[urgency]}</Badge> : null;
              })()}
            </div>
            {task.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{task.description}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-[var(--text-tertiary)]">
              <div>
                <dt className="font-semibold uppercase tracking-wide">Assignee</dt>
                <dd className="mt-1 text-[var(--text-secondary)]">{personLabel(task.assignee)}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide">Created by</dt>
                <dd className="mt-1 text-[var(--text-secondary)]">{personLabel(task.creator)}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide">Due date</dt>
                <dd className="mt-1 text-[var(--text-secondary)]">{task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="text-base font-bold text-[var(--text-primary)]">Update</h2>
            <form onSubmit={saveTask} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                Status
                <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="mt-2">
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-semibold text-[var(--text-secondary)]">
                <input type="checkbox" checked={isBlocked} onChange={(e) => setIsBlocked(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
                Blocked
              </label>
              {canEditFully && (
                <>
                  <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                    Priority
                    <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="mt-2">
                      {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="block text-sm font-semibold text-[var(--text-secondary)]">
                    Assignee
                    <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="mt-2">
                      <option value="">Unassigned</option>
                      {assignees.map((p) => (
                        <option key={p.id} value={p.id}>{p.username ? `@${p.username}` : p.full_name || p.email} ({p.role})</option>
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

          {/* Request Reassignment — executives only, only when assigned to this task */}
          {profile.role === "executive" && task.assigned_to === profile.id && (
            <Card>
              <h2 className="text-base font-bold text-[var(--text-primary)]">Request Reassignment</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">You cannot reassign this task directly. Submit a request with a reason — your admin will review it.</p>
              {forwardSuccess && <Alert tone="success" className="mt-3">{forwardSuccess}</Alert>}
              {!forwardOpen ? (
                <Button type="button" variant="ghost" className="mt-3" onClick={() => setForwardOpen(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                  Request Reassignment
                </Button>
              ) : (
                <form onSubmit={submitForwardRequest} className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-[var(--text-secondary)] mb-1.5">Forward to (search by name or @username)</label>
                    <input
                      type="text"
                      value={forwardTo ? (forwardTo.username ? `@${forwardTo.username}` : forwardTo.full_name || forwardTo.email) : forwardQuery}
                      onChange={(e) => { setForwardQuery(e.target.value); setForwardTo(null); }}
                      placeholder="Search teammate..."
                      className="h-11 w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] px-3.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b5cf6] placeholder:text-[var(--text-tertiary)]"
                    />
                    {!forwardTo && forwardQuery.trim().length >= 2 && (
                      <div className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-[var(--divider)] bg-[var(--glass-bg)]">
                        {assignees.filter((p) =>
                          p.id !== profile.id &&
                          ((p.full_name?.toLowerCase().includes(forwardQuery.toLowerCase())) ||
                          p.email.toLowerCase().includes(forwardQuery.toLowerCase()))
                        ).map((p) => (
                          <button key={p.id} type="button" onClick={() => { setForwardTo(p); setForwardQuery(p.username ? `@${p.username}` : p.full_name || p.email); }}
                            className="flex w-full items-center border-0 bg-transparent px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] cursor-pointer">
                            {p.username ? `@${p.username}` : p.full_name || p.email}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-[var(--text-secondary)] mb-1.5">Reason for reassignment *</label>
                    <textarea
                      required
                      value={forwardReason}
                      onChange={(e) => setForwardReason(e.target.value)}
                      placeholder="Explain why you want to forward this task..."
                      rows={3}
                      className="w-full resize-none rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#8b5cf6] transition"
                    />
                  </div>
                  {forwardError && <Alert tone="danger">{forwardError}</Alert>}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={forwardBusy || !forwardTo || !forwardReason.trim()}>
                      {forwardBusy ? "Submitting..." : "Submit Request"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { setForwardOpen(false); setForwardError(""); }}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          )}

          <Card>
            <h2 className="text-base font-bold text-[var(--text-primary)]">Comments</h2>
            <div className="mt-4 space-y-4">
              {comments.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No comments yet.</p>}
              {comments.map((comment) => (
                <div key={comment.id} className="border-b border-[var(--divider)] pb-3 last:border-0 last:pb-0">
                  <p className="text-xs font-semibold text-[var(--text-tertiary)]">
                    {personLabel(comment.author)} · {new Date(comment.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-primary)]">{comment.body}</p>
                </div>
              ))}
            </div>
            <form onSubmit={addComment} className="mt-4 space-y-3">
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={3}
                placeholder="Add a comment..."
                className="w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-[#8b5cf6] focus:ring-4 focus:ring-[#8b5cf6]/20 backdrop-blur-xl"
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
            <h2 className="text-base font-bold text-[var(--text-primary)]">Attachments</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Re-uploading a file with the same name keeps earlier versions.</p>
            <div className="mt-4 space-y-3">
              {attachments.length === 0 && <p className="text-sm text-[var(--text-tertiary)]">No files yet.</p>}
              {groupAttachmentVersions(attachments).map((versions) => {
                const [latest, ...older] = versions;
                return <AttachmentGroup key={latest.id} latest={latest} older={older} onOpen={openFile} />;
              })}
            </div>
            <label className="mt-4 block">
              <span className="sr-only">Upload a file</span>
              <input type="file" onChange={uploadFile} disabled={uploadBusy} className="text-sm text-[var(--text-secondary)]" />
            </label>
            {uploadBusy && <p className="mt-2 text-xs text-[var(--text-secondary)]">Uploading...</p>}
            {uploadError && <Alert tone="danger" className="mt-3">{uploadError}</Alert>}
          </Card>
        </div>
      </div>
      <FilePreviewModal target={preview.target} onClose={preview.close} />
    </AppShell>
  );
}

function AttachmentGroup({ latest, older, onOpen }: { latest: Attachment; older: Attachment[]; onOpen: (a: Attachment) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-[var(--divider)]">
      <button
        type="button"
        onClick={() => onOpen(latest)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--surface-soft)] border-0 bg-transparent cursor-pointer"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-[var(--text-primary)]">{latest.file_name}</span>
          <span className="block text-xs text-[var(--text-tertiary)]">{(latest.file_size / 1024).toFixed(0)} KB</span>
        </span>
        {older.length > 0 && <Badge tone="neutral">v{older.length + 1}</Badge>}
      </button>
      {older.length > 0 && (
        <div className="border-t border-[var(--divider)] px-3 py-2">
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-primary border-0 bg-transparent cursor-pointer">
            {expanded ? "Hide" : `${older.length} earlier version${older.length > 1 ? "s" : ""}`}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1">
              {older.map((version, i) => (
                <button key={version.id} type="button" onClick={() => onOpen(version)} className="block text-xs text-[var(--text-secondary)] hover:text-primary hover:underline border-0 bg-transparent cursor-pointer">
                  v{older.length - i} · {new Date(version.created_at).toLocaleString()}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
