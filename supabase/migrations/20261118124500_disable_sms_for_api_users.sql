-- ============================================================================================
-- Disable automated SMS notifications for API users (`profiles.api_access_enabled = true`)
-- and API-channel orders (`order_type = 'api'` / `channel = 'api'` / `payment_method = 'api_wallet'`).
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.is_api_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL OR p_user_id = '00000000-0000-0000-0000-000000000000'::uuid THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = p_user_id
        AND api_access_enabled = true
    )
  END;
$$;

-- 1. Low API Wallet Balance Trigger: keep in-app notification, disable SMS dispatch
CREATE OR REPLACE FUNCTION public.handle_api_wallet_balance_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message TEXT;
BEGIN
  IF NEW.api_balance >= 100.00 AND COALESCE(OLD.api_balance, 0) < 100.00 THEN
     NEW.api_low_balance_alert_sent := false;
  END IF;

  IF NEW.api_balance < 100.00 AND COALESCE(OLD.api_balance, 9999) >= 100.00
     AND COALESCE(NEW.api_low_balance_alert_sent, false) = false THEN
     v_message := '⚠️ Low Balance Alert: Your API Wallet balance is currently GHS ' || ROUND(NEW.api_balance, 2) || '. Please top up soon to avoid service interruption.';

     INSERT INTO public.user_notifications (user_id, title, message, type, link)
     VALUES (NEW.agent_id, 'Low API Balance', v_message, 'warning', '/dashboard/api');

     NEW.api_low_balance_alert_sent := true;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. API Access Request Trigger: notify admins only (skip SMS to API applicant/user)
CREATE OR REPLACE FUNCTION public.handle_api_request_status_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_support_number TEXT;
  v_admin_phones TEXT;
  v_admin_message TEXT;
  v_admin_payload JSONB;
BEGIN
  IF NEW.api_request_status = 'pending' AND (OLD.api_request_status IS NULL OR OLD.api_request_status != 'pending') THEN
    SELECT
      txtconnect_api_key,
      txtconnect_sender_id,
      COALESCE(customer_service_number, '0540309637')
    INTO v_sms_api_key, v_sms_sender_id, v_support_number
    FROM public.v_system_settings_with_secrets
    WHERE id = 1;

    v_admin_message := 'Alert: User ' || COALESCE(NEW.full_name, 'Customer') || ' (' || COALESCE(NEW.phone, '') || ') has requested API access. Please review and approve.';

    IF v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
      WITH admin_phones AS (
        SELECT public.normalize_phone_sql(phone) AS ph
        FROM public.profiles p
        JOIN public.user_roles ur ON p.user_id = ur.user_id
        WHERE ur.role = 'admin' AND p.phone IS NOT NULL AND p.phone != ''
        UNION
        SELECT public.normalize_phone_sql(v_support_number) AS ph
      )
      SELECT COALESCE(string_agg(ph, ','), '') INTO v_admin_phones
      FROM admin_phones
      WHERE ph IS NOT NULL AND ph != '';

      IF v_admin_phones IS NOT NULL AND v_admin_phones != '' THEN
        v_admin_payload := jsonb_build_object(
          'to', v_admin_phones,
          'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
          'sms', v_admin_message,
          'unicode', '0'
        );

        PERFORM net.http_post(
          url     := 'https://api.txtconnect.net/dev/api/sms/send',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
          body    := v_admin_payload
        );

        INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
        SELECT
          val,
          COALESCE(v_sms_sender_id, 'Orderinfo'),
          v_admin_message,
          'custom',
          'success',
          NEW.user_id
        FROM regexp_split_to_table(v_admin_phones, ',') val;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Wallet Balance Credit Trigger: suppress SMS for API users
CREATE OR REPLACE FUNCTION public.handle_wallet_balance_credit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_is_api_user BOOLEAN := false;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
  v_amount NUMERIC(12, 2);
  v_current_event TEXT;
BEGIN
  BEGIN
    v_current_event := current_setting('app.current_event', true);
  EXCEPTION WHEN OTHERS THEN
    v_current_event := NULL;
  END;

  IF v_current_event = 'profit_credit' THEN
    PERFORM set_config('app.current_event', '', true);
    RETURN NEW;
  END IF;

  IF NEW.balance > OLD.balance THEN
    SELECT phone, COALESCE(api_access_enabled, false)
    INTO v_phone, v_is_api_user
    FROM public.profiles
    WHERE user_id = NEW.agent_id;

    IF v_is_api_user THEN
      RETURN NEW;
    END IF;

    v_amount := NEW.balance - OLD.balance;

    IF v_amount >= 0.01 THEN
      v_message := 'Wallet Credited: Your wallet has been credited with GH₵' || TO_CHAR(v_amount, 'FM999,999.00') || '. New balance is GH₵' || TO_CHAR(NEW.balance, 'FM999,999.00') || '. Thank you!';
      v_normalized_phone := public.normalize_phone_sql(v_phone);

      SELECT txtconnect_api_key, txtconnect_sender_id
      INTO v_sms_api_key, v_sms_sender_id
      FROM public.v_system_settings_with_secrets
      WHERE id = 1;

      IF v_normalized_phone IS NOT NULL AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
         v_payload := jsonb_build_object(
           'to', v_normalized_phone,
           'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
           'sms', v_message,
           'unicode', '0'
         );

         PERFORM net.http_post(
           url     := 'https://api.txtconnect.net/dev/api/sms/send',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
           body    := v_payload
         );

         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           COALESCE(v_sms_sender_id, 'Orderinfo'),
           v_message,
           'custom',
           'success',
           NEW.agent_id
         );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Order Failed Trigger: suppress SMS for API orders and API users
CREATE OR REPLACE FUNCTION public.handle_order_failed_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
  v_sms_agent_id UUID;
BEGIN
  IF NEW.status = 'fulfillment_failed' AND (OLD.status IS NULL OR OLD.status != 'fulfillment_failed') THEN
    IF LOWER(COALESCE(NEW.order_type, '')) = 'api'
       OR LOWER(COALESCE(NEW.channel, '')) = 'api'
       OR LOWER(COALESCE(NEW.payment_method, '')) = 'api_wallet'
       OR public.is_api_user(NEW.agent_id)
    THEN
      RETURN NEW;
    END IF;

    IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' THEN
      SELECT phone INTO v_phone FROM public.profiles WHERE user_id = NEW.agent_id;
    ELSE
      v_phone := NEW.customer_phone;
    END IF;

    v_normalized_phone := public.normalize_phone_sql(v_phone);

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      SELECT txtconnect_api_key, txtconnect_sender_id
      INTO v_sms_api_key, v_sms_sender_id
      FROM public.v_system_settings_with_secrets
      WHERE id = 1;

      v_message := 'Order Notice: Your purchase of ' || COALESCE(NEW.package_size, 'data') || ' for ' || COALESCE(NEW.customer_phone, '') || ' failed. Your wallet balance has been refunded. Try again: https://swiftdatagh.shop/dashboard';

      IF v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
         v_payload := jsonb_build_object(
           'to', v_normalized_phone,
           'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
           'sms', v_message,
           'unicode', '0'
         );

         PERFORM net.http_post(
           url     := 'https://api.txtconnect.net/dev/api/sms/send',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
           body    := v_payload
         );

         IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.agent_id) THEN
           v_sms_agent_id := NEW.agent_id;
         ELSE
           v_sms_agent_id := NULL;
         END IF;

         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           COALESCE(v_sms_sender_id, 'Orderinfo'),
           v_message,
           'custom',
           'success',
           v_sms_agent_id
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. New Unverified Beneficiary Order Trigger: suppress SMS for API orders and API users
CREATE OR REPLACE FUNCTION public.handle_new_beneficiary_order_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_whatsapp_link TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
  v_recipient_normalized TEXT;
  v_has_history BOOLEAN;
BEGIN
  IF NEW.metadata->>'bypass_beneficiary' = 'true' THEN
    IF LOWER(COALESCE(NEW.order_type, '')) = 'api'
       OR LOWER(COALESCE(NEW.channel, '')) = 'api'
       OR LOWER(COALESCE(NEW.payment_method, '')) = 'api_wallet'
       OR public.is_api_user(NEW.agent_id)
    THEN
      RETURN NEW;
    END IF;

    v_recipient_normalized := public.normalize_phone_sql(NEW.customer_phone);

    SELECT EXISTS (
      SELECT 1 FROM public.orders
      WHERE (customer_phone = NEW.customer_phone OR (v_recipient_normalized IS NOT NULL AND customer_phone = v_recipient_normalized))
      AND status IN ('fulfilled', 'completed')
      AND id != NEW.id
    ) INTO v_has_history;

    IF v_has_history THEN
      RETURN NEW;
    END IF;

    IF NEW.agent_id IS NOT NULL AND NEW.agent_id != '00000000-0000-0000-0000-000000000000' THEN
      SELECT phone INTO v_phone FROM public.profiles WHERE user_id = NEW.agent_id;
    ELSE
      v_phone := NEW.customer_phone;
    END IF;

    v_normalized_phone := public.normalize_phone_sql(v_phone);

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      SELECT
        txtconnect_api_key,
        COALESCE(support_channel_link, 'https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40')
      INTO v_sms_api_key, v_whatsapp_link
      FROM public.v_system_settings_with_secrets
      WHERE id = 1;

      v_message := 'Notice: Since you purchased for a new unverified beneficiary, delivery will take 24 to 72 hours. Join our WhatsApp channel for updates: ' || v_whatsapp_link;

      IF v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
         v_payload := jsonb_build_object(
           'to', v_normalized_phone,
           'from', 'SwiftDataGh',
           'sms', v_message,
           'unicode', '0'
         );

         PERFORM net.http_post(
           url     := 'https://api.txtconnect.net/dev/api/sms/send',
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
           body    := v_payload
         );

         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           'SwiftDataGh',
           v_message,
           'custom',
           'success',
           NEW.agent_id
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. MashUp Completed Trigger: suppress SMS for API orders and API users
CREATE OR REPLACE FUNCTION public.handle_mashup_order_completed_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
BEGIN
  IF (NEW.status = 'completed' OR NEW.status = 'fulfilled')
     AND (COALESCE(OLD.status, 'none') NOT IN ('completed', 'fulfilled'))
     AND NEW.network = 'MTN Mash Up' THEN

     IF LOWER(COALESCE(NEW.order_type, '')) = 'api'
        OR LOWER(COALESCE(NEW.channel, '')) = 'api'
        OR LOWER(COALESCE(NEW.payment_method, '')) = 'api_wallet'
        OR public.is_api_user(NEW.agent_id)
     THEN
       RETURN NEW;
     END IF;

     v_normalized_phone := public.normalize_phone_sql(NEW.customer_phone);

     SELECT txtconnect_api_key, txtconnect_sender_id
     INTO v_sms_api_key, v_sms_sender_id
     FROM public.v_system_settings_with_secrets
     WHERE id = 1;

     IF v_normalized_phone IS NOT NULL AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
        v_message := 'Your MTN Mash Up bundle of ' || NEW.package_size || ' has been successfully completed. Please check your balance for proof. Thank you for your business!';

        v_payload := jsonb_build_object(
          'to', v_normalized_phone,
          'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
          'sms', v_message,
          'unicode', '0'
        );

        PERFORM net.http_post(
          url     := 'https://api.txtconnect.net/dev/api/sms/send',
          headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || v_sms_api_key
          ),
          body    := v_payload
        );
     END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Winback SMS Users RPC: exclude API users
CREATE OR REPLACE FUNCTION public.get_inactive_winback_sms_users(
  p_inactive_hours integer DEFAULT 24,
  p_limit integer DEFAULT 25,
  p_cooldown_hours integer DEFAULT 48
)
RETURNS TABLE(user_id uuid, full_name text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.full_name,
    p.phone
  FROM public.profiles p
  WHERE (p.is_suspended IS FALSE OR p.is_suspended IS NULL)
    AND COALESCE(p.api_access_enabled, false) = false
    AND p.phone IS NOT NULL
    AND LENGTH(TRIM(p.phone)) >= 9
    AND (p.missed_you_sms_sent_at IS NULL OR p.missed_you_sms_sent_at <= (NOW() - (p_cooldown_hours || ' hours')::INTERVAL))
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.agent_id = p.user_id
        AND o.created_at >= (NOW() - (p_inactive_hours || ' hours')::INTERVAL)
    )
  ORDER BY p.missed_you_sms_sent_at ASC NULLS FIRST, p.created_at DESC
  LIMIT p_limit;
$$;
