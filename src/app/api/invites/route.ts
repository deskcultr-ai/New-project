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
    | { email?: string; emails?: string[]; role?: "admin" | "employee"; departmentId?: string }
    | null;

  // Support both single email and bulk emails array
  const rawEmails = body?.emails ?? (body?.email ? [body.email] : []);
  const role = body?.role;
  const departmentId = body?.departmentId;

  const emails = rawEmails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e));

  if (emails.length === 0) {
    return NextResponse.json({ error: "Enter at least one valid email address." }, { status: 400 });
  }
  if (role !== "admin" && role !== "employee") {
    return NextResponse.json({ error: "role must be 'admin' or 'employee'." }, { status: 400 });
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

  // Super Admin creates/invites Admins to any department in the org.
  // Admin invites Employees, scoped to their own department only.
  if (role === "admin" && callerProfile.role !== "super_admin") {
    return NextResponse.json({ error: "Only a Super Admin can invite an Admin." }, { status: 403 });
  }
  if (role === "employee" && callerProfile.role !== "admin") {
    return NextResponse.json({ error: "Only an Admin can invite an Employee." }, { status: 403 });
  }
  if (role === "employee" && departmentId !== callerProfile.department_id) {
    return NextResponse.json({ error: "You can only invite employees into your own department." }, { status: 403 });
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

  const admin = await getSupabaseAdmin();

  // Send invites to all emails and collect results
  const results = await Promise.all(
    emails.map(async (email) => {
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { invite_role: role, organization_id: callerProfile.organization_id, department_id: department.id },
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
