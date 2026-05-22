-- Add expiry tracking dates to vendor profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS vendor_national_id_expiry DATE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS vendor_business_cert_expiry DATE DEFAULT NULL;
