
-- Add topup_reference column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS topup_reference TEXT UNIQUE;

-- Function to generate unique 6-digit topup reference
CREATE OR REPLACE FUNCTION public.generate_topup_reference()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  ref TEXT;
  exists_count INT;
BEGIN
  LOOP
    ref := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    SELECT COUNT(*) INTO exists_count FROM public.profiles WHERE topup_reference = ref;
    IF exists_count = 0 THEN
      RETURN ref;
    END IF;
  END LOOP;
END;
$$;

-- Auto-assign topup_reference on profile creation
CREATE OR REPLACE FUNCTION public.assign_topup_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.topup_reference IS NULL THEN
    NEW.topup_reference := public.generate_topup_reference();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_assign_topup_reference
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_topup_reference();

-- Generate topup references for existing profiles that don't have one
UPDATE public.profiles SET topup_reference = public.generate_topup_reference() WHERE topup_reference IS NULL;
