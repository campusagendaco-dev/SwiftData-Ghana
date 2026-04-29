-- Fix admin access to system_settings table which was inadvertently revoked.
-- This ensures the admin dashboard can actually fetch and update these settings.

-- 1. Grant SELECT and UPDATE to authenticated users. 
-- RLS will still restrict this to ONLY admins via the existing policy.
GRANT SELECT, UPDATE ON public.system_settings TO authenticated;

-- 2. Ensure the maintenance_mode column exists (it's used in AdminSecurity.tsx)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='system_settings' AND column_name='maintenance_mode') THEN
        ALTER TABLE public.system_settings ADD COLUMN maintenance_mode BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 3. Ensure registration_enabled column exists (it's used in AdminSecurity.tsx)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='system_settings' AND column_name='registration_enabled') THEN
        ALTER TABLE public.system_settings ADD COLUMN registration_enabled BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

-- 4. Update the public view to include these safe columns
DROP VIEW IF EXISTS public.public_system_settings;
CREATE OR REPLACE VIEW public.public_system_settings AS
SELECT
  id,
  holiday_mode_enabled,
  holiday_message,
  disable_ordering,
  maintenance_mode,
  registration_enabled,
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

GRANT SELECT ON public.public_system_settings TO anon, authenticated;
