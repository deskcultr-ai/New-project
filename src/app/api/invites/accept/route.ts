import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { hashInviteToken } from "@/lib/invite-token";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: string; password?: string } | null;
  const token = body?.token;
  const password = body?.password;

  if (!token || !password) {
    return NextResponse.json({ error: "Token and password are required." }, { status: 400 });
  }
  if (password.length < 10) {
    return NextResponse.json({ error: "Use a password with at least 10 characters." }, { status: 400 });
  }

  const tokenHash = await hashInviteToken(token);
  const admin = await getSupabaseAdmin();

  const { data: invite, error: inviteError } = await admin
    .from("invites")
    .select("id, email, role, organization_id, department_id, accepted_at, revoked_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError || !invite) {
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

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Could not create your account." }, { status: 400 });
  }

  const newUserId = created.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: newUserId,
    organization_id: invite.organization_id,
    department_id: invite.department_id,
    role: invite.role,
    email: invite.email,
    status: "active",
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: `Could not finish setting up your account: ${profileError.message}` }, { status: 400 });
  }

  if (invite.role === "super_admin") {
    const { error: claimError } = await admin
      .from("organizations")
      .update({ super_admin_id: newUserId })
      .eq("id", invite.organization_id)
      .is("super_admin_id", null);

    if (claimError) {
      await admin.from("profiles").delete().eq("id", newUserId);
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: `Could not claim Super Admin: ${claimError.message}` }, { status: 400 });
    }
  }

  await admin.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);

  return NextResponse.json({ ok: true, email: invite.email });
}
