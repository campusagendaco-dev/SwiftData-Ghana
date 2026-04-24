-- Add store_visitor_popup_enabled column to system_settings
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS store_visitor_popup_enabled boolean NOT NULL DEFAULT false;
