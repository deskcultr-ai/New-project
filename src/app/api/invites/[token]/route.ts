import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { hashInviteToken } from "@/lib/invite-token";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const tokenHash = await hashInviteToken(token);
  const admin = await getSupabaseAdmin();

  const { data: invite, error } = await admin
    .from("invites")
    .select("email, role, accepted_at, revoked_at, expires_at, organization_id, department_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !invite) {
    return NextResponse.json({ error: "This invite link is invalid." }, { status: 404 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "This invite has already been used." }, { status: 410 });
  }
  if (invite.revoked_at) {
    return NextResponse.json({ error: "This invite has been revoked." }, { status: 410 });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This invite link has expired." }, { status: 410 });
  }

  const [{ data: org }, deptResult] = await Promise.all([
    admin.from("organizations").select("name").eq("id", invite.organization_id).maybeSingle(),
    invite.department_id
      ? admin.from("departments").select("name").eq("id", invite.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    organizationName: org?.name ?? "your organization",
    departmentName: deptResult.data?.name ?? null,
  });
}
