-- DeskCulture: Fix admin chat RLS — admins should see ALL department channels
-- (not only their own dept). Employees still only see their own dept.

-- ============================================================
-- Step 1: Update can_access_conversation() helper
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_conversation(target_conversation_id uuid)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = target_conversation_id
      AND c.organization_id = public.current_org_id()
      AND (
        c.type = 'announcement'
        OR (
          c.type = 'department_channel'
          AND (
            public.current_role() IN ('super_admin', 'admin')
            OR c.department_id = public.current_department_id()
          )
        )
        OR (c.type = 'dm' AND auth.uid() IN (c.dm_profile_a, c.dm_profile_b))
      )
  );
$$;

-- ============================================================
-- Step 2: Update the conversations SELECT policy
-- ============================================================

DROP POLICY IF EXISTS "org members can read conversations they belong to" ON public.conversations;

CREATE POLICY "org members can read conversations they belong to"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (
      type = 'announcement'
      OR (
        type = 'department_channel'
        AND (
          public.current_role() IN ('super_admin', 'admin')
          OR department_id = public.current_department_id()
        )
      )
      OR (type = 'dm' AND auth.uid() IN (dm_profile_a, dm_profile_b))
    )
  );
