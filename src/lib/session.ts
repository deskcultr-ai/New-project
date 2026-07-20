import { supabase } from "@/lib/supabase";

export type Profile = {
  id: string;
  organization_id: string;
  department_id: string | null;
  email: string;
  full_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  role: "super_admin" | "admin" | "employee";
  status: "active" | "disabled";
};

const PROFILE_COLUMNS = "id, organization_id, department_id, email, full_name, username, bio, avatar_url, role, status";

/** Current signed-in profile, or null when signed out / no profile row. */
export async function getProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", auth.user.id)
    .maybeSingle();
  return (data as Profile) ?? null;
}

export function isAdmin(profile: Profile | null): boolean {
  return !!profile && ["super_admin", "admin"].includes(profile.role);
}

export function isSuperAdmin(profile: Profile | null): boolean {
  return !!profile && profile.role === "super_admin";
}

/** Returns username (if set) → full_name → email prefix → "there" */
export function displayName(profile: Profile | null): string {
  if (!profile) return "there";
  return profile.username || profile.full_name || profile.email.split("@")[0] || "there";
}

/** Handle-style display: @username if set, otherwise full_name, then email prefix */
export function handleName(profile: { username?: string | null; full_name?: string | null; email?: string | null } | null): string {
  if (!profile) return "Unknown";
  if (profile.username) return `@${profile.username}`;
  return profile.full_name || (profile.email?.split("@")[0] ?? "Unknown");
}
