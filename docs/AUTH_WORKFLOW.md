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
in the metadata instead. Who can invite whom is enforced in the route itself:
Organization Super Admin → Team Leader (any dept), Team Leader → Manager or
Executive (own dept), Manager → Executive (own dept).

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

**"Invite user"** — replace the default with something like:

```html
<h2>You're invited to DeskCulture</h2>
<p>You've been invited to join your team's workspace. Click below to
activate your account and set a password.</p>
<p><a href="{{ .ConfirmationURL }}">Accept invite</a></p>
<p style="color:#888;font-size:12px">If you weren't expecting this, you
can ignore this email.</p>
```

Keep `{{ .ConfirmationURL }}` — that's the link that lands on
`/auth/callback`. Don't remove it.

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
