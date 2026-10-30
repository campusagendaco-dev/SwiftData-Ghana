-- Add mtn_express_mode_enabled to system_settings so admin can toggle MTN Express routing to BundleZone
ALTER TABLE public.system_settings
ADD COLUMN IF NOT EXISTS mtn_express_mode_enabled boolean DEFAULT false;

