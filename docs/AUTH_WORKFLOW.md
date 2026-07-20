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
     { invite_role: 'super_admin', organization_id }, redirectTo:
     '.../auth/callback?next=/set-password' })`.
   - Marks the request `approved`.

## 2. What `inviteUserByEmail` actually does

This is the one thing that changed from the original design: instead of
generating our own token and calling Resend's HTTP API directly, invites
now go through Supabase Auth's native invite mechanism for every invite
type (Super Admin claim, Admin, Employee).

- Supabase creates the `auth.users` row **immediately** — at send time, not
  when the link is clicked — with our org/department/role data attached as
  `user_metadata`.
- A database trigger, `handle_new_invited_user()` (in
  `supabase/migrations/20260720000011_native_invites.sql`), fires on that
  insert and creates the matching `profiles` row right away (and claims
  `organizations.super_admin_id` if the invite was for a Super Admin).
  This means the person "exists" in the system the moment you click
  Approve/Send invite, before they've ever opened the email.
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
   which reads their `profiles` row and sends Super Admin/Admin to
   `/admin`, Employee to `/dashboard`.

Admin and Employee invites (sent from `/admin/people`, `POST
/api/invites`) work identically — same trigger, same email template, same
`/auth/callback → /set-password` path — just with `invite_role: 'admin'`
or `'employee'` and a `department_id` in the metadata instead.

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
| Sender email | `onboarding@resend.dev`, or your own verified domain in Resend once you have one |
| Sender name | `Deskcultr` |

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
