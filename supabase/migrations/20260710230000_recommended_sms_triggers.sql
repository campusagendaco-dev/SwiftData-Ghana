-- Migration: Recommended Transactional SMS Triggers
-- Description: Registers triggers for Sub-Agent approval, Profit Withdrawal fulfillment, Wallet Credits (Deposits/Refunds/Manual Adjustments), and Order Failures.

-- 1. Sub-Agent Approval SMS Trigger
CREATE OR REPLACE FUNCTION public.handle_sub_agent_approval_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_normalized_phone TEXT;
  v_message TEXT;
  v_payload JSONB;
BEGIN
  IF NEW.sub_agent_approved = true AND (OLD.sub_agent_approved = false OR OLD.sub_agent_approved IS NULL) THEN
    v_normalized_phone := public.normalize_phone_sql(NEW.phone);

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      SELECT txtconnect_api_key, txtconnect_sender_id 
      INTO v_sms_api_key, v_sms_sender_id 
      FROM public.v_system_settings_with_secrets 
      WHERE id = 1;

      v_message := 'Congratulations! Your sub-agent application on SwiftData Ghana has been approved. You can now log in, fund your wallet, and start selling data bundles at wholesale rates. Visit: https://swiftdatagh.shop';

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

         INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
         VALUES (
           v_normalized_phone,
           COALESCE(v_sms_sender_id, 'Orderinfo'),
           v_message,
           'custom',
           'success',
           NEW.user_id
         );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sub_agent_approval ON public.profiles;
CREATE TRIGGER trg_sub_agent_approval
  AFTER UPDATE OF sub_agent_approved ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_sub_agent_approval_trigger();


-- 2. Profit Withdrawal SMS Trigger
CREATE OR REPLACE FUNCTION public.handle_withdrawal_status_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_normalized_phone TEXT;
  v_message TEXT;
  v_payload JSONB;
BEGIN
  IF NEW.status IN ('success', 'fulfilled') AND (OLD.status IS NULL OR OLD.status = 'pending') THEN
    -- Fetch agent phone number
    SELECT public.normalize_phone_sql(phone) INTO v_normalized_phone
    FROM public.profiles
    WHERE user_id = NEW.agent_id;

    IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' THEN
      SELECT txtconnect_api_key, txtconnect_sender_id 
      INTO v_sms_api_key, v_sms_sender_id 
      FROM public.v_system_settings_with_secrets 
      WHERE id = 1;

      v_message := 'Transaction Alert: Your withdrawal request for GH₵' || TO_CHAR(NEW.amount, 'FM999,999.00') || ' has been approved and processed successfully to your mobile money wallet. Thank you for choosing SwiftData!';

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

DROP TRIGGER IF EXISTS trg_withdrawal_status ON public.withdrawals;
CREATE TRIGGER trg_withdrawal_status
  AFTER UPDATE OF status ON public.withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_withdrawal_status_trigger();


-- 3. Wallet Balance Credit Trigger (Deposits/Refunds/Manual Adjustments)
CREATE OR REPLACE FUNCTION public.handle_wallet_balance_credit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
  v_amount NUMERIC(12, 2);
BEGIN
  -- Detect if balance increased
  IF NEW.balance > OLD.balance THEN
    v_amount := NEW.balance - OLD.balance;

    IF v_amount >= 0.01 THEN
      -- Build notification text
      v_message := 'Wallet Credited: Your wallet has been credited with GH₵' || TO_CHAR(v_amount, 'FM999,999.00') || '. New balance is GH₵' || TO_CHAR(NEW.balance, 'FM999,999.00') || '. Thank you!';

      -- Identify recipient phone number
      SELECT phone INTO v_phone FROM public.profiles WHERE user_id = NEW.agent_id;
      v_normalized_phone := public.normalize_phone_sql(v_phone);

      -- Pull configured SMS Credentials
      SELECT txtconnect_api_key, txtconnect_sender_id 
      INTO v_sms_api_key, v_sms_sender_id 
      FROM public.v_system_settings_with_secrets 
      WHERE id = 1;

      -- Dispatch SMS via pg_net
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

         -- Log to public.sms_logs
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

DROP TRIGGER IF EXISTS trg_wallet_balance_credit ON public.wallets;
CREATE TRIGGER trg_wallet_balance_credit
  AFTER UPDATE OF balance ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_wallet_balance_credit_trigger();


-- 4. Order Failure SMS Trigger
CREATE OR REPLACE FUNCTION public.handle_order_failed_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
  v_normalized_phone TEXT;
BEGIN
  IF NEW.status = 'fulfillment_failed' AND (OLD.status IS NULL OR OLD.status != 'fulfillment_failed') THEN
    
    -- Identify the agent/user phone number to notify them about their refund
    SELECT phone INTO v_phone FROM public.profiles WHERE user_id = NEW.agent_id;
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

DROP TRIGGER IF EXISTS trg_order_failed_sms ON public.orders;
CREATE TRIGGER trg_order_failed_sms
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_failed_trigger();
