"use client";

import { supabase } from "@/lib/supabase";

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
  // something's wrong (deactivated, or a stale session), not an onboarding
  // step to walk through.
  if (!profile || !profile.organization_id || profile.status !== "active") return "/login";

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
