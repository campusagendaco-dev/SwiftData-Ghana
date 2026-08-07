-- Migration: Add auto_failover_non_beneficiary_to_datamart to system_settings
ALTER TABLE public.system_settings 
ADD COLUMN IF NOT EXISTS auto_failover_non_beneficiary_to_datamart BOOLEAN DEFAULT TRUE;
