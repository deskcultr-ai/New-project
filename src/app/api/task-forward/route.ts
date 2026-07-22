import { NextResponse } from "next/server";
import { getBearerUser } from "@/lib/auth-server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

// GET: Admin/SuperAdmin fetches pending forward requests for their scope
export async function GET(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: caller } = await bearer.userClient.from("profiles")
    .select("id, organization_id, department_id, role")
    .eq("id", bearer.user.id)
    .maybeSingle();

  if (!caller || caller.role === "employee") {
    return NextResponse.json({ error: "Only admins can view forward requests." }, { status: 403 });
  }

  const query = bearer.userClient
    .from("task_forward_requests")
    .select(`
      id, task_id, reason, status, rejection_note, created_at, resolved_at,
      requested_by:profiles!task_forward_requests_requested_by_fkey(id, full_name, username, email),
      forward_to:profiles!task_forward_requests_forward_to_fkey(id, full_name, username, email),
      task:tasks!task_forward_requests_task_id_fkey(id, title, department_id)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ requests: data ?? [] });
}

// POST: Employee creates a forward request
export async function POST(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => null) as
    | { taskId?: string; forwardTo?: string; reason?: string }
    | null;

  const taskId = body?.taskId;
  const forwardTo = body?.forwardTo;
  const reason = body?.reason?.trim();

  if (!taskId || !forwardTo || !reason) {
    return NextResponse.json({ error: "taskId, forwardTo, and reason are required." }, { status: 400 });
  }

  const { data: caller } = await bearer.userClient.from("profiles")
    .select("id, role, organization_id")
    .eq("id", bearer.user.id)
    .maybeSingle();

  if (!caller || caller.role !== "employee") {
    return NextResponse.json({ error: "Only employees can request task forwarding." }, { status: 403 });
  }

  // Verify task is assigned to this employee
  const { data: task } = await bearer.userClient.from("tasks")
    .select("id, assigned_to, organization_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || task.assigned_to !== caller.id) {
    return NextResponse.json({ error: "You can only forward tasks assigned to you." }, { status: 403 });
  }

  // Check no pending request already exists
  const { data: existing } = await bearer.userClient.from("task_forward_requests")
    .select("id")
    .eq("task_id", taskId)
    .eq("requested_by", caller.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "A pending forward request already exists for this task." }, { status: 409 });
  }

  const { error } = await bearer.userClient.from("task_forward_requests").insert({
    task_id: taskId,
    requested_by: caller.id,
    forward_to: forwardTo,
    reason,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// PATCH: Admin approves or rejects a forward request
export async function PATCH(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => null) as
    | { requestId?: string; action?: "approve" | "reject"; rejectionNote?: string }
    | null;

  const requestId = body?.requestId;
  const action = body?.action;
  const rejectionNote = body?.rejectionNote?.trim();

  if (!requestId || !action || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "requestId and action (approve|reject) are required." }, { status: 400 });
  }

  const { data: caller } = await bearer.userClient.from("profiles")
    .select("id, role")
    .eq("id", bearer.user.id)
    .maybeSingle();

  if (!caller || caller.role === "employee") {
    return NextResponse.json({ error: "Only admins can review forward requests." }, { status: 403 });
  }

  // Use admin client to bypass the tasks_guard_update trigger (the trigger on task_forward_requests handles reassignment via SECURITY DEFINER)
  const admin = await getSupabaseAdmin();
  const { error } = await admin
    .from("task_forward_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_by: caller.id,
      rejection_note: action === "reject" ? (rejectionNote ?? null) : null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
