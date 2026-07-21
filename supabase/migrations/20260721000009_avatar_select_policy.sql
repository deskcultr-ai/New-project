-- DeskCulture: add the missing SELECT policy for the avatars bucket.
--
-- Root cause of the persisting upload/delete failure: the avatars bucket
-- being "public" only bypasses RLS for the anonymous /object/public/...
-- URL route. Storage's own server-side mutation handlers (upsert's
-- exists-check, and delete's pre-select of what it's about to remove)
-- still go through the normal authenticated, RLS-gated path -- and with
-- no SELECT policy at all on this bucket, that internal check always saw
-- zero rows, so upsert never found the "existing" row to update (and its
-- insert-path check apparently also depends on this) and delete silently
-- matched nothing to remove.

create policy "avatar owner can read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and public.is_own_avatar_path(name));
