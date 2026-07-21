-- DeskCulture: drop the org-drive-based avatar storage policies from
-- profile_settings.sql. Avatars moved to a dedicated public "avatars"
-- bucket (avatars_bucket_and_username.sql) because org-drive is private
-- and getPublicUrl() against it produced dead links -- no app code has
-- written to the {org_id}/avatars/{profile_id}/... path on org-drive
-- since. These four policies are unreachable dead weight.

drop policy if exists "avatar read" on storage.objects;
drop policy if exists "avatar upload" on storage.objects;
drop policy if exists "avatar update" on storage.objects;
drop policy if exists "avatar delete" on storage.objects;
