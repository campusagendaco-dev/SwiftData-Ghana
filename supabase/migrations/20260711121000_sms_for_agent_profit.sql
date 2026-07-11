-- Migration: SMS for Agent Profit
-- Description: Sends custom transactional SMS to agents and parent agents when earning profit/commission on an order.
--              Additionally bypasses generic wallet credit notifications during profit allocation.

-- 1. Update handle_wallet_balance_credit_trigger to check app.current_event setting
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
  v_current_event TEXT;
BEGIN
  -- Check if we should skip generic wallet credit SMS during profit credit
  BEGIN
    v_current_event := current_setting('app.current_event', true);
  EXCEPTION WHEN OTHERS THEN
    v_current_event := NULL;
  END;

  IF v_current_event = 'profit_credit' THEN
    -- Clear it so it doesn't persist to subsequent operations in the same transaction
    PERFORM set_config('app.current_event', '', true);
    RETURN NEW;
  END IF;

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

-- 2. Update credit_order_profits function to send rich profit SMS notifications
CREATE OR REPLACE FUNCTION public.credit_order_profits(p_order_id TEXT)
RETURNS JSONB AS $$
DECLARE
    v_agent_id UUID;
    v_parent_agent_id UUID;
    v_profit NUMERIC;
    v_parent_profit NUMERIC;
    v_profit_credited BOOLEAN;
    v_parent_profit_credited BOOLEAN;
    v_status TEXT;
    v_order_uuid UUID;
    v_res JSON;
    
    -- SMS notification variables
    v_phone TEXT;
    v_normalized_phone TEXT;
    v_balance NUMERIC;
    v_sms_api_key TEXT;
    v_sms_sender_id TEXT;
    v_sms_message TEXT;
    v_sms_payload JSONB;
    v_customer_phone TEXT;
    v_network TEXT;
    v_package_size TEXT;
BEGIN
    -- Safely cast to UUID
    BEGIN
        v_order_uuid := p_order_id::UUID;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid order ID format');
    END;

    -- Select and lock the order row to prevent race conditions
    SELECT 
        agent_id, parent_agent_id, profit, parent_profit, 
        profit_credited, parent_profit_credited, status,
        customer_phone, network, package_size
    INTO 
        v_agent_id, v_parent_agent_id, v_profit, v_parent_profit, 
        v_profit_credited, v_parent_profit_credited, v_status,
        v_customer_phone, v_network, v_package_size
    FROM public.orders
    WHERE id = v_order_uuid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    -- Fetch SMS Credentials
    SELECT txtconnect_api_key, txtconnect_sender_id 
    INTO v_sms_api_key, v_sms_sender_id 
    FROM public.v_system_settings_with_secrets 
    WHERE id = 1;

    -- 1. Credit Agent Profit using public.credit_wallet
    IF v_profit > 0 AND v_agent_id IS NOT NULL AND NOT COALESCE(v_profit_credited, FALSE) THEN
        -- Set transaction config to let wallets trigger know we are doing a profit credit
        PERFORM set_config('app.current_event', 'profit_credit', true);
        
        v_res := public.credit_wallet(v_agent_id, v_profit);
        IF (v_res->>'success')::BOOLEAN THEN
            v_profit_credited := TRUE;
            
            -- Log the transaction
            INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
            VALUES (
                'info', 'system', 'agent.profit.credited',
                format('Credited agent GHS %s profit for order %s', v_profit, p_order_id),
                v_order_uuid, v_agent_id,
                jsonb_build_object('profit', v_profit)
            );

            -- Send Profit SMS Notification
            SELECT phone INTO v_phone FROM public.profiles WHERE user_id = v_agent_id;
            v_normalized_phone := public.normalize_phone_sql(v_phone);
            SELECT balance INTO v_balance FROM public.wallets WHERE agent_id = v_agent_id;

            IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
                v_sms_message := 'SwiftData Profit Alert: You have earned GH₵' || TO_CHAR(v_profit, 'FM999,999.00') || ' profit on order ' || COALESCE(v_package_size, 'data') || ' for ' || COALESCE(v_customer_phone, '') || '. New balance: GH₵' || TO_CHAR(v_balance, 'FM999,999.00') || '.';
                
                v_sms_payload := jsonb_build_object(
                  'to', v_normalized_phone,
                  'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
                  'sms', v_sms_message,
                  'unicode', '0'
                );

                PERFORM net.http_post(
                  url     := 'https://api.txtconnect.net/dev/api/sms/send',
                  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
                  body    := v_sms_payload
                );

                INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
                VALUES (v_normalized_phone, COALESCE(v_sms_sender_id, 'Orderinfo'), v_sms_message, 'custom', 'success', v_agent_id);
            END IF;
        ELSE
            -- Log failure but do not crash the order transaction
            INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
            VALUES (
                'error', 'system', 'agent.profit.failed',
                format('Failed to credit agent profit: %s', v_res->>'error'),
                v_order_uuid, v_agent_id,
                v_res::JSONB
            );
        END IF;
    END IF;

    -- 2. Credit Parent Profit using public.credit_wallet
    IF v_parent_profit > 0 AND v_parent_agent_id IS NOT NULL AND NOT COALESCE(v_parent_profit_credited, FALSE) THEN
        -- Set transaction config to let wallets trigger know we are doing a profit credit
        PERFORM set_config('app.current_event', 'profit_credit', true);

        v_res := public.credit_wallet(v_parent_agent_id, v_parent_profit);
        IF (v_res->>'success')::BOOLEAN THEN
            v_parent_profit_credited := TRUE;

            -- Log the transaction
            INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
            VALUES (
                'info', 'system', 'parent.profit.credited',
                format('Credited parent agent GHS %s profit for order %s', v_parent_profit, p_order_id),
                v_order_uuid, v_parent_agent_id,
                jsonb_build_object('parent_profit', v_parent_profit)
            );

            -- Send Parent Profit SMS Notification
            SELECT phone INTO v_phone FROM public.profiles WHERE user_id = v_parent_agent_id;
            v_normalized_phone := public.normalize_phone_sql(v_phone);
            SELECT balance INTO v_balance FROM public.wallets WHERE agent_id = v_parent_agent_id;

            IF v_normalized_phone IS NOT NULL AND v_normalized_phone != '' AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
                v_sms_message := 'SwiftData Commission Alert: You have earned GH₵' || TO_CHAR(v_parent_profit, 'FM999,999.00') || ' parent commission on order ' || COALESCE(v_package_size, 'data') || ' for ' || COALESCE(v_customer_phone, '') || '. New balance: GH₵' || TO_CHAR(v_balance, 'FM999,999.00') || '.';
                
                v_sms_payload := jsonb_build_object(
                  'to', v_normalized_phone,
                  'from', COALESCE(v_sms_sender_id, 'Orderinfo'),
                  'sms', v_sms_message,
                  'unicode', '0'
                );

                PERFORM net.http_post(
                  url     := 'https://api.txtconnect.net/dev/api/sms/send',
                  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_sms_api_key),
                  body    := v_sms_payload
                );

                INSERT INTO public.sms_logs (recipient, sender_id, body, type, status, agent_id)
                VALUES (v_normalized_phone, COALESCE(v_sms_sender_id, 'Orderinfo'), v_sms_message, 'custom', 'success', v_parent_agent_id);
            END IF;
        ELSE
            -- Log failure but do not crash the order transaction
            INSERT INTO public.system_logs (level, source, event, message, order_id, agent_id, data)
            VALUES (
                'error', 'system', 'parent.profit.failed',
                format('Failed to credit parent profit: %s', v_res->>'error'),
                v_order_uuid, v_parent_agent_id,
                v_res::JSONB
            );
        END IF;
    END IF;

    -- Update the order row with credit status flags
    UPDATE public.orders 
    SET 
        profit_credited = COALESCE(v_profit_credited, FALSE),
        parent_profit_credited = COALESCE(v_parent_profit_credited, FALSE),
        updated_at = NOW()
    WHERE id = v_order_uuid;

    RETURN jsonb_build_object(
        'success', true, 
        'profit_credited', COALESCE(v_profit_credited, FALSE), 
        'parent_profit_credited', COALESCE(v_parent_profit_credited, FALSE)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
