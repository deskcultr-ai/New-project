import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { envValue, appOrigin } from "@/lib/env";
import { sendNotificationEmail } from "@/lib/notify-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { companyName?: string; contactName?: string; workEmail?: string; phone?: string }
    | null;

  const companyName = body?.companyName?.trim();
  const contactName = body?.contactName?.trim();
  const workEmail = body?.workEmail?.trim().toLowerCase();
  const phone = body?.phone?.trim() || null;

  if (!companyName || !contactName || !workEmail) {
    return NextResponse.json({ error: "Company name, contact name, and work email are required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(workEmail)) {
    return NextResponse.json({ error: "Enter a valid work email address." }, { status: 400 });
  }

  const admin = await getSupabaseAdmin();
  const { error } = await admin.from("pending_org_requests").insert({
    company_name: companyName,
    contact_name: contactName,
    work_email: workEmail,
    phone,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Notification only -- the actual approve action still requires signing
  // in to /platform-admin/requests. A one-click "approve" link in an email
  // would be triggerable by link-preview bots/forwarding, so this is
  // intentionally just a heads-up, not an action link.
  const owners = (await envValue("PLATFORM_OWNER_EMAILS"))
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (owners && owners.length > 0) {
    const requestsUrl = `${appOrigin(request)}/platform-admin/requests`;
    await sendNotificationEmail({
      to: owners,
      subject: `New organization request: ${companyName}`,
      html: `<!doctype html>
<html>
  <body style="margin:0;background:#f6f3ff;font-family:Arial,Helvetica,sans-serif;color:#101936;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f6f3ff;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e1ff;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:28px 32px 10px;">
            <div style="font-size:22px;font-weight:800;">DeskCulture</div>
            <h1 style="margin:22px 0 0;font-size:24px;line-height:1.25;">New organization request</h1>
            <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#536080;">
              <strong>${companyName}</strong> requested access.<br/>
              Contact: ${contactName} &lt;${workEmail}&gt;${phone ? ` · ${phone}` : ""}
            </p>
          </td></tr>
          <tr><td align="center" style="padding:22px 32px;">
            <a href="${requestsUrl}" style="display:inline-block;border-radius:14px;background:#5b36f2;color:#ffffff;text-decoration:none;padding:15px 24px;font-weight:800;font-size:15px;">
              Review request
            </a>
          </td></tr>
          <tr><td style="padding:0 32px 28px;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">Sign in to review and approve or reject -- this link does not approve anything by itself.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    });
  }

  return NextResponse.json({ ok: true });
}
