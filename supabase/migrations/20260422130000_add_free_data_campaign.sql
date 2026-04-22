-- Add free data campaign columns to system_settings
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS free_data_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS free_data_network TEXT DEFAULT 'MTN';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS free_data_package_size TEXT DEFAULT '1GB';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS free_data_max_claims INT DEFAULT 100;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS free_data_claims_count INT DEFAULT 0;

-- The promo_codes, support_tickets, and audit_logs tables are created in the
-- previous migration (20260422124000_add_pro_admin_features.sql).
-- Run: npx supabase db push  to apply all pending migrations.
