
ALTER TABLE public.profiles
ADD COLUMN momo_number text NOT NULL DEFAULT '',
ADD COLUMN momo_network text NOT NULL DEFAULT '',
ADD COLUMN momo_account_name text NOT NULL DEFAULT '';
