-- DeskCulture: Task Forward Requests + notification_type update
-- Employees can request reassignment of their task. Admin approves/rejects.

-- ============================================================
-- Step 1: Add task_forward to notification_type enum
-- ============================================================

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'task_forward';

-- ============================================================
-- Step 2: task_forward_requests table
-- ============================================================

CREATE TABLE public.task_forward_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  requested_by   UUID NOT NULL REFERENCES public.profiles(id),
  forward_to     UUID NOT NULL REFERENCES public.profiles(id),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CONSTRAINT task_forward_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by    UUID REFERENCES public.profiles(id),
  rejection_note TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX task_forward_requests_task_id_idx       ON public.task_forward_requests (task_id);
CREATE INDEX task_forward_requests_requested_by_idx  ON public.task_forward_requests (requested_by);
CREATE INDEX task_forward_requests_forward_to_idx    ON public.task_forward_requests (forward_to);
CREATE INDEX task_forward_requests_status_idx        ON public.task_forward_requests (status) WHERE status = 'pending';

-- ============================================================
-- Step 3: RLS
-- ============================================================

ALTER TABLE public.task_forward_requests ENABLE ROW LEVEL SECURITY;

-- Employees can insert a request only for tasks currently assigned to them
CREATE POLICY "employee can request forward of own task"
  ON public.task_forward_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND public.current_role() = 'employee'
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND t.assigned_to = auth.uid()
        AND t.organization_id = public.current_org_id()
    )
  );

-- Employees can see their own requests
CREATE POLICY "employee can read own forward requests"
  ON public.task_forward_requests FOR SELECT
  TO authenticated
  USING (
    requested_by = auth.uid()
    OR forward_to = auth.uid()
  );

-- Admins can read pending requests for tasks in their department
CREATE POLICY "admin reads dept forward requests"
  ON public.task_forward_requests FOR SELECT
  TO authenticated
  USING (
    public.current_role() IN ('admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND t.organization_id = public.current_org_id()
        AND (
          public.current_role() = 'super_admin'
          OR t.department_id = public.current_department_id()
        )
    )
  );

-- Only admins/super_admins can update (approve/reject)
CREATE POLICY "admin can update forward requests"
  ON public.task_forward_requests FOR UPDATE
  TO authenticated
  USING (
    public.current_role() IN ('admin', 'super_admin')
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_id
        AND t.organization_id = public.current_org_id()
        AND (
          public.current_role() = 'super_admin'
          OR t.department_id = public.current_department_id()
        )
    )
  )
  WITH CHECK (
    reviewed_by = auth.uid()
  );

-- ============================================================
-- Step 4: Trigger — when a request is approved, reassign the task
-- and notify both the original employee and the new assignee.
-- ============================================================

CREATE OR REPLACE FUNCTION public.on_forward_request_resolved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_row       public.tasks;
  requester_name TEXT;
  new_name       TEXT;
  reviewer_name  TEXT;
BEGIN
  -- Only act on status transitions TO approved or rejected
  IF new.status = old.status THEN
    RETURN new;
  END IF;

  SELECT * INTO task_row FROM public.tasks WHERE id = new.task_id;
  SELECT COALESCE(username, full_name, email) INTO requester_name FROM public.profiles WHERE id = new.requested_by;
  SELECT COALESCE(username, full_name, email) INTO new_name       FROM public.profiles WHERE id = new.forward_to;
  SELECT COALESCE(username, full_name, email) INTO reviewer_name  FROM public.profiles WHERE id = new.reviewed_by;

  IF new.status = 'approved' THEN
    -- Reassign the task (bypass employee guard: runs as SECURITY DEFINER)
    UPDATE public.tasks SET assigned_to = new.forward_to WHERE id = new.task_id;

    -- Notify the original employee: their request was accepted
    INSERT INTO public.notifications (profile_id, type, title, body, link)
    VALUES (
      new.requested_by,
      'task_forward',
      '✅ Reassignment approved',
      'Your task "' || left(task_row.title, 80) || '" has been forwarded to ' || COALESCE(new_name, 'another user') || '.',
      '/tasks/' || new.task_id
    );

    -- Notify the new assignee
    INSERT INTO public.notifications (profile_id, type, title, body, link)
    VALUES (
      new.forward_to,
      'task_forward',
      '📋 New task assigned to you',
      COALESCE(requester_name, 'Someone') || ' forwarded the task "' || left(task_row.title, 80) || '" to you.',
      '/tasks/' || new.task_id
    );

  ELSIF new.status = 'rejected' THEN
    -- Notify the original employee: their request was rejected
    INSERT INTO public.notifications (profile_id, type, title, body, link)
    VALUES (
      new.requested_by,
      'task_forward',
      '❌ Reassignment request rejected',
      'Your request to forward "' || left(task_row.title, 80) || '" was rejected.' ||
      CASE WHEN new.rejection_note IS NOT NULL THEN ' Reason: ' || new.rejection_note ELSE '' END,
      '/tasks/' || new.task_id
    );
  END IF;

  RETURN new;
END;
$$;

CREATE TRIGGER task_forward_requests_resolved
  AFTER UPDATE OF status ON public.task_forward_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.on_forward_request_resolved();

-- Enable realtime for forward requests so admin panel updates live
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_forward_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
