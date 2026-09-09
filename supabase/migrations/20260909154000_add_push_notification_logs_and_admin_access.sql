-- MIGRATION: ADD PUSH NOTIFICATION LOGS & ADMIN ACCESS
-- Enables admins to view active push subscribers and tracks delivery history

-- 1. Grant admin select access to push_subscriptions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'push_subscriptions' 
    AND policyname = 'Admins can view all push subscriptions'
  ) THEN
    CREATE POLICY "Admins can view all push subscriptions"
    ON public.push_subscriptions FOR SELECT TO authenticated
    USING ((SELECT public.is_admin()));
  END IF;
END $$;

-- 2. Create push_notification_logs table
CREATE TABLE IF NOT EXISTS public.push_notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  device_count INT DEFAULT 0,
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'delivered', -- 'delivered', 'failed', 'no_devices'
  error_details TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_notif_logs_user ON public.push_notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_push_notif_logs_created_at ON public.push_notification_logs(created_at DESC);

ALTER TABLE public.push_notification_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'push_notification_logs' 
    AND policyname = 'Admins can manage push notification logs'
  ) THEN
    CREATE POLICY "Admins can manage push notification logs"
    ON public.push_notification_logs FOR ALL TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));
  END IF;
END $$;

GRANT ALL ON public.push_notification_logs TO authenticated, service_role;
