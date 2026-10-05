-- WhatsApp Anti-Ban Compliance: Opt-Out & Stop List
-- Automatically prevents promotional notifications from being sent to users who requested to STOP.

CREATE TABLE IF NOT EXISTS public.whatsapp_opt_outs (
  phone text PRIMARY KEY,
  reason text DEFAULT 'user_requested_stop',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.whatsapp_opt_outs ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_opt_outs' AND policyname = 'service_role_all_whatsapp_opt_outs'
  ) THEN
    CREATE POLICY "service_role_all_whatsapp_opt_outs" ON public.whatsapp_opt_outs
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Add whatsapp_opt_out column to profiles table if not exists
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_opt_out BOOLEAN DEFAULT false;

-- Create helper RPC to check if a phone is opted out
CREATE OR REPLACE FUNCTION public.is_whatsapp_opted_out(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_norm text;
  v_opted boolean := false;
BEGIN
  v_norm := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_norm) = 10 AND v_norm LIKE '0%' THEN
    v_norm := '233' || substr(v_norm, 2);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_opt_outs 
    WHERE phone = v_norm OR phone = p_phone
  ) INTO v_opted;

  RETURN v_opted;
END;
$$;
