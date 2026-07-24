# Auth & Invite Workflow

How accounts get created in DeskCulture, end to end. There is no public
sign-up anywhere in the product — every account starts as an invite sent by
someone who already has one, going back to a single manually-approved
org request.

## 1. Organization request → approval

1. A company submits **`/request-org`** (public, no login): company name,
   contact name, work email, phone. This inserts one row into
   `pending_org_requests` — no organization exists yet.
2. The platform owner (**deskcultr@gmail.com**, via `PLATFORM_OWNER_EMAILS`)
   reviews it at **`/platform-admin/requests`**. That page is reachable by
   anyone, but the underlying API route independently re-checks the
   caller's email against the server-only `PLATFORM_OWNER_EMAILS` before
   touching any data — the page-level check is just UX.
3. **Reject** just marks the row `rejected` with an optional reason.
4. **Approve**:
   - Creates the `organizations` row.
   - Calls Supabase Auth's `admin.inviteUserByEmail(work_email, { data:
     { invite_role: 'org_super_admin', organization_id }, redirectTo:
     '.../auth/callback?next=/set-password' })`.
   - Marks the request `approved`.

## 2. What `inviteUserByEmail` actually does

This is the one thing that changed from the original design: instead of
generating our own token and calling Resend's HTTP API directly, invites
now go through Supabase Auth's native invite mechanism for every invite
type (Organization Super Admin claim, Team Leader, Manager, Executive).

- Supabase creates the `auth.users` row **immediately** — at send time, not
  when the link is clicked — with our org/department/role data attached as
  `user_metadata`.
- A database trigger, `handle_new_invited_user()` (in
  `supabase/migrations/20260720000011_native_invites.sql`, updated for the
  4-tier hierarchy in `20260723000001_rbac_manager_tier.sql`), fires on that
  insert and creates the matching `profiles` row right away (and claims
  `organizations.org_super_admin_id` if the invite was for an Organization
  Super Admin). This means the person "exists" in the system the moment you
  click Approve/Send invite, before they've ever opened the email.
- Supabase sends the email using its own **"Invite user"** template
  (Dashboard → Authentication → Emails → Templates), through whatever SMTP
  is configured (see Section 5 — this is not optional, see the warning
  below).

**"Pending" vs "Active"** (shown in `/admin/people`'s directory list) is
read from `auth.users.confirmed_at`: null until the invitee opens the
email and the link is verified, set once they have.

## 3. What's in the email, and what page it opens

The **Invite user** email (see Section 5 for the exact content to paste
in) contains one link. Clicking it:

1. Lands on **`/auth/callback?token_hash=...&type=invite`**.
2. The page calls `supabase.auth.verifyOtp({ token_hash, type: 'invite' })`
   — this authenticates them (they now have a session) without a password.
3. Because `type === 'invite'`, it redirects to **`/set-password`** instead
   of going straight into the app.
4. `/set-password` shows "You're signed in as `<email>`" and lets them set
   a password — or **skip it entirely** ("I'll sign in with an emailed
   code" — PRD explicitly allows OTP-only login, so a password was never
   required).
5. Either path ends at `getPostAuthRedirect()` (`src/lib/auth-redirect.ts`),
   which reads their `profiles` row and sends Organization Super
   Admin/Team Leader/Manager to `/admin`, Executive to `/dashboard`.

Team Leader, Manager, and Executive invites (sent from `/admin/people`,
`POST /api/invites`) work identically — same trigger, same email template,
same `/auth/callback → /set-password` path — just with
`invite_role: 'team_leader' | 'manager' | 'executive'` and a `department_id`
in the metadata instead. Who can invite whom is enforced in the route
itself: **Organization Super Admin → Team Leader, Manager, or Executive
(any department — the only role that can skip straight to any tier)**,
Team Leader → Manager or Executive (own dept), Manager → Executive (own
dept).

The invite metadata (`user_metadata`, readable in the email template as
`.Data.*`) also carries `invite_role_label` (a human-readable "Team
Leader"/"Manager"/"Executive" string), `organization_name`, and
`department_name` — added specifically so the single "Invite user" email
template (Section 5b) can greet people by org/department/role without
needing separate templates per role, since Supabase Auth only has one
template slot per auth event type.

## 4. Login (existing accounts)

`/login` offers two tabs:

- **Password** — `signInWithPassword`. Only works if they went through
  `/set-password` at some point.
- **Email code** — `signInWithOtp({ email, options: { shouldCreateUser:
  false } })`. `shouldCreateUser: false` is what keeps this invite-only:
  it can only authenticate someone who already has an account, never
  create a new one. The emailed code is verified via `verifyOtp({ email,
  token, type: 'email' })` — this is Supabase's **Magic Link** template,
  a different one from Invite (see Section 5).

## 5. Manual setup required (Supabase Dashboard only)

I can't do this part myself — SMTP settings and email template content
live in the Supabase Dashboard, and there's no Management API token
available to script it. This has to be done once, by you.

### 5a. SMTP — Authentication → Emails → SMTP Settings

**This is not optional.** Testing this build, `inviteUserByEmail` /
`generate_link` calls **hung and timed out** with no custom SMTP
configured — Supabase's default shared sender did not work reliably
enough for invites to function at all, not just "slow." Turn on custom
SMTP with:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) |
| Username | `resend` |
| Password | your Resend API key (the same one previously used directly — `re_...`) |
| Sender email | **`onboarding@resend.dev`** — see warning below |
| Sender name | `Deskcultr` |

**Confirmed by a live send test:** setting "Sender email address" to
`deskcultr@gmail.com` (or any other address on a domain you haven't
verified in Resend) makes *every* send fail — including to
`deskcultr@gmail.com` itself — with `"Error sending invite/magic link
email"`. Resend will only relay mail whose `From` address is on a domain
you've proven you own via DNS (Settings → Domains in Resend), and Gmail's
domain isn't yours to verify. `onboarding@resend.dev` is Resend's own
pre-verified shared domain — use that as the sender until you've verified
a real domain of your own.

Even with the sender fixed, an unverified Resend account is in **sandbox
mode**: it can only deliver to the email address you signed up to Resend
with (confirmed by test: sending to a third-party address returned
`"Error sending invite email"` immediately, not a timeout). Until you
verify a domain at **resend.com/domains**, real end-to-end testing only
works if the invited email matches your Resend account's own email.
Verifying a domain removes this restriction entirely.

### 5b. Email templates — Authentication → Emails → Templates

**"Invite user"** — Supabase only gives you one template slot for this
event, but the invite metadata carries `invite_role`, `invite_role_label`,
`organization_name`, and `department_name` (readable as `.Data.*`), so the
one template still reads differently per role via plain Go template
conditionals. This is the actual template in use — gradient header, feature
checklist, and CTA are the existing DeskCulture branding; only the
greeting, description, and feature list are role-aware:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're Invited to DeskCulture</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.08);">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:40px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:32px;">DeskCulture</h1>
    <p style="margin-top:12px;color:#E9E7FF;font-size:16px;">One Workspace. All Your Work.</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:45px;">
    <p style="font-size:14px;color:#6b7280;margin:0;">👋 Hello,</p>
    <h2 style="margin:18px 0 12px;font-size:28px;color:#111827;">
      You're invited to join {{ .Data.organization_name }}!
    </h2>
    <p style="font-size:16px;line-height:28px;color:#4b5563;">
      You've been invited to join <strong>{{ .Data.organization_name }}</strong>'s
      workspace on <strong>DeskCulture</strong> as a
      <strong>{{ .Data.invite_role_label }}</strong>{{ if .Data.department_name }} in the
      <strong>{{ .Data.department_name }}</strong> department{{ end }}, where your team
      collaborates on tasks, chats, meetings, documents, and projects—all in one
      secure workspace.
    </p>

    <!-- Feature Box: role-specific checklist -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:14px;">
      <tr><td style="padding:24px;">
        <h3 style="margin:0 0 15px;color:#111827;">What you'll get access to</h3>
        <table width="100%">
          {{ if eq .Data.invite_role "team_leader" }}
          <tr><td style="padding:8px 0;color:#374151;">✅ Invite Managers &amp; Executives into {{ .Data.department_name }}</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Create &amp; assign tasks across the whole organization</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ See how {{ .Data.department_name }} compares org-wide</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Team Chat, Shared Drive &amp; Meetings</td></tr>
          {{ else if eq .Data.invite_role "manager" }}
          <tr><td style="padding:8px 0;color:#374151;">✅ Invite &amp; manage your own Executives in {{ .Data.department_name }}</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Create, assign &amp; track their tasks day to day</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Shared Files &amp; Organization Drive</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Team Chat &amp; Meetings</td></tr>
          {{ else }}
          <tr><td style="padding:8px 0;color:#374151;">✅ Your own task board in {{ .Data.department_name }}</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Create tasks for yourself &amp; track what's assigned to you</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Shared Files &amp; Organization Drive</td></tr>
          <tr><td style="padding:8px 0;color:#374151;">✅ Team Chat &amp; Meetings</td></tr>
          {{ end }}
        </table>
      </td></tr>
    </table>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" align="center">
      <tr><td bgcolor="#4F46E5" style="border-radius:10px;">
        <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite"
           style="display:inline-block;padding:16px 38px;color:#ffffff;font-size:16px;text-decoration:none;font-weight:bold;">
          Accept Invitation →
        </a>
      </td></tr>
    </table>

    <p style="margin-top:30px;color:#6b7280;font-size:14px;text-align:center;">
      Activate your account and create your password to get started.
    </p>
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:35px 0;">
    <p style="font-size:13px;color:#9CA3AF;line-height:22px;">
      If the button above doesn't work, copy and paste this link into your browser:
    </p>
    <p style="word-break:break-all;font-size:13px;color:#4F46E5;">
      {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:30px;background:#F9FAFB;text-align:center;">
    <p style="margin:0;color:#6B7280;font-size:14px;">This invitation was sent securely by <strong>DeskCulture</strong>.</p>
    <p style="margin-top:12px;color:#9CA3AF;font-size:12px;">If you weren't expecting this invitation, you can safely ignore this email. No account will be created until you accept it.</p>
    <p style="margin-top:25px;font-size:12px;color:#D1D5DB;">© 2026 DeskCulture. All rights reserved.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>
```

Keep the `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite`
link (appears twice — CTA button and plain-text fallback) — that's what
lands on `/auth/callback`. It's equivalent to Supabase's shorthand
`{{ .ConfirmationURL }}`; don't swap one for the other without testing,
and don't remove either occurrence. Rendered previews of what each role
actually receives, plus a copy-paste panel, are in the reference artifact
linked from the chat that introduced role-aware invites.

**"Magic Link"** — used by `/login`'s "Email code" tab. Must keep
`{{ .Token }}` (the 6-digit code the login page asks the user to type),
not just the link:

```html
<h2>Your DeskCulture sign-in code</h2>
<p>Enter this code to sign in:</p>
<p style="font-size:28px;font-weight:800;letter-spacing:4px">{{ .Token }}</p>
<p>Or click: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
```

### 5c. URL Configuration — Authentication → URL Configuration

Confirm the redirect allow-list includes
`https://deskculture.deskcultr.workers.dev/auth/callback` (and your local
dev URL, `http://localhost:3000/auth/callback`, if you test locally).

## Walkthrough: approving a request as the platform owner

`deskcultr@gmail.com` has no password (its only login history is the old
app's Google sign-in, which New doesn't support) — so the platform owner
signs in via the **OTP tab**, not password:

1. Go to `/login` → "Email code" tab → enter `deskcultr@gmail.com` → Send code.
2. Check that inbox for the 6-digit code (this email only arrives once SMTP
   is fixed per 5a above), type it in, submit.
3. Go directly to **`/platform-admin/requests`** — there's no nav link to
   it on purpose (it's not part of any org, so it doesn't belong in the
   AppShell sidebar); it's a URL you go to directly, gated by the
   `PLATFORM_OWNER_EMAILS` check described in Section 1.
4. Each pending request shows Approve/Reject. Approve fires the
   Organization Super Admin invite email (Section 2) to that request's work
   email.

## Walkthrough: how an Executive (or Team Leader/Manager) signs in

Nobody signs up — every non-owner account starts as an invite:

1. An Organization Super Admin creates a department and invites a Team
   Leader to it, from `/admin/people`. That Team Leader then invites
   Managers or Executives into their own department from the same page; a
   Manager can in turn invite Executives into that same department.
2. The invitee gets the "Invite user" email → clicks the link →
   `/auth/callback` → `/set-password` (Section 3) → sets a password or
   skips it.
3. From then on they use `/login` like anyone else — either tab:
   **Password**, or **Email code** (OTP) if they skipped setting one.
4. `getPostAuthRedirect()` sends Organization Super Admin/Team
   Leader/Manager to `/admin`, Executive to `/dashboard`, automatically,
   based on their `profiles.role`.

## Notes on this pass's cleanup

- Deleted the real pending org request from "Belle" (deskcultr@gmail.com)
  that was sitting unapproved.
- Deleted 8 leftover `auth.users` accounts from the old DeskCultre-main
  app (Google OAuth sign-ins — New has no Google sign-in at all, so these
  were just dangling and would have blocked those people from ever being
  properly invited under the same email).
- **Deliberately kept** the `deskcultr@gmail.com` Google-OAuth account
  rather than deleting it along with the other 8: that address is the
  platform owner, and since New has no public sign-up and no
  Google sign-in, deleting it would have left no way to ever create a
  fresh login for that email — the platform owner would have been locked
  out of `/platform-admin/requests`. Worth deciding deliberately whether
  to replace it with a proper invite-issued account later.
