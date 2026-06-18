-- Migration: MTN Mash Up WhatsApp Automation Settings and Trigger
-- Creates settings columns in system_settings, updates the public view, and adds a trigger to auto-fire the export Edge Function.

-- 1. Alter system_settings table to add automation settings
ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS mashup_automation_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS mashup_export_threshold INTEGER DEFAULT 10,
ADD COLUMN IF NOT EXISTS mashup_whatsapp_number TEXT;

-- 2. Recreate public_system_settings view to include the new settings
DROP VIEW IF EXISTS public.public_system_settings CASCADE;

CREATE OR REPLACE VIEW public.public_system_settings WITH (security_invoker = true) AS
SELECT
  id, 
  disable_ordering, 
  dark_mode_enabled, 
  store_visitor_popup_enabled,
  customer_service_number, 
  support_channel_link, 
  holiday_mode_enabled, 
  holiday_message,
  mtn_markup_percentage, 
  telecel_markup_percentage, 
  at_markup_percentage,
  auto_pending_sms_enabled, 
  show_announcement, 
  announcement_title, 
  announcement_message,
  free_data_enabled, 
  free_data_network, 
  free_data_package_size,
  free_data_max_claims, 
  free_data_claims_count,
  home_page_video_url, 
  home_page_video_muted,
  withdrawal_auto_approve_enabled, 
  withdrawal_auto_approve_max_amount,
  withdrawal_auto_approve_min_age_days, 
  withdrawal_auto_approve_require_no_chargebacks,
  min_withdrawal_amount, 
  max_withdrawal_amount, 
  withdrawal_system_enabled,
  paystack_deposit_fee_percent, 
  withdrawal_fee_flat, 
  withdrawal_fee_percent,
  traditional_background_enabled, 
  background_custom_image_url, 
  enable_privacy_shield,
  show_scrolling_ad, 
  scrolling_ad_text, 
  scrolling_ad_image_url,
  agent_activation_fee, 
  sub_agent_base_fee, 
  wassce_price, 
  bece_price,
  maintenance_mode, 
  maintenance_message, 
  whatsapp_bot_prompt,
  auto_api_switch,
  tutorial_buy_video_url, 
  tutorial_agent_video_url, 
  tutorial_subagent_video_url,
  free_agent_promo_enabled,
  free_agent_promo_limit,
  free_agent_promo_claimed,
  notification_tone,
  notification_vibration_enabled,
  notification_vibration_pattern,
  ai_recommender_enabled,
  world_cup_predictor_enabled,
  mashup_automation_enabled,
  mashup_export_threshold,
  mashup_whatsapp_number,
  updated_at
FROM public.system_settings;

-- Grant select permissions
GRANT SELECT ON public.public_system_settings TO anon, authenticated, service_role;
COMMENT ON VIEW public.public_system_settings IS 'Secured subset of system configurations visible to end users and dynamic layout hooks.';

-- 3. Create database trigger function to fire when pending mashup orders hit the threshold
CREATE OR REPLACE FUNCTION public.handle_mashup_order_pending_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_threshold INTEGER;
  v_enabled BOOLEAN;
  v_service_role TEXT;
BEGIN
  -- Perform checks on insertion or when status changes to pending
  IF NEW.network = 'MTN Mash Up' AND NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status != 'pending') THEN
    -- Read settings
    SELECT mashup_automation_enabled, mashup_export_threshold 
    INTO v_enabled, v_threshold 
    FROM public.system_settings 
    WHERE id = 1;

    IF v_enabled = TRUE THEN
      -- Count currently pending mashup orders
      SELECT COUNT(*) INTO v_count 
      FROM public.orders 
      WHERE network = 'MTN Mash Up' AND status = 'pending';

      IF v_count >= v_threshold THEN
        -- Get service role key from vault
        SELECT decrypted_secret INTO v_service_role 
        FROM vault.decrypted_secrets 
        WHERE name = 'supabase_service_role' LIMIT 1;

        -- Perform asynchronous HTTP call to the auto-export Edge Function
        PERFORM net.http_post(
          url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/auto-export-mashup',
          headers := json_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_role
          )::jsonb,
          body := '{}'::jsonb
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Create the trigger on public.orders table
DROP TRIGGER IF EXISTS trg_on_mashup_order_pending ON public.orders;
CREATE TRIGGER trg_on_mashup_order_pending
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_mashup_order_pending_trigger();
