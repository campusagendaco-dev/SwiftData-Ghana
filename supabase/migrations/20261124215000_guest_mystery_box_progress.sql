-- Guest Mystery Box Progress & Verified-Phone Guest Order Credit
-- 1. Canonical 10-digit Ghana phone normalizer
CREATE OR REPLACE FUNCTION public._normalize_gh_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  d := regexp_replace(coalesce(p_raw, ''), '\D+', '', 'g');
  IF length(d) = 12 AND left(d, 3) = '233' THEN
    d := '0' || substring(d FROM 4);
  ELSIF length(d) = 9 THEN
    d := '0' || d;
  END IF;
  IF d ~ '^0\d{9}$' THEN
    RETURN d;
  END IF;
  RETURN NULL;
END;
$$;

-- 2. Enhance _mystery_box_progress_for so a user's OTP-verified phone number also receives credit
--    for today's guest orders (agent_id IS NULL) placed with that same phone number.
CREATE OR REPLACE FUNCTION public._mystery_box_progress_for(p_campaign_id uuid, p_user_id uuid)
RETURNS TABLE(qualifying_orders integer, boxes_earned integer, boxes_opened integer, boxes_available integer, orders_to_next integer, today date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.mystery_box_campaigns%ROWTYPE;
  v_open boolean;
  v_day_start timestamptz;
  v_verified_phone text;
BEGIN
  today := (now() AT TIME ZONE 'UTC')::date;  -- Ghana time is UTC
  v_day_start := today::timestamp AT TIME ZONE 'UTC';
  SELECT * INTO c FROM public.mystery_box_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR p_user_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, today;
    RETURN;
  END IF;

  SELECT CASE
           WHEN p.phone_verified = true THEN public._normalize_gh_phone(p.phone)
           ELSE NULL
         END
    INTO v_verified_phone
  FROM public.profiles p
  WHERE p.user_id = p_user_id
  LIMIT 1;

  SELECT count(*)::int INTO qualifying_orders
  FROM public.orders o
  WHERE (
      o.agent_id = p_user_id
      OR (
        o.agent_id IS NULL
        AND v_verified_phone IS NOT NULL
        AND public._normalize_gh_phone(o.customer_phone) = v_verified_phone
      )
    )
    AND o.status IN ('fulfilled', 'completed')
    AND o.order_type = 'data'
    AND o.amount > 0
    AND o.amount >= c.min_order_amount
    AND o.created_at >= GREATEST(c.starts_at, v_day_start)
    AND o.created_at < LEAST(c.ends_at, v_day_start + interval '1 day');

  SELECT count(*)::int INTO boxes_opened
  FROM public.mystery_box_opens m
  WHERE m.campaign_id = p_campaign_id AND m.user_id = p_user_id AND m.box_day = today;

  boxes_earned := LEAST(qualifying_orders / c.orders_per_box, c.boxes_per_day);
  v_open := c.is_active AND now() >= c.starts_at AND now() < c.ends_at;
  boxes_available := CASE WHEN v_open THEN GREATEST(boxes_earned - boxes_opened, 0) ELSE 0 END;
  orders_to_next := CASE
    WHEN boxes_earned >= c.boxes_per_day THEN 0
    ELSE c.orders_per_box - (qualifying_orders % c.orders_per_box)
  END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public._mystery_box_progress_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mystery_box_progress_for(uuid, uuid) TO service_role;

-- 3. Public read-only RPC for guest buyers on PurchaseSuccess / OrderStatus to see today's
--    Mystery Box progress for their phone number (no PII exposed).
CREATE OR REPLACE FUNCTION public.guest_mystery_box_progress(p_phone text)
RETURNS TABLE(
  campaign_id uuid,
  title text,
  orders_per_box integer,
  boxes_per_day integer,
  qualifying_orders integer,
  pending_orders integer,
  boxes_available integer,
  orders_to_next integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.mystery_box_campaigns%ROWTYPE;
  v_norm text;
  v_day_start timestamptz;
  v_earned integer;
BEGIN
  v_norm := public._normalize_gh_phone(p_phone);
  IF v_norm IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO c
  FROM public.mystery_box_campaigns
  WHERE is_active = true
    AND now() >= starts_at
    AND now() < ends_at
  ORDER BY starts_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_day_start := ((now() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC';

  SELECT
    count(*) FILTER (WHERE o.status IN ('fulfilled', 'completed'))::int,
    count(*) FILTER (WHERE o.status IN ('pending', 'processing', 'queued', 'paid'))::int
  INTO qualifying_orders, pending_orders
  FROM public.orders o
  WHERE o.agent_id IS NULL
    AND public._normalize_gh_phone(o.customer_phone) = v_norm
    AND o.order_type = 'data'
    AND o.amount > 0
    AND o.amount >= c.min_order_amount
    AND o.created_at >= GREATEST(c.starts_at, v_day_start)
    AND o.created_at < LEAST(c.ends_at, v_day_start + interval '1 day');

  v_earned := LEAST(qualifying_orders / c.orders_per_box, c.boxes_per_day);

  campaign_id := c.id;
  title := c.title;
  orders_per_box := c.orders_per_box;
  boxes_per_day := c.boxes_per_day;
  boxes_available := GREATEST(v_earned, 0);
  orders_to_next := CASE
    WHEN v_earned >= c.boxes_per_day THEN 0
    ELSE c.orders_per_box - (qualifying_orders % c.orders_per_box)
  END;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_mystery_box_progress(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_mystery_box_progress(text) TO anon, authenticated, service_role;
