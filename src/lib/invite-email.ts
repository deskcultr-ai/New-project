import { envValue } from "@/lib/env";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  employee: "Employee",
};

function inviteHtml(link: string, orgName: string, role: string) {
  const roleLabel = ROLE_LABEL[role] ?? role;
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f3ff;font-family:Arial,Helvetica,sans-serif;color:#101936;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f6f3ff;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e1ff;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 10px;">
                <div style="font-size:22px;font-weight:800;color:#101936;">DeskCulture</div>
                <h1 style="margin:22px 0 0;font-size:26px;line-height:1.25;">You're invited to join ${orgName}</h1>
                <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#536080;">
                  You've been invited as ${roleLabel}. Click below to set your password and activate your account.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:22px 32px;">
                <a href="${link}" style="display:inline-block;border-radius:14px;background:#5b36f2;color:#ffffff;text-decoration:none;padding:15px 24px;font-weight:800;font-size:15px;">
                  Accept invite
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <p style="margin:0;word-break:break-all;font-size:12px;line-height:1.6;color:#5b36f2;">${link}</p>
                <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">This link is single-use and will expire.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendInviteEmail(options: { to: string; orgName: string; role: string; link: string }) {
  const resendKey = await envValue("RESEND_API_KEY");
  if (!resendKey) {
    return { ok: false as const, error: "RESEND_API_KEY is not configured, so DeskCulture cannot send the invite email yet." };
  }

  const from = (await envValue("INVITE_FROM_EMAIL")) || "DeskCulture <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: options.to,
      subject: `You're invited to join ${options.orgName} on DeskCulture`,
      html: inviteHtml(options.link, options.orgName, options.role),
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    return { ok: false as const, error: `Resend rejected the invite email: ${details}` };
  }

  return { ok: true as const };
}
