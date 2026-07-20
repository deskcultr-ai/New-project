-- DeskCulture: Profile Settings
-- Adds username (unique, platform-wide), bio, and avatar_url columns to profiles.
-- Storage policies for avatar uploads are also added here.

-- ============================================================
-- Step 1: add columns to profiles
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username   TEXT,
  ADD COLUMN IF NOT EXISTS bio        TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Unique index on lowercased username so @john and @John can't both exist.
-- WHERE username IS NOT NULL so NULLs (users without a username) don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- Max bio length enforced at application level (280 chars), not DB level.

-- ============================================================
-- Step 2: storage policies for avatars
-- Path convention: {org_id}/avatars/{profile_id}/{filename}
-- Re-uses the existing org-drive bucket.
-- ============================================================

DO $$ BEGIN
  DROP POLICY IF EXISTS "avatar read"   ON storage.objects;
  DROP POLICY IF EXISTS "avatar upload" ON storage.objects;
  DROP POLICY IF EXISTS "avatar update" ON storage.objects;
  DROP POLICY IF EXISTS "avatar delete" ON storage.objects;
END $$;

CREATE POLICY "avatar read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'org-drive'
    AND (string_to_array(name, '/'))[2] = 'avatars'
    AND (string_to_array(name, '/'))[1] = public.current_org_id()::text
  );

CREATE POLICY "avatar upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'org-drive'
    AND (string_to_array(name, '/'))[2] = 'avatars'
    AND (string_to_array(name, '/'))[1] = public.current_org_id()::text
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
  );

CREATE POLICY "avatar update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'org-drive'
    AND (string_to_array(name, '/'))[2] = 'avatars'
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
  );

CREATE POLICY "avatar delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'org-drive'
    AND (string_to_array(name, '/'))[2] = 'avatars'
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
  );
