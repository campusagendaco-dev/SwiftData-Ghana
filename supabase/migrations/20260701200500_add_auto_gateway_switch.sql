-- Add auto_gateway_switch_by_package to system_settings
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS auto_gateway_switch_by_package BOOLEAN DEFAULT FALSE;

-- Recreate public_system_settings view to expose it safely to authenticated/anonymous users
DROP VIEW IF EXISTS public.public_system_settings CASCADE;
CREATE VIEW public.public_system_settings WITH (security_invoker = true) AS
 SELECT system_settings.id,
    system_settings.disable_ordering,
    system_settings.dark_mode_enabled,
    system_settings.store_visitor_popup_enabled,
    system_settings.customer_service_number,
    system_settings.support_channel_link,
    system_settings.holiday_mode_enabled,
    system_settings.holiday_message,
    system_settings.mtn_markup_percentage,
    system_settings.telecel_markup_percentage,
    system_settings.at_markup_percentage,
    system_settings.auto_pending_sms_enabled,
    system_settings.show_announcement,
    system_settings.announcement_title,
    system_settings.announcement_message,
    system_settings.free_data_enabled,
    system_settings.free_data_network,
    system_settings.free_data_package_size,
    system_settings.whatsapp_bot_prompt,
    system_settings.home_page_video_url,
    system_settings.home_page_video_muted,
    system_settings.welcome_promo_enabled,
    system_settings.active_payment_gateway,
    system_settings.auto_gateway_switch_by_package,
    system_settings.updated_at
   FROM public.system_settings;

GRANT SELECT ON public.public_system_settings TO anon, authenticated, service_role;
