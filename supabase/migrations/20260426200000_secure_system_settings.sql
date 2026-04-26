-- SECURITY HARDENING: Protect system settings from leakage.
-- This migration revokes direct access to the system_settings table for non-admins
-- and provides a safe 'public_system_settings' view for the frontend.

-- 1. Create the public view with only safe columns.
CREATE OR REPLACE VIEW public.public_system_settings AS
SELECT
  id,
  holiday_mode_enabled,
  holiday_message,
  disable_ordering,
  dark_mode_enabled,
  store_visitor_popup_enabled,
  customer_service_number,
  support_channel_link,
  free_data_enabled,
  free_data_network,
  free_data_package_size,
  auto_pending_sms_enabled,
  mtn_markup_percentage,
  telecel_markup_percentage,
  at_markup_percentage,
  updated_at
FROM public.system_settings;

-- 2. Grant access to the view.
GRANT SELECT ON public.public_system_settings TO anon, authenticated;

-- 3. Lock down the main table.
-- First, revoke all from public.
REVOKE ALL ON public.system_settings FROM anon, authenticated, public;

-- Explicitly allow service_role (for edge functions) and admins.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO service_role;

-- 4. Enable RLS on system_settings and create an admin-only policy.
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage system settings" ON public.system_settings;
CREATE POLICY "Admins can manage system settings" ON public.system_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Add a comment for security audits.
COMMENT ON TABLE public.system_settings IS 'Contains sensitive provider API keys. Restricted to admins and service_role.';
COMMENT ON VIEW public.public_system_settings IS 'Safe subset of system settings for public frontend use.';
