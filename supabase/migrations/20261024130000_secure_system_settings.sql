-- ============================================================================================
-- SECURITY HARDENING: SECURE SYSTEM SETTINGS
-- 1. Drop NOT NULL on twilio_auth_token, wati_token, meta_whatsapp_access_token
-- 2. Drop the permissive policy that allows anonymous read of system_settings
-- 3. Only authenticated users (or admins) can read system settings
-- 4. NULL-out secret tokens stored directly in public.system_settings 
-- ============================================================================================

-- Allow columns to be NULL
ALTER TABLE public.system_settings ALTER COLUMN twilio_auth_token DROP NOT NULL;
ALTER TABLE public.system_settings ALTER COLUMN wati_token DROP NOT NULL;
ALTER TABLE public.system_settings ALTER COLUMN meta_whatsapp_access_token DROP NOT NULL;

-- Drop the permissive policy that allows anonymous read of system_settings
DROP POLICY IF EXISTS "Anyone can read system settings" ON public.system_settings;

-- Only authenticated users (or admins) can read system settings
DROP POLICY IF EXISTS "Authenticated users can read system settings" ON public.system_settings;
CREATE POLICY "Authenticated users can read system settings" ON public.system_settings
  FOR SELECT TO authenticated
  USING (true);

-- Clear secrets from the table so they can never leak to frontend or client queries
UPDATE public.system_settings
SET twilio_auth_token = NULL,
    wati_token = NULL,
    meta_whatsapp_access_token = NULL
WHERE id = 1;
