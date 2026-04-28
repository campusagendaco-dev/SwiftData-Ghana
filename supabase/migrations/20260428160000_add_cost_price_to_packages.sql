-- Add cost_price column to global_package_settings to track provider costs
ALTER TABLE public.global_package_settings ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2) DEFAULT NULL;

-- Comment for clarity
COMMENT ON COLUMN public.global_package_settings.cost_price IS 'The price paid to the provider for this package.';
