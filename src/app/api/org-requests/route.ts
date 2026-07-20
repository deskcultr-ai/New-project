import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

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

  return NextResponse.json({ ok: true });
}
