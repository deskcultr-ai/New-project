# DeskCulture — Role Workflows & UI Flow

This documents what each role can actually do in the product: every screen,
every button, and what happens underneath when it's clicked. For how
accounts/emails/login work mechanically, see [AUTH_WORKFLOW.md](./AUTH_WORKFLOW.md) —
this file is about *what you can do once you're in*.

## The five roles

| Role | Scope | Lands on | Tied to an org? |
|---|---|---|---|
| **Platform Owner** | Whole platform | `/platform-admin/requests` | No — allowlist-gated (`PLATFORM_OWNER_EMAILS`), not a `profiles` row |
| **Organization Super Admin** | Whole organization | `/admin` | Yes — one per org, `organizations.org_super_admin_id` |
| **Team Leader** | One department | `/admin` | Yes — `profiles.department_id` |
| **Manager** | One department (narrower than Team Leader) | `/admin` | Yes — `profiles.department_id` |
| **Executive** | Themself | `/dashboard` | Yes — `profiles.department_id` |

```
Organization Super Admin
        v
   Team Leader
        v
     Manager
        v
    Executive
```

There is exactly **one Organization Super Admin per organization** (the
person whose org request got approved). Everyone else in that org is a Team
Leader, a Manager, or an Executive, all scoped to one department. A Team
Leader is the department's head — they can invite both Managers and
Executives into it, and their task authority spans the whole org (see §4). A
Manager has the same day-to-day task authority as a Team Leader but confined
to their own department, plus the ability to invite Executives into it (see
§5). Enforcement is not just "hide the button" — every table (`tasks`,
`messages`, `profiles`, storage objects, etc.) has Postgres Row Level
Security that independently blocks cross-department/cross-org reads and
writes, so this holds even if someone calls the API directly.

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
    `invite_role: "org_super_admin"` and the new `organization_id` attached
    as metadata. A database trigger creates their `profiles` row (status
    `active`) immediately — before they've even opened the email — and
    claims `organizations.org_super_admin_id`. An email goes out with a
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

## 3. Organization Super Admin (Org Owner)

Lands on `/admin` after signing in. Left nav: **Overview · Departments &
People · Tasks · Messages · Drive · Settings**.

### `/admin` — Overview
Org-wide dashboard: department count, and a task-status breakdown (To Do /
In Progress / In Review / Done) across the **entire organization**.

### `/admin/people` — Departments & People
This is the org's structural control panel. Three sections:

- **Departments** — a text field + "Add department" button. Departments
  are flat (org-wide), created only by the Organization Super Admin.
- **Invite Team Leaders** — email field + department dropdown + "Send
  invite" button. This is how you populate departments: invite someone as
  the **Team Leader** of a specific department. Behind the scenes: `POST
  /api/invites` → `admin.inviteUserByEmail()` with `invite_role:
  "team_leader"` and the chosen `department_id` → their account + active
  profile exist immediately, invite email sent.
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
- **Assign to** — any **Team Leader, Manager, or Executive** in the org
  (Organization Super Admin can assign across every department, not just
  one)

Clicking any task card opens `/tasks/[id]` (shared detail page, see
§7 below) where you have full edit rights: status, blocked flag, priority,
and reassignment, plus comments and attachments.

### `/admin/settings` — Settings (Organization Super Admin only — Team
Leaders and Managers get redirected out)
- **Storage usage**: total bytes and file count used across the whole
  org's task attachments, chat files, department resources, and personal
  folders (`org_storage_usage()` RPC).

### Messages & Drive
Same as described in §7/§8 below, but with org-wide visibility: every
department channel, every teammate's personal folder, every department's
resource library.

---

## 4. Team Leader (Department head)

Also lands on `/admin`, same nav minus **Settings**, and every page is
automatically scoped to their own department only for *writes* — this
isn't a separate codebase, it's the same pages as the Organization Super
Admin's with narrower data (enforced by RLS, not just hidden UI). Task
*reads* stay org-wide, a deliberate widening so a Team Leader can see how
their department's work compares to the rest of the org.

### `/admin` — Overview
Same layout as the Organization Super Admin's, showing org-wide task/people
counts.

### `/admin/people` — Team
- No "Departments" section (Team Leaders can't create departments).
- **Invite a Manager or Executive** — email field + a role selector (no
  department picker — inviting is locked to their own department).
  "Emails a link to join \<Department Name\> as a Manager/Executive."
  Behind the scenes this calls the same `POST /api/invites`, but the API
  enforces `invite_role` to be `"manager"` or `"executive"` for a Team
  Leader, and forces the department to the caller's own — a Team Leader
  cannot invite into another department even by editing the request.
- **Your team** — only people in their own department.

### `/admin/tasks` — Tasks (org-wide board)
Same Kanban board and "New task" form, except:
- **Department** field can be any department in the org (Team Leaders can
  file/reassign tasks cross-department, same widening the Organization
  Super Admin has).
- **Assign to** lists **Managers and Executives** (not other Team Leaders,
  not the Organization Super Admin).

A Team Leader can edit any task in the org the same way an Organization
Super Admin can (status, priority, blocked flag, reassignment) —
`canEditFully` in the task detail page is true for Organization Super
Admin, Team Leader, and Manager alike. Deleting a task, however, stays
scoped to the Team Leader's own department.

### Drive & Messages
Resources/personal-folder oversight and department-channel visibility stay
org-wide for reading (any department's resources, any department's
channel), but *writing* department resources is scoped to the Team
Leader's own department. See §8/§9.

---

## 5. Manager (new — department task lead)

Lands on `/admin` as well, same routes as Team Leader
(`/admin`, `/admin/tasks`, `/admin/people`, `/admin/departments/[id]`), but
every one of them is narrowed to the Manager's **own department only** —
Manager never sees or touches another department, unlike a Team Leader.
Manager exists to give a Team Leader a lieutenant who can run day-to-day
task assignment for the department without handing over full department
administration.

### `/admin` — Overview
Same layout, but every stat (departments, people, tasks) is filtered down
to the Manager's own department instead of the whole org.

### `/admin/people` — Team
- Departments section shows only their own department card (no "Add
  department", no delete button).
- **Invite an Executive** — email field only, locked to their own
  department. Managers cannot invite another Manager, a Team Leader, or
  anyone outside their department.
- **Your team** — only people in their own department.

### `/admin/tasks` — Tasks (department board)
Same Kanban board and "New task" form as Team Leader, except:
- **Department** field is fixed/read-only to their own department — a
  Manager can't file a task anywhere else.
- **Assign to** lists **Executives in their department only**.
- A Manager can edit any task in their own department in full (status,
  priority, blocked flag, reassignment) — `canEditFully` is true for
  Manager — but **cannot delete tasks** (delete stays Team Leader/
  Organization Super Admin only) and cannot see or touch tasks in other
  departments.
- Manager can also review pending **task-forward requests** (§7) from
  Executives in their own department, same as a Team Leader can.

### Drive & Messages
- Department Resources: **read-only** — Manager can view but not upload/
  delete department resources (that stays Team Leader/Organization Super
  Admin).
- No "Team personal folders" oversight section — Manager cannot browse
  anyone else's personal folder, including Executives in their own
  department.
- Department channel: sees and posts to their own department's channel
  only (not every department's channel, unlike Team Leader). Reads (but
  can't post to) Announcements, same as everyone.

---

## 6. Executive (individual contributor)

Lands on `/dashboard` — deliberately the simplest screen in the app. Left
nav: **My Tasks · Messages · Drive** (no admin section at all).

### `/dashboard` — My Tasks
A flat list of only the tasks **assigned to them**, sorted by due date
then priority. Each card shows title, description preview, Blocked badge
if applicable, status, priority, and due date. Clicking one opens
`/tasks/[id]`.

### `/tasks/[id]` (as an Executive)
Can:
- Change **Status** (To Do → In Progress → In Review → Done)
- Toggle **Blocked**
- Add **comments**
- **Upload attachments** (re-uploading the same filename keeps the older
  version instead of overwriting it — see the version history under each
  attachment)

Cannot:
- Change priority or reassign the task — those fields are hidden entirely
  (`canEditFully` is false for `executive`).

### Drive
- Their own **Personal Folder** only (private working space).
- Their **department's** resource library — read-only (`canWriteResources`
  gates the "+ Upload" button on the department Drive page, and is only
  ever true for Team Leader/Organization Super Admin).
- No visibility into anyone else's personal folder, and no "Team personal
  folders" section at all (that section only renders for Organization
  Super Admin and Team Leader).

### Messages
Full access to send/receive — DMs, their department channel, and reading
(but not posting to) Announcements.

---

## 7. Task assignment flow, end to end

```
Org Super Admin              Team Leader                Manager                Executive
────────────────             ───────────                ───────                ─────────
Creates task in ANY           Creates task in ANY         Creates task in
department, assigns to        department, assigns to      THEIR department
any Team Leader, Manager,     any Manager or Executive     only, assigns to
or Executive in the org       in the org                   any Executive in
        │                            │                     that department
        │                            │                            │
        └──────────────┬─────────────┴──────────────┬─────────────┘
                        ▼                             ▼
              tasks row created
              (department_id, assigned_to,
               created_by, priority, due_date)
                        │
                        ▼
              Assignee sees it:
              - Executive → /dashboard "My Tasks"
              - Manager/Team Leader/Org Super Admin → their /admin/tasks board
                        │
                        ▼
              Assignee opens /tasks/[id]:
              - updates Status / Blocked (everyone)
              - Manager/Team Leader/Org Super Admin can also change
                Priority and reassign
              - anyone with access can comment
                and upload attachments
```

Practical notes:
- **Reassignment** is only available to Manager/Team Leader/Organization
  Super Admin — an Executive can't hand a task to someone else, only
  update its status (they can *request* a reassignment instead, below).
- **Who can see a task at all** is enforced by RLS
  (`can_access_task()`/`can_view_task()`): Organization Super Admin and
  Team Leader see every task in the org; Manager sees tasks in their own
  department; Executive sees only tasks assigned to them (plus ones they
  created, if applicable).
- **Requesting reassignment**: an Executive assigned to a task can request
  it be forwarded to someone else, with a reason, from the task detail
  page. Any Manager, Team Leader, or Organization Super Admin with access
  to that task can Approve (reassigns it and notifies both people) or
  Reject (with an optional note) from the "Reassignment Requests" panel on
  `/admin/tasks`. A Manager only sees/approves requests for tasks in their
  own department.
- **Cross-linking into chat**: typing `#` in any message composer
  autocompletes task titles and drops in a live task chip — clicking it
  jumps straight to `/tasks/[id]`. This works for any task the poster has
  access to.
- There is currently **no automatic notification** when a task is
  assigned or reassigned other than the bell-icon notification fired by
  the `notify_task_assignment()` trigger.

---

## 8. Communication layer

`/messages` — three kinds of conversations, all real-time (Supabase
Realtime subscriptions, not polling):

- **Announcements** — one per org, auto-created when the org is created.
  Everyone in the org can read it; **only the Organization Super Admin can
  post** (`canPost` check — Team Leaders/Managers/Executives see "Only the
  Organization Super Admin can post to Announcements" instead of a
  composer).
- **Department channel** — one per department, auto-created when the
  department is created. Organization Super Admin and Team Leader see
  **every** department's channel (an org-wide read widening); Manager and
  Executive only see their own department's channel. Everyone in a
  department can read/post to it.
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

The **notification bell** (top-right of every page) shows the most recent
notifications from the last two hours, a red count badge for unread ones,
and live-updates via Realtime as new ones arrive. Clicking one marks it
read and navigates to its `link` (a task or a conversation).

---

## 9. Org Drive

`/drive` — files organized to mirror the org chart automatically, no
manual folder creation:

- **Departments** grid — Organization Super Admin sees all; Team Leader,
  Manager, and Executive see only their own. Clicking one opens
  `/drive/departments/[id]`:
  - **Resources** — department-level shared files (SOPs, templates).
    Upload button only shown if `canWriteResources` (Organization Super
    Admin, or the Team Leader of *that specific* department — Manager gets
    read access here but not the upload button).
  - **Task folders** — every task in that department, expandable to show
    its attachments (same files as on the task detail page) with an "Open
    task" shortcut.
- **My Personal Folder** — always visible, private working space, only
  the owner and department/org admins (Team Leader of their dept, or
  Organization Super Admin) can see it — Manager does not get
  personal-folder oversight.
- **Team personal folders** — Organization Super Admin/Team Leader only; a
  grid of teammates' personal folders (Team Leader sees their
  department's people, Organization Super Admin sees everyone) they can
  open to view/manage.
- File preview: images/PDFs/text preview inline via a modal
  (`FilePreviewModal`); other types download via a signed URL.
- Re-uploading a file with the same name (in personal folders or resources)
  **overwrites** it there (`upsert: true`) — version history (keeping old
  versions) is specific to **task attachments** only, not Drive resources
  or personal files.

---

## 10. Authorization matrix

| Action | Platform Owner | Org Super Admin | Team Leader | Manager | Executive |
|---|:---:|:---:|:---:|:---:|:---:|
| Approve/reject org requests | ✅ | — | — | — | — |
| Create departments | — | ✅ | — | — | — |
| Invite a Team Leader | — | ✅ | — | — | — |
| Invite a Manager | — | ✅ (via Team Leader) | ✅ (own dept) | — | — |
| Invite an Executive | — | ✅ | ✅ (own dept) | ✅ (own dept) | — |
| View directory | — | ✅ org-wide | ✅ org-wide | ✅ own dept | ✅ own dept |
| Create a task | — | ✅ (any dept) | ✅ (any dept) | ✅ (own dept) | — |
| Assign / reassign a task | — | ✅ (anyone) | ✅ (Manager/Executive) | ✅ (Executives, own dept) | — |
| View tasks | — | ✅ org-wide | ✅ org-wide | ✅ own dept | own tasks only |
| Delete a task | — | ✅ | ✅ (own dept) | — | — |
| Change task status / blocked | — | ✅ | ✅ | ✅ | ✅ (own tasks) |
| Approve/reject forward requests | — | ✅ | ✅ (own dept) | ✅ (own dept) | — |
| Request task forward | — | — | — | — | ✅ |
| Comment / upload attachments on a task | — | ✅ | ✅ | ✅ | ✅ (tasks they can see) |
| Post to Announcements | — | ✅ | — | — | — |
| Post to a department channel | — | ✅ (any) | ✅ (any) | ✅ (own dept) | ✅ (own dept) |
| Send DMs | — | ✅ | ✅ | ✅ | ✅ |
| Upload department Resources | — | ✅ (any dept) | ✅ (own dept) | — | — |
| View department Resources | — | ✅ (any dept) | ✅ (any dept) | ✅ (own dept) | ✅ (own dept, read-only) |
| View own Personal Folder | — | ✅ | ✅ | ✅ | ✅ |
| View others' Personal Folders | — | ✅ (anyone) | ✅ (own dept) | — | — |
| Storage usage / Settings | — | ✅ | — | — | — |

All of the above is enforced twice — the UI hides what a role shouldn't
see, and Postgres RLS policies independently block the underlying
read/write regardless of what the client sends.
