-- Migration: MTN Mash Up Auto Delivery Automation
-- Adds mashup_delivery_delay_mins to system_settings, recreates public_system_settings,
-- and schedules a cron job to transition processing Mash Up orders to fulfilled after the delay.

-- 1. Add configuration column to system_settings
ALTER TABLE public.system_settings
ADD COLUMN IF NOT EXISTS mashup_delivery_delay_mins INTEGER DEFAULT 15;

-- 2. Recreate public_system_settings view to include the new column
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
  mashup_delivery_delay_mins,
  updated_at
FROM public.system_settings;

GRANT SELECT ON public.public_system_settings TO anon, authenticated, service_role;
COMMENT ON VIEW public.public_system_settings IS 'Secured subset of system configurations visible to end users and dynamic layout hooks.';

-- 3. Create the auto-delivery function
CREATE OR REPLACE FUNCTION public.auto_deliver_mashup_orders()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay_mins INTEGER;
  v_count INTEGER;
BEGIN
  -- Fetch delay minutes setting
  SELECT COALESCE(mashup_delivery_delay_mins, 15) INTO v_delay_mins
  FROM public.system_settings
  WHERE id = 1;

  -- Update processing MTN Mash Up orders that have exceeded the delay
  UPDATE public.orders
  SET 
    status = 'fulfilled',
    updated_at = now()
  WHERE 
    network = 'MTN Mash Up' 
    AND status = 'processing'
    AND updated_at <= (now() - (v_delay_mins * interval '1 minute'));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RAISE NOTICE 'Auto-delivered % MTN Mash Up orders.', v_count;
  END IF;
END;
$$;

-- 4. Schedule the cron job to run every minute
-- First, unschedule existing to avoid conflicts
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'auto-deliver-mashup-orders-job';
SELECT cron.schedule('auto-deliver-mashup-orders-job', '* * * * *', 'SELECT public.auto_deliver_mashup_orders();');
