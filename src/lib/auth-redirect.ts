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
