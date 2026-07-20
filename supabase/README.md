# DeskCulture — database

This project reuses the existing Supabase project (`afsksxyryvxjaftblufv`,
"deskcultr-ai's Project") from the previous `DeskCultre-main` build. That
project's old schema and migration history were removed — `migrations/` here
starts empty and will get a fresh, self-contained baseline as the app is
rebuilt.

## One-time: wiping the old schema

`reset-live-db.sql` drops everything the old app created in `public`
(tables, functions, triggers, types) so the project is a blank slate before
new migrations are applied. It is **irreversible** and needs credentials
this assistant doesn't have access to, so run it yourself:

1. Open the Supabase Dashboard for the project -> SQL Editor.
2. Paste the contents of `reset-live-db.sql` and run it.

`auth.users` (real invited accounts) is untouched by that script.

## Applying new migrations once they exist

```bash
npx supabase login                                  # opens a browser, stores a token
npx supabase link --project-ref afsksxyryvxjaftblufv # prompts for the DB password
npx supabase db push                                 # applies migrations/
```
