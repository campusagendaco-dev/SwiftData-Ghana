ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_region TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_phone TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_email TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_digital_address TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_national_id_back_url TEXT DEFAULT '';
