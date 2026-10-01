-- ==============================================================================
-- SYSTEM UPGRADE & INSTANT REFUND BROADCAST
-- 1. Adds template to sms_templates
-- 2. Creates dispatch_system_upgrade_broadcast RPC for in-app & push delivery
-- 3. Queues the SMS & Push broadcast in scheduled_broadcasts for automatic processing
-- ==============================================================================

-- 1. Insert / Update the SMS Template
INSERT INTO public.sms_templates (key, label, body, is_active)
VALUES (
  'system_upgrade_speed_refunds',
  '⚡ System Upgrade: Fast Delivery & Instant Refunds',
  'SwiftData Update: Enjoy ultra-fast data delivery, 100% guarantee & our new instant MoMo refund system! Your satisfaction is secured. Order at swiftdatagh.shop',
  true
)
ON CONFLICT (key) DO UPDATE
SET 
  label = EXCLUDED.label,
  body = EXCLUDED.body,
  is_active = true,
  updated_at = NOW();

-- 2. Dispatch In-App & Push Notification Broadcast RPC
CREATE OR REPLACE FUNCTION public.dispatch_system_upgrade_broadcast(
  p_title TEXT DEFAULT '🚀 System Upgrade: Faster Deliveries & Instant MoMo Refunds!',
  p_body TEXT DEFAULT 'We have upgraded our carrier engine for rock-solid speed, live tracking, and an automated instant Mobile Money refund system! Your orders are 100% guaranteed.',
  p_link TEXT DEFAULT '/dashboard/buy-data',
  p_limit INT DEFAULT 1500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_ids UUID[];
  v_count INT := 0;
BEGIN
  -- Fetch registered active users & storefront agents
  SELECT ARRAY_AGG(user_id) INTO v_user_ids
  FROM (
    SELECT user_id 
    FROM public.profiles 
    WHERE user_id IS NOT NULL 
    ORDER BY created_at DESC 
    LIMIT p_limit
  ) sub;

  IF v_user_ids IS NULL OR ARRAY_LENGTH(v_user_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'targeted_users', 0,
      'message', 'No registered users found.'
    );
  END IF;

  v_count := ARRAY_LENGTH(v_user_ids, 1);

  -- Insert in-app notifications (trg_user_notification_push will trigger native push for users with push subscriptions)
  INSERT INTO public.user_notifications (user_id, title, message, type, link, data)
  SELECT 
    uid,
    p_title,
    p_body,
    'announcement',
    p_link,
    '{"broadcast": true, "campaign": "system_upgrade_speed_refunds"}'::jsonb
  FROM UNNEST(v_user_ids) AS uid;

  RETURN jsonb_build_object(
    'success', true,
    'targeted_users', v_count,
    'title', p_title,
    'message', 'Broadcast posted to user notifications successfully.'
  );
END;
$$;

-- 3. Execute in-app notification broadcast immediately for registered users
SELECT public.dispatch_system_upgrade_broadcast();

-- 4. Queue the SMS broadcast in scheduled_broadcasts
INSERT INTO public.scheduled_broadcasts (
  title,
  message,
  target_type,
  target_filters,
  scheduled_at,
  status
)
VALUES (
  '🚀 System Upgrade: Speed & Instant Refunds',
  'SwiftData Update: Enjoy ultra-fast data delivery, 100% guarantee & our new instant MoMo refund system! Your satisfaction is secured. Order at swiftdatagh.shop',
  'agents',
  '{"send_sms": true, "send_push": true, "sender_id": "SwiftData"}'::jsonb,
  NOW(),
  'pending'
);
