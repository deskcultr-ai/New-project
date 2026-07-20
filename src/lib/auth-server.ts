import { getSupabaseForUser } from "@/lib/supabase-server";

/** Resolves the caller from an incoming request's Authorization bearer header, or null if absent/invalid. */
export async function getBearerUser(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const userClient = await getSupabaseForUser(authorization);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token, userClient };
}

export function isPlatformOwnerEmail(email: string | null | undefined, allowlist: string | undefined): boolean {
  if (!email || !allowlist) return false;
  const list = allowlist
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
