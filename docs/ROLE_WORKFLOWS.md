# DeskCulture — Role Workflows & UI Flow

This documents what each role can actually do in the product: every screen,
every button, and what happens underneath when it's clicked. For how
accounts/emails/login work mechanically, see [AUTH_WORKFLOW.md](./AUTH_WORKFLOW.md) —
this file is about *what you can do once you're in*.

## The four roles

| Role | Scope | Lands on | Tied to an org? |
|---|---|---|---|
| **Platform Owner** | Whole platform | `/platform-admin/requests` | No — allowlist-gated (`PLATFORM_OWNER_EMAILS`), not a `profiles` row |
| **Super Admin** (Org Owner) | Whole organization | `/admin` | Yes — one per org, `organizations.super_admin_id` |
| **Admin** | One department | `/admin` | Yes — `profiles.department_id` |
| **Employee** | Themself | `/dashboard` | Yes — `profiles.department_id` |

There is exactly **one Super Admin per organization** (the person whose org
request got approved). Everyone else in that org is either an Admin (runs
one department) or an Employee (works inside one department). Enforcement
is not just "hide the button" — every table (`tasks`, `messages`,
`profiles`, storage objects, etc.) has Postgres Row Level Security that
independently blocks cross-department/cross-org reads and writes, so this
holds even if someone calls the API directly.

---

## 1. Platform Owner

**You.** Not a member of any organization — you exist only in
`auth.users` + the `PLATFORM_OWNER_EMAILS` allowlist. Your one screen:

### `/platform-admin/requests` — Organization requests

- A list of every row in `pending_org_requests`, newest first, each showing
  company name, contact name, work email, phone, status badge
  (`pending` / `approved` / `rejected`), and timestamp.
- Each **pending** row has two buttons:
  - **Approve** — creates the `organizations` row, then calls Supabase's
    native `admin.inviteUserByEmail()` for the contact's work email with
    `invite_role: "super_admin"` and the new `organization_id` attached as
    metadata. A database trigger creates their `profiles` row (status
    `active`) immediately — before they've even opened the email — and
    claims `organizations.super_admin_id`. An email goes out with a
    sign-in link.
  - **Reject** — prompts for an optional reason, marks the row `rejected`.
    No account or org is created.
- You get an **email notification** (via Resend, sent to every address in
  `PLATFORM_OWNER_EMAILS`) every time someone submits a new request at
  `/request-org`, with a "Review request" link back to this page — but the
  link doesn't approve anything by itself; you still have to sign in and
  click Approve. This is deliberate: a one-click email-approve link would
  be triggerable by link-preview bots or accidental forwarding.

That's the entire Platform Owner surface. You never see anyone's tasks,
messages, or files — approving a request is the full extent of platform
administration.

---

## 2. Public: requesting an organization

Anyone (no login) can go to `/request-org` and fill in:

- Company name
- Contact person
- Work email
- Phone *(optional)*

Submitting shows a "Request received" confirmation and creates a `pending`
row for you to review as above. This is the *only* way an organization
gets created — there's no self-serve signup.

---

## 3. Super Admin (Org Owner)

Lands on `/admin` after signing in. Left nav: **Overview · Departments &
People · Tasks · Messages · Drive · Settings**.

### `/admin` — Overview
Org-wide dashboard: department count, and a task-status breakdown (To Do /
In Progress / In Review / Done) across the **entire organization**.

### `/admin/people` — Departments & People
This is the org's structural control panel. Three sections:

- **Departments** — a text field + "Add department" button. Departments
  are flat (org-wide), created only by the Super Admin.
- **Invite an Admin** — email field + department dropdown + "Send invite"
  button. This is how you populate departments: invite someone as the
  **Admin** of a specific department. Behind the scenes: `POST
  /api/invites` → `admin.inviteUserByEmail()` with `invite_role: "admin"`
  and the chosen `department_id` → their account + active profile exist
  immediately, invite email sent.
- **Org directory** — every person in the org, with an **Active/Pending**
  badge (Pending = they haven't opened their invite email yet;
  the account and permissions are already live either way) and a role
  badge.

### `/admin/tasks` — Tasks (org-wide board)
A Kanban-style board (To Do / In Progress / In Review / Done columns) plus
a **New task** form:

- Title, Due date, Description
- **Department** — required, any department in the org
- Priority (Low/Medium/High/Urgent)
- **Assign to** — any **Admin or Employee** in the org (Super Admin can
  assign across every department, not just their own)

Clicking any task card opens `/tasks/[id]` (shared detail page, see
§6 below) where you have full edit rights: status, blocked flag, priority,
and reassignment, plus comments and attachments.

### `/admin/settings` — Settings (Super Admin only — Admins get redirected out)
- **Storage usage**: total bytes and file count used across the whole
  org's task attachments, chat files, department resources, and personal
  folders (`org_storage_usage()` RPC).

### Messages & Drive
Same as described in §6/§7 below, but with org-wide visibility: every
department channel, every teammate's personal folder, every department's
resource library.

---

## 4. Admin (Department Admin)

Also lands on `/admin`, same nav minus **Settings**, and every page is
automatically scoped to their own department only — this isn't a separate
codebase, it's the same pages as the Super Admin's with narrower data
(enforced by RLS, not just hidden UI).

### `/admin` — Overview
Same layout as the Super Admin's, but task counts read: *"Task counts
cover your department's tasks and tasks assigned to your team."*

### `/admin/people` — Team
- No "Departments" section (Admins can't create departments).
- **Invite an Employee** — email field only (no department picker — it's
  locked to their own department). "Emails a link to join
  \<Department Name\>." Behind the scenes this calls the same
  `POST /api/invites`, but the API enforces `invite_role: "employee"` for
  anyone who isn't a Super Admin, and forces the department to the
  caller's own — an Admin cannot invite into another department even by
  editing the request.
- **Your team** — only people in their own department.

### `/admin/tasks` — Tasks (your department's board)
Same Kanban board and "New task" form, except:
- **Department** field is fixed/read-only, shown as their own department name.
- **Assign to** only lists **Employees in their department** (not other
  Admins, not people outside the department).

An Admin can edit any task within their department the same way a Super
Admin can (status, priority, blocked flag, reassignment) — `canEditFully`
in the task detail page is true for both `super_admin` and `admin`.

### Drive & Messages
Scoped the same way — their own department's resource folder and
personal-folder list of teammates, their department's channel plus DMs
and Announcements (read-only for Announcements, see §7).

---

## 5. Employee

Lands on `/dashboard` — deliberately the simplest screen in the app. Left
nav: **My Tasks · Messages · Drive** (no admin section at all).

### `/dashboard` — My Tasks
A flat list of only the tasks **assigned to them**, sorted by due date
then priority. Each card shows title, description preview, Blocked badge
if applicable, status, priority, and due date. Clicking one opens
`/tasks/[id]`.

### `/tasks/[id]` (as an Employee)
Can:
- Change **Status** (To Do → In Progress → In Review → Done)
- Toggle **Blocked**
- Add **comments**
- **Upload attachments** (re-uploading the same filename keeps the older
  version instead of overwriting it — see the version history under each
  attachment)

Cannot:
- Change priority or reassign the task — those fields are hidden entirely
  (`canEditFully` is false for `employee`).

### Drive
- Their own **Personal Folder** only (private working space).
- Their **department's** resource library — read-only unless they're an
  Admin/Super Admin (`canWriteResources` gates the "+ Upload" button on
  the department Drive page).
- No visibility into anyone else's personal folder, and no "Team personal
  folders" section at all (that section only renders for non-employees).

### Messages
Full access to send/receive — DMs, their department channel, and reading
(but not posting to) Announcements.

---

## 6. Task assignment flow, end to end

```
Super Admin                    Admin                        Employee
────────────                   ─────                        ────────
Creates task in ANY             Creates task in THEIR
department, assigns to          department only, assigns
any Admin or Employee           to any Employee in that
in the org                      department
        │                              │
        └──────────────┬───────────────┘
                        ▼
              tasks row created
              (department_id, assigned_to,
               created_by, priority, due_date)
                        │
                        ▼
              Assignee sees it:
              - Employee → /dashboard "My Tasks"
              - Admin/Super Admin → their /admin/tasks board
                        │
                        ▼
              Assignee opens /tasks/[id]:
              - updates Status / Blocked (everyone)
              - Admin/Super Admin can also change
                Priority and reassign
              - anyone with access can comment
                and upload attachments
```

Practical notes:
- **Reassignment** is only available to Admin/Super Admin — an Employee
  can't hand a task to someone else, only update its status.
- **Who can see a task at all** is enforced by RLS
  (`can_access_task()`/direct department checks): Super Admin sees every
  task in the org; Admin sees tasks in their own department; Employee sees
  only tasks assigned to them (plus ones they created, if applicable).
- **Cross-linking into chat**: typing `#` in any message composer
  autocompletes task titles and drops in a live task chip — clicking it
  jumps straight to `/tasks/[id]`. This works for any task the poster has
  access to.
- There is currently **no automatic notification** when a task is
  assigned or reassigned — the assignee finds out by checking their board/
  dashboard, or if someone `@mentions`/DMs them about it in Messages
  (which *does* notify, see below).

---

## 7. Communication layer

`/messages` — three kinds of conversations, all real-time (Supabase
Realtime subscriptions, not polling):

- **Announcements** — one per org, auto-created when the org is created.
  Everyone in the org can read it; **only the Super Admin can post**
  (`canPost` check — Admins/Employees see "Only the Super Admin can post
  to Announcements" instead of a composer).
- **Department channel** — one per department, auto-created when the
  department is created. Everyone in that department can read/post;
  people outside the department can't see it exists.
- **Direct messages** — click **+ New message**, search the org directory,
  pick someone → `get_or_create_dm()` either opens the existing DM or
  creates a new one (deduplicated so you never get two DM threads with the
  same person).

Inside a conversation:
- **Presence** — a green dot next to a person's name (in the DM picker and
  conversation list) shows they're currently online, via a Realtime
  presence channel scoped to the org.
- **Unread counts** — a red badge per conversation, computed from
  `conversation_reads.last_read_at` vs. new messages; clears when you open
  the conversation.
- **@mentions** — typing `@` autocompletes org members; picking one
  inserts their name and, on send, triggers a **notification** (bell icon,
  top right) to that person via a database trigger.
- **# task references** — typing `#` autocompletes task titles; picking
  one inserts a live task chip in the message that renders the task's
  current title/status and links to `/tasks/[id]`.
- **Reactions** — hover the `+` next to any message to react with one of a
  fixed emoji set; click an existing reaction to toggle your own on/off.
- **Attachments** — attach one file per message via the file input next to
  Send; stored the same way as task/drive files, downloadable/previewable
  inline.
- **DMs also notify**: any new DM message creates a notification for the
  recipient, same bell icon.

The **notification bell** (top-right of every page) shows the 8 most
recent notifications, a red count badge for unread ones, and live-updates
via Realtime as new ones arrive. Clicking one marks it read and navigates
to its `link` (a task or a conversation).

---

## 8. Org Drive

`/drive` — files organized to mirror the org chart automatically, no
manual folder creation:

- **Departments** grid — Super Admin sees all; Admin/Employee see only
  their own. Clicking one opens `/drive/departments/[id]`:
  - **Resources** — department-level shared files (SOPs, templates).
    Upload button only shown if `canWriteResources` (Super Admin, or the
    Admin of *that specific* department).
  - **Task folders** — every task in that department, expandable to show
    its attachments (same files as on the task detail page) with an "Open
    task" shortcut.
- **My Personal Folder** — always visible, private working space, only
  the owner and org admins (Admin of their dept, or Super Admin) can see
  it.
- **Team personal folders** — Admin/Super Admin only; a grid of teammates'
  personal folders (Admin sees their department's people, Super Admin
  sees everyone) they can open to view/manage.
- File preview: images/PDFs/text preview inline via a modal
  (`FilePreviewModal`); other types download via a signed URL.
- Re-uploading a file with the same name (in personal folders or resources)
  **overwrites** it there (`upsert: true`) — version history (keeping old
  versions) is specific to **task attachments** only, not Drive resources
  or personal files.

---

## 9. Authorization matrix

| Action | Platform Owner | Super Admin | Admin | Employee |
|---|:---:|:---:|:---:|:---:|
| Approve/reject org requests | ✅ | — | — | — |
| Create departments | — | ✅ | — | — |
| Invite an Admin | — | ✅ | — | — |
| Invite an Employee | — | ✅ (any dept) | ✅ (own dept only) | — |
| View storage usage (`/admin/settings`) | — | ✅ | — | — |
| Create a task | — | ✅ (any dept) | ✅ (own dept) | — |
| Assign / reassign a task | — | ✅ (anyone) | ✅ (own dept's employees) | — |
| Change task status / blocked flag | — | ✅ | ✅ | ✅ (own tasks) |
| Change task priority | — | ✅ | ✅ | — |
| Comment / upload attachments on a task | — | ✅ | ✅ | ✅ (tasks they can see) |
| Post to Announcements | — | ✅ | — | — |
| Post to a department channel | — | ✅ (any) | ✅ (own dept) | ✅ (own dept) |
| Send DMs | — | ✅ | ✅ | ✅ |
| Upload department Resources | — | ✅ (any dept) | ✅ (own dept) | — |
| View department Resources | — | ✅ (any dept) | ✅ (own dept) | ✅ (own dept, read-only) |
| View own Personal Folder | — | ✅ | ✅ | ✅ |
| View others' Personal Folders | — | ✅ (anyone) | ✅ (own dept) | — |

All of the above is enforced twice — the UI hides what a role shouldn't
see, and Postgres RLS policies independently block the underlying
read/write regardless of what the client sends.
