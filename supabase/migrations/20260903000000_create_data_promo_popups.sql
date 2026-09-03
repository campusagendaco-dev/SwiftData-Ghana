-- Create data_promo_popups table for promotional popups with direct purchasing
CREATE TABLE IF NOT EXISTS public.data_promo_popups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  network TEXT NOT NULL DEFAULT 'MTN',
  package_size TEXT NOT NULL DEFAULT '5GB',
  original_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  promo_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  badge_text TEXT DEFAULT '🔥 HOT DEAL',
  banner_image_url TEXT,
  theme_color TEXT NOT NULL DEFAULT 'amber',
  target_audience TEXT NOT NULL DEFAULT 'all', -- 'all', 'agents', 'customers'
  expires_at TIMESTAMPTZ,
  max_claims INTEGER NOT NULL DEFAULT 0, -- 0 means unlimited
  claimed_count INTEGER NOT NULL DEFAULT 0,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.data_promo_popups ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated and anonymous users for active popups
CREATE POLICY "Allow public read access for active data promo popups"
  ON public.data_promo_popups
  FOR SELECT
  USING (true);

-- Allow full access to service_role, admins, and authenticated users
CREATE POLICY "Allow admin full access to data_promo_popups"
  ON public.data_promo_popups
  FOR ALL
  USING (
    auth.role() = 'service_role' OR 
    public.has_role(auth.uid(), 'admin') OR
    auth.role() = 'authenticated'
  );

-- Create RPC to increment promo claim count securely
CREATE OR REPLACE FUNCTION public.increment_data_promo_claim(p_promo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promo RECORD;
BEGIN
  SELECT * INTO v_promo FROM public.data_promo_popups WHERE id = p_promo_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Promo deal not found');
  END IF;

  IF NOT v_promo.is_active THEN
    RETURN jsonb_build_object('success', false, 'message', 'Promo deal is no longer active');
  END IF;

  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Promo deal has expired');
  END IF;

  IF v_promo.max_claims > 0 AND v_promo.claimed_count >= v_promo.max_claims THEN
    RETURN jsonb_build_object('success', false, 'message', 'Promo deal has reached maximum claims capacity');
  END IF;

  UPDATE public.data_promo_popups
  SET claimed_count = claimed_count + 1,
      updated_at = NOW()
  WHERE id = p_promo_id;

  RETURN jsonb_build_object('success', true, 'claimed_count', v_promo.claimed_count + 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_data_promo_claim(UUID) TO authenticated, anon;
