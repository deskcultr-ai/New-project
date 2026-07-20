"use client";

import { supabase } from "@/lib/supabase";

export async function getPostAuthRedirect() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;

  if (!user) return "/login";

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, company_id, status, role")
    .eq("id", user.id)
    .maybeSingle();

  // The handle_new_user trigger always creates a row, so a missing profile is
  // an edge case (e.g. trigger not yet run) -> let onboarding sort it out.
  if (!profile) return "/onboarding";

  // No org yet, or joined but not approved -> onboarding handles both states.
  if (!profile.company_id || profile.status !== "active") return "/onboarding";

  return ["super_admin", "admin"].includes(profile.role) ? "/admin" : "/dashboard";
}
