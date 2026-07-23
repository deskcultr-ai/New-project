import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getBearerUser } from "@/lib/auth-server";
import { appOrigin } from "@/lib/env";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // org_people_status() is SECURITY DEFINER (it needs to read auth.users,
  // which isn't exposed over PostgREST) but scopes its own results to
  // exactly what the caller's role/department is allowed to see.
  const { data, error } = await bearer.userClient.rpc("org_people_status");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ people: data });
}

export async function POST(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: string; emails?: string[]; role?: "team_leader" | "manager" | "executive"; departmentId?: string; managerId?: string }
    | null;

  // Support both single email and bulk emails array
  const rawEmails = body?.emails ?? (body?.email ? [body.email] : []);
  const role = body?.role;
  const departmentId = body?.departmentId;
  const requestedManagerId = body?.managerId;

  const emails = rawEmails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e));

  if (emails.length === 0) {
    return NextResponse.json({ error: "Enter at least one valid email address." }, { status: 400 });
  }
  if (role !== "team_leader" && role !== "manager" && role !== "executive") {
    return NextResponse.json({ error: "role must be 'team_leader', 'manager', or 'executive'." }, { status: 400 });
  }
  if (!departmentId) {
    return NextResponse.json({ error: "departmentId is required." }, { status: 400 });
  }

  // RLS-respecting: only returns a row if this is really the caller's own profile.
  const { data: callerProfile, error: profileError } = await bearer.userClient
    .from("profiles")
    .select("id, organization_id, department_id, role")
    .eq("id", bearer.user.id)
    .maybeSingle();

  if (profileError || !callerProfile) {
    return NextResponse.json({ error: "Could not resolve your profile." }, { status: 403 });
  }

  // Org Super Admin invites Team Leaders to any department in the org.
  // Team Leader invites Managers or Executives, scoped to their own department.
  // Manager invites Executives, scoped to their own department.
  if (role === "team_leader" && callerProfile.role !== "org_super_admin") {
    return NextResponse.json({ error: "Only an Organization Super Admin can invite a Team Leader." }, { status: 403 });
  }
  if (role === "manager" && callerProfile.role !== "team_leader") {
    return NextResponse.json({ error: "Only a Team Leader can invite a Manager." }, { status: 403 });
  }
  if (role === "executive" && !["team_leader", "manager"].includes(callerProfile.role)) {
    return NextResponse.json({ error: "Only a Team Leader or Manager can invite an Executive." }, { status: 403 });
  }
  if ((role === "manager" || role === "executive") && departmentId !== callerProfile.department_id) {
    return NextResponse.json({ error: "You can only invite into your own department." }, { status: 403 });
  }

  // Confirm the target department actually belongs to the caller's org
  const { data: department, error: deptError } = await bearer.userClient
    .from("departments")
    .select("id, organization_id")
    .eq("id", departmentId)
    .maybeSingle();

  if (deptError || !department || department.organization_id !== callerProfile.organization_id) {
    return NextResponse.json({ error: "Department not found in your organization." }, { status: 400 });
  }

  // Manager -> Executive assignment: a Manager invites into their own team
  // automatically; a Team Leader may optionally pick a Manager to assign
  // the new Executive to (left unassigned otherwise, resolvable later from
  // /admin/people).
  let managerId: string | null = null;
  if (role === "executive") {
    if (callerProfile.role === "manager") {
      managerId = callerProfile.id;
    } else if (callerProfile.role === "team_leader" && requestedManagerId) {
      const { data: manager, error: managerError } = await bearer.userClient
        .from("profiles")
        .select("id, role, department_id")
        .eq("id", requestedManagerId)
        .maybeSingle();
      if (managerError || !manager || manager.role !== "manager" || manager.department_id !== departmentId) {
        return NextResponse.json({ error: "managerId must be a Manager in this department." }, { status: 400 });
      }
      managerId = manager.id;
    }
  }

  const admin = await getSupabaseAdmin();

  // Send invites to all emails and collect results
  const results = await Promise.all(
    emails.map(async (email) => {
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: {
          invite_role: role,
          organization_id: callerProfile.organization_id,
          department_id: department.id,
          ...(managerId ? { manager_id: managerId } : {}),
        },
        redirectTo: `${appOrigin(request)}/auth/callback?next=/set-password`,
      });
      return { email, ok: !inviteError, error: inviteError?.message };
    })
  );

  const succeeded = results.filter((r) => r.ok).map((r) => r.email);
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: succeeded.length > 0,
    emailSent: succeeded.length > 0,
    succeeded,
    failed,
    // Backwards compat for single invite
    emailError: failed.length === 1 ? failed[0].error : undefined,
  });
}
