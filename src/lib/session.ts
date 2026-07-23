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
  role: "org_super_admin" | "team_leader" | "manager" | "executive";
  status: "active" | "disabled";
};

const PROFILE_COLUMNS = "id, organization_id, department_id, email, full_name, username, bio, avatar_url, role, status";

export const ROLE_LABEL: Record<Profile["role"], string> = {
  org_super_admin: "Organization Super Admin",
  team_leader: "Team Leader",
  manager: "Manager",
  executive: "Executive",
};

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

/** True for anyone above Executive: Org Super Admin, Team Leader, or Manager. */
export function isAdmin(profile: Profile | null): boolean {
  return !!profile && ["org_super_admin", "team_leader", "manager"].includes(profile.role);
}

export function isSuperAdmin(profile: Profile | null): boolean {
  return !!profile && profile.role === "org_super_admin";
}

/** Team Leader or Manager -- has task-authority over Executives in their own department. */
export function isManagerOrAbove(profile: Profile | null): boolean {
  return !!profile && ["org_super_admin", "team_leader", "manager"].includes(profile.role);
}

/** Org Super Admin or Team Leader -- can create departments, invite Team Leaders/Managers, and write department resources. */
export function canManageDepartment(profile: Profile | null): boolean {
  return !!profile && ["org_super_admin", "team_leader"].includes(profile.role);
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
