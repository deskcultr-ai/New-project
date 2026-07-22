# Rollback Runbook

What to do when a deploy or migration goes bad. Two independent systems can
need a rollback — the Cloudflare Worker (app code) and the Supabase database
(schema/data) — and they roll back differently.

## 1. Rolling back the Worker (app code)

Cloudflare keeps a history of every deployment automatically; no extra setup
is required for this to work.

**See recent deployments and their version IDs:**

```
npx -p node@22 -c "node node_modules/wrangler/bin/wrangler.js deployments list"
```

This lists the 10 most recent deployments with their version IDs and
timestamps.

**Roll back to a specific version:**

```
npx -p node@22 -c "node node_modules/wrangler/bin/wrangler.js rollback <version-id> -m \"reason for rollback\""
```

Omit `<version-id>` and Wrangler rolls back to the previous deployment.
The `-m` message is recorded against the rollback — always fill it in with
what broke, since it's the only record of why an emergency revert happened.

**After a rollback:**

- Confirm the site is actually serving the old version (hard-refresh
  `https://deskculture.deskcultr.workers.dev`, check a recently-changed page).
- If the rollback was caused by a schema-incompatible deploy (the new code
  expected a DB change the old code doesn't know about, or vice versa), also
  check whether the database needs to be addressed — see below. Rolling back
  code while a since-applied migration is still live can itself cause errors
  if the old code queries columns the migration removed/renamed.

## 2. Rolling back the database (Supabase / Postgres)

There is no `supabase migration rollback` — migrations are forward-only SQL.
"Rolling back" a bad migration means writing and applying a **new** migration
that undoes it, not un-applying the old one. This project's established
pattern (used throughout its migration history):

1. Write a new migration file that reverses the change (drop the column/
   trigger/policy the bad migration added, or restore the previous version
   of a function via `create or replace`).
2. `npx supabase db push` to apply it (the Supabase CLI isn't a project
   dependency — `npx` fetches it on demand, same as it's been used
   throughout this project's migration history).
3. If the bad migration was pushed only minutes ago and has caused no real
   data to be written under the new shape yet, it's acceptable to instead
   delete the bad migration file and run
   `supabase migration repair --status reverted <version>` to keep local
   files and the remote `supabase_migrations` tracking table in sync — but
   **only** if you're certain no data depends on it yet. Once real data
   exists under a new column/table, always write a forward-fixing migration
   instead of deleting history.

**Point-in-time recovery**: not available today — the project is on
Supabase's Free tier, which does not include PITR. This is the single
biggest gap in this section: a bad migration that destroys data (not just
breaks a query) currently has no automated undo. This is flagged as a
Phase 1 blocker (upgrade to Supabase Pro before any external org's data is
at risk) in the production readiness audit — until then, be conservative
with destructive migrations (drops, `on delete cascade` changes) and prefer
additive, reversible changes.

## 3. Pre-deploy checklist

- [ ] `npm run lint` and `npm run build` pass locally (CI now gates this on
      every push/PR to `main` — see `.github/workflows/ci.yml`).
- [ ] Any new migration has been tested against a real Supabase project
      first, not written blind.
- [ ] You know what the previous deployment's version ID is (run
      `deployments list` *before* deploying, not after something breaks).

## 4. Post-deploy checklist

- [ ] Load the deployed URL and confirm the page you changed actually
      reflects the change (chunk hashes change on every deploy — a stale
      browser cache can otherwise make you think a deploy failed when it
      didn't, or succeeded when it didn't).
- [ ] Spot-check one write path end-to-end (create a task, send a message —
      whatever touches the area you changed) with a real or throwaway
      account.
- [ ] If anything looks wrong, don't debug in production — roll back first
      (step 1), then investigate calmly.
