import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getBearerUser, isPlatformOwnerEmail } from "@/lib/auth-server";
import { envValue, appOrigin } from "@/lib/env";

async function requirePlatformOwner(request: Request) {
  const bearer = await getBearerUser(request);
  if (!bearer) return null;
  const allowlist = await envValue("PLATFORM_OWNER_EMAILS");
  if (!isPlatformOwnerEmail(bearer.user.email, allowlist)) return null;
  return bearer;
}

export async function GET(request: Request) {
  const owner = await requirePlatformOwner(request);
  if (!owner) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const admin = await getSupabaseAdmin();
  const { data, error } = await admin
    .from("pending_org_requests")
    .select("id, company_name, contact_name, work_email, phone, status, created_at, reviewed_at, rejection_reason")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ requests: data });
}

export async function POST(request: Request) {
  const owner = await requirePlatformOwner(request);
  if (!owner) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { requestId?: string; action?: "approve" | "reject"; rejectionReason?: string }
    | null;

  const requestId = body?.requestId;
  const action = body?.action;
  if (!requestId || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "requestId and a valid action are required." }, { status: 400 });
  }

  const admin = await getSupabaseAdmin();
  const { data: orgRequest, error: fetchError } = await admin
    .from("pending_org_requests")
    .select("id, company_name, contact_name, work_email, status")
    .eq("id", requestId)
    .maybeSingle();

  if (fetchError || !orgRequest) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (orgRequest.status !== "pending") {
    return NextResponse.json({ error: "This request has already been reviewed." }, { status: 400 });
  }

  if (action === "reject") {
    const { error } = await admin
      .from("pending_org_requests")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: owner.user.email,
        rejection_reason: body?.rejectionReason?.trim() || null,
      })
      .eq("id", requestId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // action === "approve": create the org, issue the Super Admin claim invite, email it.
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: orgRequest.company_name, org_request_id: orgRequest.id })
    .select("id, name")
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: orgError?.message ?? "Could not create the organization." }, { status: 400 });
  }

  // Supabase Auth's native invite: creates the auth.users row immediately
  // (the on_auth_user_created trigger creates the profile + claims
  // super_admin_id right away, no separate redemption step needed) and
  // sends the "Invite user" email template through whatever SMTP is
  // configured in the Supabase dashboard.
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(orgRequest.work_email, {
    data: { invite_role: "super_admin", organization_id: org.id },
    redirectTo: `${appOrigin(request)}/auth/callback?next=/set-password`,
  });

  const { error: updateError } = await admin
    .from("pending_org_requests")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: owner.user.email })
    .eq("id", requestId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    emailSent: !inviteError,
    emailError: inviteError ? inviteError.message : undefined,
  });
}
