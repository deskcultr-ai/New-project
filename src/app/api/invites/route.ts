import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getBearerUser } from "@/lib/auth-server";
import { appOrigin } from "@/lib/env";
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from "@/lib/invite-token";
import { sendInviteEmail } from "@/lib/invite-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // RLS ("org admins can read relevant invites") already scopes this to
  // exactly what the caller is allowed to see.
  const { data, error } = await bearer.userClient
    .from("invites")
    .select("id, email, role, department_id, expires_at, accepted_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ invites: data });
}

export async function POST(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: string; role?: "admin" | "employee"; departmentId?: string }
    | null;

  const email = body?.email?.trim().toLowerCase();
  const role = body?.role;
  const departmentId = body?.departmentId;

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
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
  // (RLS-respecting client -- departments are only readable within one's own org).
  const { data: department, error: deptError } = await bearer.userClient
    .from("departments")
    .select("id, name, organization_id")
    .eq("id", departmentId)
    .maybeSingle();

  if (deptError || !department || department.organization_id !== callerProfile.organization_id) {
    return NextResponse.json({ error: "Department not found in your organization." }, { status: 400 });
  }

  const admin = await getSupabaseAdmin();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", callerProfile.organization_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Could not resolve your organization." }, { status: 400 });
  }

  const rawToken = generateInviteToken();
  const tokenHash = await hashInviteToken(rawToken);

  const { error: inviteError } = await admin.from("invites").insert({
    organization_id: callerProfile.organization_id,
    department_id: department.id,
    role,
    email,
    token_hash: tokenHash,
    invited_by: callerProfile.id,
    expires_at: inviteExpiresAt(role),
  });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  const link = `${appOrigin(request)}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  const emailResult = await sendInviteEmail({ to: email, orgName: org.name, role, link });

  return NextResponse.json({
    ok: true,
    emailSent: emailResult.ok,
    emailError: emailResult.ok ? undefined : emailResult.error,
  });
}
