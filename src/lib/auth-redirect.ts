"use client";

import { supabase } from "@/lib/supabase";

function isPlatformOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.NEXT_PUBLIC_PLATFORM_OWNER_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

export async function getPostAuthRedirect() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;

  if (!user) return "/login";

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, status, role")
    .eq("id", user.id)
    .maybeSingle();

  // Accounts only ever exist via an accepted invite, which always sets
  // organization_id/status together -- a missing or disabled profile means
  // something's wrong (deactivated, or a stale session)... unless this is
  // the platform owner, who is allowlist-gated rather than org-profile-
  // based and legitimately has no profiles row at all. Org membership
  // (if the owner also happens to be invited into an org) still wins.
  if (!profile || !profile.organization_id || profile.status !== "active") {
    return isPlatformOwner(user.email) ? "/platform-admin/requests" : "/login";
  }

  return ["super_admin", "admin"].includes(profile.role) ? "/admin" : "/dashboard";
}

/**
 * Same as getPostAuthRedirect(), but never hangs the caller. By the time
 * this runs, sign-in has already succeeded (password/OTP/invite link all
 * verified) -- so if the profile lookup itself stalls, land on /dashboard
 * rather than leaving a "Verifying..." button stuck forever with no
 * feedback. The destination page's own load can retry from there.
 */
export async function getPostAuthRedirectSafe(timeoutMs = 10000): Promise<string> {
  try {
    return await Promise.race([
      getPostAuthRedirect(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs)),
    ]);
  } catch {
    return "/dashboard";
  }
}
