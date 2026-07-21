import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getBearerUser, isPlatformOwnerEmail } from "@/lib/auth-server";
import { envValue, appOrigin } from "@/lib/env";

const DRIVE_BUCKET = "org-drive";

/** Recursively lists every file under a storage prefix (Supabase Storage's list() is one level deep only). */
async function listFilesRecursive(admin: SupabaseClient, prefix: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(DRIVE_BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];

  const files: string[] = [];
  for (const entry of data) {
    const entryPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      // A null id means this listing is a "folder" (a common path prefix), not a file -- recurse into it.
      files.push(...(await listFilesRecursive(admin, entryPath)));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

/** Deletes every stored file (attachments, resources, personal folders, avatars) under an organization's prefix. */
async function deleteOrgStorage(admin: SupabaseClient, organizationId: string) {
  const files = await listFilesRecursive(admin, organizationId);
  if (files.length === 0) return;
  for (let i = 0; i < files.length; i += 100) {
    await admin.storage.from(DRIVE_BUCKET).remove(files.slice(i, i + 100));
  }
}

/**
 * Fully tears down an approved organization: every person's auth account
 * (so they can never log in again), the org row (which cascades
 * departments/tasks/conversations/messages/activity logs via FK), and its
 * stored files. task_forward_requests references profiles without a
 * cascade, so it's cleared explicitly first to avoid an FK violation.
 */
async function deleteOrganizationFully(admin: SupabaseClient, organizationId: string) {
  const { data: profiles } = await admin.from("profiles").select("id").eq("organization_id", organizationId);
  const profileIds = (profiles ?? []).map((p) => p.id as string);

  const { data: tasks } = await admin.from("tasks").select("id").eq("organization_id", organizationId);
  const taskIds = (tasks ?? []).map((t) => t.id as string);
  if (taskIds.length > 0) {
    await admin.from("task_forward_requests").delete().in("task_id", taskIds);
  }

  await deleteOrgStorage(admin, organizationId);

  const { error: orgDeleteError } = await admin.from("organizations").delete().eq("id", organizationId);
  if (orgDeleteError) throw new Error(orgDeleteError.message);

  for (const profileId of profileIds) {
    await admin.auth.admin.deleteUser(profileId);
  }
}

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

export async function DELETE(request: Request) {
  const owner = await requirePlatformOwner(request);
  if (!owner) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Request ID is required." }, { status: 400 });
  }

  const admin = await getSupabaseAdmin();

  // If this request was approved, an organization (with real people signed
  // into it) exists and must be fully torn down first -- otherwise deleting
  // just this request row would only detach it (org_request_id is ON DELETE
  // SET NULL), leaving the org and everyone's login access intact.
  const { data: org } = await admin.from("organizations").select("id").eq("org_request_id", id).maybeSingle();
  if (org) {
    try {
      await deleteOrganizationFully(admin, org.id as string);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Could not delete the organization.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const { error } = await admin.from("pending_org_requests").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
