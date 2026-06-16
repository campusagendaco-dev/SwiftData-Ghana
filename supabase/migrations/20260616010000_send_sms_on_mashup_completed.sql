-- Create order completed status tracking trigger for MTN Mash Up packages
CREATE OR REPLACE FUNCTION public.handle_mashup_order_completed_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_normalized_phone TEXT;
  v_sms_api_key TEXT;
  v_sms_sender_id TEXT;
  v_message TEXT;
  v_payload JSONB;
BEGIN
  -- Trigger when status changes to 'completed' or 'fulfilled' and network is 'MTN Mash Up'
  IF (NEW.status = 'completed' OR NEW.status = 'fulfilled') 
     AND (COALESCE(OLD.status, 'none') NOT IN ('completed', 'fulfilled')) 
     AND NEW.network = 'MTN Mash Up' THEN
     
     -- 1. Normalize recipient phone
     v_normalized_phone := public.normalize_phone_sql(NEW.customer_phone);

     -- 2. Pull configured SMS Credentials directly from settings
     SELECT txtconnect_api_key, txtconnect_sender_id 
     INTO v_sms_api_key, v_sms_sender_id 
     FROM public.v_system_settings_with_secrets 
     WHERE id = 1;

     -- 3. Proceed only if requirements met
     IF v_normalized_phone IS NOT NULL AND v_sms_api_key IS NOT NULL AND v_sms_api_key != '' THEN
        v_message := 'Your MTN Mash Up bundle of ' || NEW.package_size || ' has been successfully completed. Please check your balance for proof. Thank you for your business!';
        
        v_payload := jsonb_build_object(
          'to', v_normalized_phone,
          'from', COALESCE(v_sms_sender_id, 'SwiftDataGh'),
          'sms', v_message,
          'unicode', '0'
        );

        -- 4. Dispatch direct, asynchronous HTTP Request via pg_net Extension
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

DROP TRIGGER IF EXISTS trg_on_mashup_order_completed ON public.orders;
CREATE TRIGGER trg_on_mashup_order_completed
  AFTER UPDATE OF status
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_mashup_order_completed_trigger();
