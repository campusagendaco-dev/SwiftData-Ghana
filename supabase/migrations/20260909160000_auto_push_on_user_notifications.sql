-- ==============================================================================
-- AUTOMATIC REAL-TIME WEB PUSH ON USER NOTIFICATIONS
-- Dispatches native lock-screen push notifications whenever an event or alert
-- is logged to public.user_notifications (orders, wallet top-ups, referral bonuses, etc.)
-- ==============================================================================

-- 1. Ensure user_id can be nullable on push_subscriptions to allow guest/PWA registrations
DO $$
BEGIN
  ALTER TABLE public.push_subscriptions ALTER COLUMN user_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint 
  ON public.push_subscriptions (endpoint);

-- 2. Trigger function to dispatch web push via pg_net
CREATE OR REPLACE FUNCTION public.handle_user_notification_push()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
AS $$
BEGIN
  -- Only trigger push if the target user actually has active push subscriptions registered
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.push_subscriptions WHERE user_id = NEW.user_id
  ) THEN
    PERFORM net.http_post(
      url     := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body    := jsonb_build_object(
        'user_id', NEW.user_id,
        'title', COALESCE(NEW.title, 'SwiftData Ghana'),
        'body', COALESCE(NEW.message, 'You have a new transaction update.'),
        'url', COALESCE(NEW.link, '/dashboard'),
        'id', NEW.id,
        'tag', 'swiftdata-' || COALESCE(NEW.type, 'notif') || '-' || NEW.id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Safeguard: Network glitches must never fail the underlying database transaction
  RAISE WARNING 'Push notification trigger warning: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 3. Attach trigger to public.user_notifications
DROP TRIGGER IF EXISTS trg_user_notification_push ON public.user_notifications;

CREATE TRIGGER trg_user_notification_push
  AFTER INSERT ON public.user_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_notification_push();

-- 4. Enable RLS policy so users can register subscriptions even if guest or freshly logged in
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'push_subscriptions' 
    AND policyname = 'Anyone can insert push subscription'
  ) THEN
    CREATE POLICY "Anyone can insert push subscription"
    ON public.push_subscriptions FOR INSERT
    WITH CHECK (true);
  END IF;
END $$;
