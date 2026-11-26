-- Prevent concurrent double-delivery races at the database layer.
--
-- Why: Application-level duplicate checks (SELECT then INSERT) have a TOCTOU race
-- window when two requests for the same (recipient, network, package) arrive
-- concurrently (e.g. double-click, client retry, or overlapping webhooks). Both
-- SELECTs see no in-flight row, both INSERT, and both trigger verify-payment.
--
-- Rule enforced atomically:
--   - Acquire a transaction-scoped advisory lock keyed by normalized
--     (phone, network, package_size) before inserting an in-flight data order.
--   - If another in-flight data order (status IN pending, paid, processing,
--     queued, initiated) exists within the last 60 minutes for that exact
--     (phone, network, package_size), raise DUPLICATE_PROCESSING_ORDER (23505).
--   - Deliberate repeat purchases AFTER a previous order is delivered
--     (fulfilled / completed / delivered) or terminal (failed / refunded /
--     cancelled / etc.) are NEVER blocked.
--   - Non-data order types (mystery_box_prize, free_data_claim, airtime,
--     utility, voucher, afa, wallet_topup, activations) are excluded.

CREATE OR REPLACE FUNCTION public.normalize_order_phone_for_dedup(raw_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits text;
BEGIN
  v_digits := regexp_replace(coalesce(raw_phone, ''), '\D+', '', 'g');
  IF length(v_digits) = 12 AND left(v_digits, 3) = '233' THEN
    RETURN '0' || substr(v_digits, 4);
  END IF;
  IF length(v_digits) = 9 AND left(v_digits, 1) <> '0' THEN
    RETURN '0' || v_digits;
  END IF;
  RETURN v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_order_network_for_dedup(raw_network text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_net text;
BEGIN
  v_net := upper(btrim(coalesce(raw_network, '')));
  IF v_net LIKE 'KORBA%' THEN
    v_net := btrim(regexp_replace(v_net, '^KORBA\s*', '', 'i'));
  END IF;
  IF v_net LIKE '%MASH%' THEN
    RETURN 'MTN MASH UP';
  END IF;
  IF v_net LIKE '%TELECEL%' OR v_net LIKE '%VODA%' OR v_net LIKE '%VDF%' OR v_net = 'RED' THEN
    RETURN 'TELECEL';
  END IF;
  IF v_net LIKE '%AIRTEL%' OR v_net LIKE '%TIGO%' OR v_net = 'AT' OR v_net = 'ATL' OR v_net LIKE '%AT %' THEN
    RETURN 'AIRTELTIGO';
  END IF;
  IF v_net LIKE '%MTN%' OR v_net = 'YELLO' THEN
    RETURN 'MTN';
  END IF;
  RETURN v_net;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_order_package_for_dedup(raw_package text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(regexp_replace(coalesce(raw_package, ''), '\s+', '', 'g'));
$$;

-- Partial functional index keeping the in-flight dedup lookup fast with minimal index bloat.
CREATE INDEX IF NOT EXISTS idx_orders_inflight_dedup
  ON public.orders (
    public.normalize_order_phone_for_dedup(customer_phone),
    public.normalize_order_network_for_dedup(network),
    public.normalize_order_package_for_dedup(package_size),
    created_at DESC
  )
  WHERE lower(coalesce(status, '')) IN ('pending', 'paid', 'processing', 'queued', 'initiated')
    AND lower(coalesce(order_type, 'data')) IN ('data', 'sme', 'api');

CREATE OR REPLACE FUNCTION public.prevent_concurrent_duplicate_data_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_type text;
  v_status text;
  v_norm_phone text;
  v_norm_net text;
  v_norm_pkg text;
  v_existing record;
BEGIN
  v_order_type := lower(coalesce(NEW.order_type, 'data'));
  v_status := lower(coalesce(NEW.status, 'pending'));

  -- Only guard in-flight data/SME/API-data orders.
  -- Excludes mystery_box_prize, free_data_claim, airtime, utility, voucher, afa, topups, activations.
  IF v_order_type NOT IN ('data', 'sme', 'api') THEN
    RETURN NEW;
  END IF;

  IF v_order_type = 'api' AND upper(btrim(coalesce(NEW.package_size, ''))) = 'AIRTIME' THEN
    RETURN NEW;
  END IF;

  IF v_status NOT IN ('pending', 'paid', 'processing', 'queued', 'initiated') THEN
    RETURN NEW;
  END IF;

  v_norm_phone := public.normalize_order_phone_for_dedup(NEW.customer_phone);
  v_norm_net := public.normalize_order_network_for_dedup(NEW.network);
  v_norm_pkg := public.normalize_order_package_for_dedup(NEW.package_size);

  IF v_norm_phone = '' OR v_norm_net = '' OR v_norm_pkg = '' THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent inserts for the exact same (phone, network, package_size).
  PERFORM pg_advisory_xact_lock(
    hashtext('order_inflight:' || v_norm_phone || '|' || v_norm_net || '|' || v_norm_pkg)
  );

  SELECT o.id, o.status, o.network, o.package_size
    INTO v_existing
    FROM public.orders o
   WHERE lower(coalesce(o.order_type, 'data')) IN ('data', 'sme', 'api')
     AND upper(btrim(coalesce(o.package_size, ''))) <> 'AIRTIME'
     AND lower(coalesce(o.status, '')) IN ('pending', 'paid', 'processing', 'queued', 'initiated')
     AND o.created_at >= (now() - interval '60 minutes')
     AND (NEW.id IS NULL OR o.id <> NEW.id)
     AND public.normalize_order_phone_for_dedup(o.customer_phone) = v_norm_phone
     AND public.normalize_order_network_for_dedup(o.network) = v_norm_net
     AND public.normalize_order_package_for_dedup(o.package_size) = v_norm_pkg
   ORDER BY o.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'DUPLICATE_PROCESSING_ORDER: You already have a processing % % order for % (Order #%). Please wait for it to be delivered before placing another order.',
      coalesce(v_existing.network, NEW.network),
      coalesce(v_existing.package_size, NEW.package_size),
      v_norm_phone,
      upper(left(v_existing.id::text, 8))
      USING ERRCODE = '23505',
            DETAIL = format('existing_order_id=%s;status=%s', v_existing.id, v_existing.status),
            HINT = 'Wait for the active order to be delivered (fulfilled/completed) before placing a repeat purchase.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_concurrent_duplicate_data_order ON public.orders;
CREATE TRIGGER trg_prevent_concurrent_duplicate_data_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  WHEN (
    lower(coalesce(NEW.order_type, 'data')) IN ('data', 'sme', 'api')
    AND lower(coalesce(NEW.status, 'pending')) IN ('pending', 'paid', 'processing', 'queued', 'initiated')
  )
  EXECUTE FUNCTION public.prevent_concurrent_duplicate_data_order();
