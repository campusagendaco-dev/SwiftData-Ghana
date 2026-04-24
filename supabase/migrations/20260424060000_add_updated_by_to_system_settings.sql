-- Add updated_by column if it was missing from the live database
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL REFERENCES auth.users(id);
