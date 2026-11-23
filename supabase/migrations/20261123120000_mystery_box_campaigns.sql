-- Mystery Box campaigns: customers earn a box for every N fulfilled data orders inside a campaign
-- window and open it for a random, weighted, stock-limited data prize.
-- Apply in the Supabase SQL editor (never `supabase db push`). Safe to re-run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mystery_box_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Mystery Box',
  description text,
  image_url text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  orders_per_box integer NOT NULL DEFAULT 2 CHECK (orders_per_box >= 1),
  max_boxes_per_user integer NOT NULL DEFAULT 3 CHECK (max_boxes_per_user >= 1),
  min_order_amount numeric NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  bullets jsonb NOT NULL DEFAULT '["Every order on your account during the campaign counts toward your box.","Open your box when you qualify.","Discover the surprise prize waiting inside!"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.mystery_box_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.mystery_box_campaigns(id) ON DELETE CASCADE,
  label text NOT NULL,
  network text NOT NULL,
  package_size text NOT NULL,
  is_mashup boolean NOT NULL DEFAULT false,
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  stock_total integer CHECK (stock_total IS NULL OR stock_total >= 0),
  stock_remaining integer CHECK (stock_remaining IS NULL OR stock_remaining >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mystery_box_prizes_campaign ON public.mystery_box_prizes (campaign_id);

CREATE TABLE IF NOT EXISTS public.mystery_box_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.mystery_box_campaigns(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  box_number integer NOT NULL CHECK (box_number >= 1),
  prize_id uuid REFERENCES public.mystery_box_prizes(id) ON DELETE SET NULL,
  prize_label text NOT NULL,
  recipient_phone text NOT NULL,
  order_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id, box_number)
);
CREATE INDEX IF NOT EXISTS idx_mystery_box_opens_order ON public.mystery_box_opens (order_id);
CREATE INDEX IF NOT EXISTS idx_mystery_box_opens_campaign_created ON public.mystery_box_opens (campaign_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Access: users read active campaigns/prizes and their own opens; admins manage.
-- Opens are written only by mystery_box_open (service role).
-- ---------------------------------------------------------------------------
ALTER TABLE public.mystery_box_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mystery_box_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mystery_box_opens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mystery_box_campaigns, public.mystery_box_prizes, public.mystery_box_opens FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mystery_box_campaigns, public.mystery_box_prizes TO authenticated;
GRANT SELECT ON public.mystery_box_opens TO authenticated;
GRANT ALL ON public.mystery_box_campaigns, public.mystery_box_prizes, public.mystery_box_opens TO service_role;

DROP POLICY IF EXISTS "mystery_box_campaigns_read_active" ON public.mystery_box_campaigns;
CREATE POLICY "mystery_box_campaigns_read_active" ON public.mystery_box_campaigns
  FOR SELECT TO authenticated USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS "mystery_box_campaigns_admin_write" ON public.mystery_box_campaigns;
CREATE POLICY "mystery_box_campaigns_admin_write" ON public.mystery_box_campaigns
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mystery_box_prizes_read_active" ON public.mystery_box_prizes;
CREATE POLICY "mystery_box_prizes_read_active" ON public.mystery_box_prizes
  FOR SELECT TO authenticated USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS "mystery_box_prizes_admin_write" ON public.mystery_box_prizes;
CREATE POLICY "mystery_box_prizes_admin_write" ON public.mystery_box_prizes
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "mystery_box_opens_read_own" ON public.mystery_box_opens;
CREATE POLICY "mystery_box_opens_read_own" ON public.mystery_box_opens
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

-- ---------------------------------------------------------------------------
-- Progress (internal helper + caller-scoped wrapper)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mystery_box_progress_for(p_campaign_id uuid, p_user_id uuid)
RETURNS TABLE(qualifying_orders integer, boxes_earned integer, boxes_opened integer, boxes_available integer, orders_to_next integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.mystery_box_campaigns%ROWTYPE;
  v_open boolean;
BEGIN
  SELECT * INTO c FROM public.mystery_box_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR p_user_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT count(*)::int INTO qualifying_orders
  FROM public.orders o
  WHERE o.agent_id = p_user_id
    AND o.status IN ('fulfilled', 'completed')
    AND o.order_type = 'data'
    AND o.amount > 0
    AND o.amount >= c.min_order_amount
    AND o.created_at >= c.starts_at
    AND o.created_at < c.ends_at;

  SELECT count(*)::int INTO boxes_opened
  FROM public.mystery_box_opens m
  WHERE m.campaign_id = p_campaign_id AND m.user_id = p_user_id;

  boxes_earned := LEAST(qualifying_orders / c.orders_per_box, c.max_boxes_per_user);
  v_open := c.is_active AND now() >= c.starts_at AND now() < c.ends_at;
  boxes_available := CASE WHEN v_open THEN GREATEST(boxes_earned - boxes_opened, 0) ELSE 0 END;
  orders_to_next := CASE
    WHEN boxes_earned >= c.max_boxes_per_user THEN 0
    ELSE c.orders_per_box - (qualifying_orders % c.orders_per_box)
  END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public._mystery_box_progress_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mystery_box_progress_for(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mystery_box_progress(p_campaign_id uuid)
RETURNS TABLE(qualifying_orders integer, boxes_earned integer, boxes_opened integer, boxes_available integer, orders_to_next integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public._mystery_box_progress_for(p_campaign_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.mystery_box_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mystery_box_progress(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Open a box (service role only): eligibility, weighted pick, stock, prize order, open record —
-- all in one transaction, serialised per campaign by the row lock.
-- Raises: campaign_closed | invalid_phone | not_eligible | out_of_stock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mystery_box_open(p_campaign_id uuid, p_user_id uuid, p_phone text)
RETURNS TABLE(open_id uuid, order_id uuid, box_number integer, prize_label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.mystery_box_campaigns%ROWTYPE;
  v_progress record;
  v_prize public.mystery_box_prizes%ROWTYPE;
  v_box integer;
  v_order_id uuid := gen_random_uuid();
  v_open_id uuid := gen_random_uuid();
  v_rows integer;
BEGIN
  SELECT * INTO c FROM public.mystery_box_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR NOT c.is_active OR now() < c.starts_at OR now() >= c.ends_at THEN
    RAISE EXCEPTION 'campaign_closed';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'not_eligible';
  END IF;

  IF p_phone IS NULL OR p_phone !~ '^0[235][0-9]{8}$' THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  SELECT * INTO v_progress FROM public._mystery_box_progress_for(p_campaign_id, p_user_id);
  v_box := v_progress.boxes_opened + 1;
  IF v_box > v_progress.boxes_earned THEN
    RAISE EXCEPTION 'not_eligible';
  END IF;

  -- Weighted random pick among active prizes with stock left.
  SELECT t.id, t.campaign_id, t.label, t.network, t.package_size, t.is_mashup, t.weight,
         t.stock_total, t.stock_remaining, t.is_active, t.created_at
    INTO v_prize
  FROM (
    SELECT p.*,
           sum(p.weight) OVER (ORDER BY p.id) AS cum,
           sum(p.weight) OVER () AS total
    FROM public.mystery_box_prizes p
    WHERE p.campaign_id = p_campaign_id
      AND p.is_active
      AND (p.stock_remaining IS NULL OR p.stock_remaining > 0)
  ) t
  WHERE t.cum > floor(random() * t.total)
  ORDER BY t.cum
  LIMIT 1;

  IF v_prize.id IS NULL THEN
    RAISE EXCEPTION 'out_of_stock';
  END IF;

  IF v_prize.stock_remaining IS NOT NULL THEN
    UPDATE public.mystery_box_prizes
       SET stock_remaining = stock_remaining - 1
     WHERE id = v_prize.id AND stock_remaining > 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'out_of_stock';
    END IF;
  END IF;

  INSERT INTO public.orders (
    id, agent_id, order_type, payment_method, network, package_size,
    customer_phone, amount, profit, status, metadata
  ) VALUES (
    v_order_id, p_user_id, 'mystery_box_prize', 'promo', v_prize.network, v_prize.package_size,
    p_phone, 0, 0, 'paid',
    jsonb_build_object('mystery_box_open_id', v_open_id, 'campaign_id', p_campaign_id, 'prize_label', v_prize.label)
      || CASE WHEN v_prize.is_mashup THEN jsonb_build_object('category', 'mashup') ELSE '{}'::jsonb END
  );

  INSERT INTO public.mystery_box_opens (id, campaign_id, user_id, box_number, prize_id, prize_label, recipient_phone, order_id)
  VALUES (v_open_id, p_campaign_id, p_user_id, v_box, v_prize.id, v_prize.label, p_phone, v_order_id);

  RETURN QUERY SELECT v_open_id, v_order_id, v_box, v_prize.label;
END;
$$;

REVOKE ALL ON FUNCTION public.mystery_box_open(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mystery_box_open(uuid, uuid, text) TO service_role;
