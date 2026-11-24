-- Mystery Box guest purchases hardening (2026-11-24).
--   1. Guest purchases for a phone number count for ONE account: the first to verify that number
--      (guest_phone_owners). Another account verifying the same number is flagged (see
--      verify-signup-phone-otp) and gets no guest credit; moving a number between accounts doesn't
--      move the credit. An admin (authenticator app) can hand a number to a new owner, e.g. a
--      recycled SIM; the new owner only gets purchases made after the move.
--   2. The public guest progress lookup takes an order reference from today (as order tracking
--      does) instead of any phone number, so nobody can look up another number's purchases.
--   3. Guest progress counts completed purchases only; pending ones are reported separately.
-- Apply in the SQL editor (never db push), then run
-- supabase/tests/mystery_box_guest_checks.sql (no error = passed). Safe to run twice.

-- 1. Who owns a number's guest purchases
CREATE TABLE IF NOT EXISTS public.guest_phone_owners (
  phone text PRIMARY KEY CHECK (phone ~ '^0[0-9]{9}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_from timestamptz,             -- NULL = all purchases; set when an admin moves the number
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid                     -- NULL = first verification; else the admin who moved it
);
CREATE INDEX IF NOT EXISTS idx_guest_phone_owners_user ON public.guest_phone_owners (user_id);
ALTER TABLE public.guest_phone_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_phone_owners FROM anon, authenticated;

-- Existing verified numbers: the oldest account holding each one owns it.
INSERT INTO public.guest_phone_owners (phone, user_id)
SELECT DISTINCT ON (n.phone) n.phone, n.user_id
FROM (
  SELECT public._normalize_gh_phone(p.phone) AS phone, p.user_id, p.created_at
  FROM public.profiles p
  WHERE p.phone_verified = true
) n
WHERE n.phone IS NOT NULL
ORDER BY n.phone, n.created_at, n.user_id
ON CONFLICT (phone) DO NOTHING;

-- The first account to verify a number becomes its owner; later ones don't replace it.
CREATE OR REPLACE FUNCTION public.claim_guest_phone_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  IF NEW.phone_verified THEN
    v_phone := public._normalize_gh_phone(NEW.phone);
    IF v_phone IS NOT NULL THEN
      INSERT INTO public.guest_phone_owners (phone, user_id)
      VALUES (v_phone, NEW.user_id)
      ON CONFLICT (phone) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_guest_phone_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_claim_guest_phone_owner ON public.profiles;
CREATE TRIGGER trg_claim_guest_phone_owner
  AFTER INSERT OR UPDATE OF phone, phone_verified ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.claim_guest_phone_owner();

-- 2. Box progress: guest purchases count only for the number's owner, while it is still verified
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
  v_guest_phone text;
  v_credit_from timestamptz;
BEGIN
  today := (now() AT TIME ZONE 'UTC')::date;  -- Ghana time is UTC
  v_day_start := today::timestamp AT TIME ZONE 'UTC';
  SELECT * INTO c FROM public.mystery_box_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR p_user_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, today;
    RETURN;
  END IF;

  SELECT g.phone, g.credit_from
    INTO v_guest_phone, v_credit_from
  FROM public.profiles p
  JOIN public.guest_phone_owners g
    ON g.phone = public._normalize_gh_phone(p.phone) AND g.user_id = p.user_id
  WHERE p.user_id = p_user_id
    AND p.phone_verified = true
  LIMIT 1;

  SELECT count(*)::int INTO qualifying_orders
  FROM public.orders o
  WHERE (
      o.agent_id = p_user_id
      OR (
        o.agent_id IS NULL
        AND v_guest_phone IS NOT NULL
        AND public._normalize_gh_phone(o.customer_phone) = v_guest_phone
        AND (v_credit_from IS NULL OR o.created_at >= v_credit_from)
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

-- 3. Guest progress by order reference (replaces the lookup by any phone number)
DROP FUNCTION IF EXISTS public.guest_mystery_box_progress(text);

CREATE OR REPLACE FUNCTION public.guest_mystery_box_progress_for_order(p_reference text)
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
  v_ref text := btrim(coalesce(p_reference, ''));
  v_norm text;
  v_day_start timestamptz;
  v_earned integer;
BEGIN
  IF v_ref = '' OR length(v_ref) > 200 THEN
    RETURN;
  END IF;
  v_day_start := ((now() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC';

  -- Same matching as get_public_order_status. Only a guest order placed today unlocks the view.
  SELECT public._normalize_gh_phone(o.customer_phone) INTO v_norm
  FROM public.orders o
  WHERE (
      (v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND o.id = v_ref::uuid)
      OR o.metadata->>'client_reference' = v_ref
    )
    AND o.agent_id IS NULL
    AND o.created_at >= v_day_start
  LIMIT 1;
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

REVOKE ALL ON FUNCTION public.guest_mystery_box_progress_for_order(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_mystery_box_progress_for_order(text) TO anon, authenticated, service_role;

-- 4. Admin: see and move a number's guest purchases
CREATE OR REPLACE FUNCTION public.admin_guest_phone_status(p_user_id uuid)
RETURNS TABLE(phone text, phone_verified boolean, owner_user_id uuid, owner_name text, credit_from timestamptz, assigned_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT public._normalize_gh_phone(p.phone), p.phone_verified, g.user_id,
         nullif(op.full_name, ''), g.credit_from, g.assigned_at
  FROM public.profiles p
  LEFT JOIN public.guest_phone_owners g ON g.phone = public._normalize_gh_phone(p.phone)
  LEFT JOIN public.profiles op ON op.user_id = g.user_id
  WHERE p.user_id = p_user_id
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_guest_phone_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_guest_phone_status(uuid) TO authenticated, service_role;

-- Gives the user's verified number (and its future guest purchases) to that user.
-- Authenticator-app admins only. Purchases before the move stay with the old owner.
CREATE OR REPLACE FUNCTION public.admin_set_guest_phone_owner(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_old uuid;
BEGIN
  IF NOT public.admin_strong() THEN
    RAISE EXCEPTION 'Sign in with your authenticator app to do this' USING ERRCODE = '42501';
  END IF;

  SELECT public._normalize_gh_phone(p.phone) INTO v_phone
  FROM public.profiles p
  WHERE p.user_id = p_user_id AND p.phone_verified = true;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'This user has no verified phone number';
  END IF;

  SELECT g.user_id INTO v_old FROM public.guest_phone_owners g WHERE g.phone = v_phone FOR UPDATE;
  IF v_old = p_user_id THEN
    RETURN v_phone;
  END IF;

  INSERT INTO public.guest_phone_owners (phone, user_id, credit_from, assigned_at, assigned_by)
  VALUES (v_phone, p_user_id, now(), now(), auth.uid())
  ON CONFLICT (phone) DO UPDATE
    SET user_id = EXCLUDED.user_id, credit_from = EXCLUDED.credit_from,
        assigned_at = EXCLUDED.assigned_at, assigned_by = EXCLUDED.assigned_by;

  INSERT INTO public.audit_logs (admin_id, action, details)
  VALUES (auth.uid(), 'guest_phone_owner_moved',
          jsonb_build_object('phone', v_phone, 'from_user_id', v_old, 'to_user_id', p_user_id));
  RETURN v_phone;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_guest_phone_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_guest_phone_owner(uuid) TO authenticated, service_role;
