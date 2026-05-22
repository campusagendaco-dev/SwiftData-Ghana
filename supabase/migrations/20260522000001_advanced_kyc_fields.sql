ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_latitude TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_longitude TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_verified_momo_name TEXT DEFAULT '';
