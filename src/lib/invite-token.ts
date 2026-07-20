function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Random 32-byte token, hex-encoded. Only ever sent in an email link, never stored. */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** SHA-256 hash of a token -- this is what gets persisted in `invites.token_hash`. */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

export const INVITE_EXPIRY_DAYS: Record<"super_admin" | "admin" | "employee", number> = {
  super_admin: 14,
  admin: 7,
  employee: 7,
};

export function inviteExpiresAt(role: "super_admin" | "admin" | "employee"): string {
  const days = INVITE_EXPIRY_DAYS[role];
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
