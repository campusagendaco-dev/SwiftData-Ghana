-- Add missing at_markup_percentage column to system_settings
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS at_markup_percentage DECIMAL DEFAULT 0;
