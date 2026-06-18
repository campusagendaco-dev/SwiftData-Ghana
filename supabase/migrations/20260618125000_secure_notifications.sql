-- ══════════════════════════════════════════════════════════════
-- SECURITY PATCH: Prevent Cross-User Data Leaks in Notifications
-- Date: 2026-06-18
-- ══════════════════════════════════════════════════════════════

-- Drop the overly permissive "USING (true)" policy that allowed 
-- any authenticated user to read all notifications.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'notifications' 
      AND policyname = 'Anyone can view notifications'
  ) THEN
    DROP POLICY "Anyone can view notifications" ON public.notifications;
  END IF;
END $$;

-- Create a precise policy: Users can only see global notifications 
-- or notifications specifically addressed to their user_id.
CREATE POLICY "Users view own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    target_type IN ('all', 'agents', 'users') 
    OR target_user_id = auth.uid()
  );
