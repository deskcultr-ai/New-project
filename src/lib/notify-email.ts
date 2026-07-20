import { envValue } from "@/lib/env";

/**
 * Plain transactional notifications (not tied to a Supabase Auth flow, so
 * the native invite/magic-link email system doesn't apply here) still go
 * straight through Resend's HTTP API, same as before the switch to
 * Supabase-native auth emails.
 */
export async function sendNotificationEmail(options: { to: string[]; subject: string; html: string }) {
  const resendKey = await envValue("RESEND_API_KEY");
  if (!resendKey || options.to.length === 0) {
    return { ok: false as const, error: "RESEND_API_KEY is not configured or there is no recipient." };
  }

  const from = (await envValue("INVITE_FROM_EMAIL")) || "DeskCulture <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: options.to, subject: options.subject, html: options.html }),
  });

  if (!response.ok) {
    const details = await response.text();
    return { ok: false as const, error: `Resend rejected the notification email: ${details}` };
  }
  return { ok: true as const };
}
