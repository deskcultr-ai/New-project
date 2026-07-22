# Staging Environment

DeskCulture now has two Supabase projects: production (serves the real,
deployed app) and staging (everything else — local dev, migration testing,
live-testing new features with throwaway orgs/accounts).

| | Production | Staging |
|---|---|---|
| Project ref | `afsksxyryvxjaftblufv` | `orhhkircshrezlxntkzl` |
| URL | `https://afsksxyryvxjaftblufv.supabase.co` | `https://orhhkircshrezlxntkzl.supabase.co` |
| Used by | The deployed Cloudflare Worker — configured in `wrangler.jsonc`'s `vars` (public) and via `wrangler secret put` (service role key) | Local dev (`npm run dev`) and all manual/live testing — configured in `.env.local` |
| Schema source | `supabase/migrations/` | Same migrations, applied separately |

**The two databases are not automatically kept in sync.** Every migration
that gets pushed to production should be pushed to staging too (ideally
staging first). There's no CI automation for this yet — it's a manual step,
same as production pushes have always been.

## Applying migrations to staging

```
supabase db push --db-url "postgresql://postgres:<STAGING_DB_PASSWORD>@db.orhhkircshrezlxntkzl.supabase.co:5432/postgres"
```

Using `--db-url` instead of `supabase link` deliberately avoids ever
re-pointing the CLI's linked project away from production — the local
`supabase/.temp/project-ref` stays on `afsksxyryvxjaftblufv` at all times,
so a bare `supabase db push` (no `--db-url`) still targets production as
before. This is intentional: it removes the "did I forget to switch back"
failure mode entirely.

The staging DB password is in the Supabase dashboard for the staging
project → Project Settings → Database → Database password (reset it there
if it's not on hand). Not stored in this repo.

## What still points at production

- `wrangler.jsonc` `vars` (public config baked into the deployed Worker).
- The `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` Cloudflare Worker
  secrets (`wrangler secret put ...`).
- Supabase Auth SMTP settings and email templates, configured in the
  **production** project's dashboard (Authentication → Emails). The
  staging project has its own, separate Auth config — invite/OTP emails
  sent while developing locally against staging will not go out via the
  same sender unless staging's SMTP is configured too (not done yet; today
  those emails just won't send, which is fine for schema/RLS testing but
  means auth-email-flow testing still needs to happen against production
  carefully, or staging's SMTP needs to be set up to mirror it).

## What now points at staging

- `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`)
  — so `npm run dev` and any local testing hits staging, not production.
