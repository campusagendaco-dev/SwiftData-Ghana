-- Fix public_system_settings so anonymous/guest visitors can read non-sensitive public site settings
-- (such as home_page_video_url, home_page_video_muted, customer_service_number, holiday_mode_enabled, etc.)
-- while keeping sensitive credentials in public.system_settings protected by RLS.

ALTER VIEW public.public_system_settings SET (security_invoker = false);

GRANT SELECT ON public.public_system_settings TO anon, authenticated, service_role;

