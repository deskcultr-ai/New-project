import { createClient } from "@supabase/supabase-js";
import { envValue } from "@/lib/env";

/**
 * Service-role client: bypasses RLS entirely. Only ever use this after the
 * route handler has independently verified the caller is allowed to do
 * whatever it's about to do -- this client trusts the caller completely.
 */
export async function getSupabaseAdmin() {
  const url = await envValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = await envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Supabase service-role credentials are not configured.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/**
 * RLS-respecting client scoped to the calling user's own access token.
 * Use this to check *what the caller is allowed to see/do* before
 * escalating to getSupabaseAdmin() for the actual privileged write.
 */
export async function getSupabaseForUser(authorizationHeader: string) {
  const url = await envValue("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = await envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("Supabase credentials are not configured.");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorizationHeader } },
    auth: { persistSession: false },
  });
}
