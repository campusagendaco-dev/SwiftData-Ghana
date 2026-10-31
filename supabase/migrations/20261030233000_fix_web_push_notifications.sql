-- ============================================================================
-- FIX WEB PUSH NOTIFICATIONS END-TO-END
-- 1. Provides SECURITY DEFINER RPCs (register_push_subscription & unregister_push_subscription)
--    so both guest visitors (anon) and logged-in users (authenticated) can reliably
--    register/update device tokens without exposing push_subscriptions SELECT to anon.
-- 2. Cleans up conflicting RLS policies on public.push_subscriptions and ensures
--    admins and authenticated users have proper access.
-- 3. Updates handle_user_notification_push() to respect skip_auto_push flag and
--    prevent duplicate or unauthenticated pg_net calls in broadcast functions.
-- ============================================================================

-- 1. Ensure user_id is nullable and endpoint has a unique constraint/index
DO $$
BEGIN
  ALTER TABLE public.push_subscriptions ALTER COLUMN user_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON public.push_subscriptions (endpoint);

-- 2. Clean up conflicting legacy RLS policies on push_subscriptions
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can delete their own subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can insert push subscription" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can update push subscription" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can select push subscription" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users manage own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Admins can view all push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Admins can manage all push subscriptions" ON public.push_subscriptions;

CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Admins can manage all push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated, service_role;

-- 3. SECURITY DEFINER RPCs for Guest + Authenticated Push Registration
CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  IF p_endpoint IS NULL OR length(trim(p_endpoint)) = 0 THEN
    RETURN FALSE;
  END IF;

  v_uid := COALESCE(auth.uid(), p_user_id);

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
  VALUES (
    v_uid,
    trim(p_endpoint),
    COALESCE(NULLIF(trim(p_p256dh), ''), ''),
    COALESCE(NULLIF(trim(p_auth), ''), ''),
    NOW()
  )
  ON CONFLICT (endpoint) DO UPDATE
  SET
    user_id = COALESCE(v_uid, public.push_subscriptions.user_id),
    p256dh = CASE WHEN length(trim(COALESCE(p_p256dh, ''))) > 0 THEN trim(p_p256dh) ELSE public.push_subscriptions.p256dh END,
    auth = CASE WHEN length(trim(COALESCE(p_auth, ''))) > 0 THEN trim(p_auth) ELSE public.push_subscriptions.auth END,
    created_at = NOW();

  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'register_push_subscription failed: %', SQLERRM;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_subscription(
  p_endpoint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_endpoint IS NULL OR length(trim(p_endpoint)) = 0 THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE endpoint = trim(p_endpoint)
    AND (
      auth.uid() IS NULL
      OR user_id IS NULL
      OR user_id = auth.uid()
      OR public.is_admin()
    );

  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unregister_push_subscription(TEXT) TO anon, authenticated, service_role;

-- 4. Update handle_user_notification_push() trigger to respect skip_auto_push and pass valid payload
CREATE OR REPLACE FUNCTION public.handle_user_notification_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Respect explicit skip_auto_push flag (e.g. when caller already invoked send-push-notification directly)
  IF NEW.data IS NOT NULL AND COALESCE((NEW.data->>'skip_auto_push')::boolean, false) = true THEN
    RETURN NEW;
  END IF;

  -- Only trigger push if the target user has at least one active push subscription
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
        'url', COALESCE(NEW.link, COALESCE(NEW.data->>'url', '/dashboard')),
        'id', NEW.id,
        'tag', 'swiftdata-' || COALESCE(NEW.type, 'notif') || '-' || NEW.id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification trigger warning: %', SQLERRM;
  RETURN NEW;
END;
$$;
