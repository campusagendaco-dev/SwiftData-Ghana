-- Add WATI WhatsApp configuration columns to system_settings
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS wati_token    text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS wati_endpoint text DEFAULT '' NOT NULL;

