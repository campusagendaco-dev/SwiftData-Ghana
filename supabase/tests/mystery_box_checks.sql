-- Checks for migration 20261123120000_mystery_box_campaigns.sql.
-- Everything runs inside a transaction that is rolled back, so it is safe to run on production
-- after the migration is applied. It needs one auth.users row with no orders in the last 2 hours.
-- It acts as the service role (like the open-mystery-box function), so the client-insert trigger
-- (tr_force_order_pending) stays out of the way, and it keeps real opens to 2 so the
-- 5-orders-a-minute guard (trg_rapid_order_rate_limit_guard) never fires. Prize odds are
-- sampled through _mystery_box_pick, which writes no orders.
-- Any FAIL raises and stops the script; reaching the end means every check passed.
BEGIN;

DO $$
DECLARE
  v_user uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  pa uuid; pb uuid; pc uuid;
  v_seed timestamptz := now() - interval '5 minutes';
  v_start timestamptz := now() - interval '1 hour';
  pr record;
  r record;
  v_prize public.mystery_box_prizes%ROWTYPE;
  v_count int;
  v_a int := 0;
  v_b int := 0;
  v_c int := 0;
  i int;
BEGIN
  SELECT u.id INTO v_user FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.agent_id = u.id AND o.created_at > now() - interval '2 hours')
  LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'checks need an auth.users row with no orders in the last 2 hours'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'service_role')::text, true);

  -- (a) only fulfilled orders count --------------------------------------------------------
  INSERT INTO public.mystery_box_campaigns (title, starts_at, ends_at, is_active, orders_per_box, max_boxes_per_user)
  VALUES ('check c1', v_start, now() + interval '1 day', true, 2, 2) RETURNING id INTO c1;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight)
  VALUES (c1, '1GB MTN', 'MTN', '1GB', 1);

  INSERT INTO public.orders (agent_id, order_type, network, package_size, customer_phone, amount, status, created_at)
  SELECT v_user, 'data', 'MTN', '1GB', '0200000000', 5, 'paid', v_seed FROM generate_series(1, 2);

  SELECT * INTO pr FROM public.mystery_box_progress(c1);
  IF pr.qualifying_orders <> 0 OR pr.boxes_available <> 0 OR pr.orders_to_next <> 2 THEN
    RAISE EXCEPTION 'FAIL (a) paid orders counted: %', row_to_json(pr);
  END IF;

  UPDATE public.orders SET status = 'fulfilled'
   WHERE agent_id = v_user AND order_type = 'data' AND status = 'paid' AND created_at = v_seed;
  SELECT * INTO pr FROM public.mystery_box_progress(c1);
  IF pr.qualifying_orders <> 2 OR pr.boxes_earned <> 1 OR pr.boxes_available <> 1 OR pr.orders_to_next <> 2 THEN
    RAISE EXCEPTION 'FAIL (a) fulfilled orders not counted: %', row_to_json(pr);
  END IF;
  RAISE NOTICE 'PASS (a) only fulfilled orders count';

  -- (b) zero-amount and free-data orders do not count ---------------------------------------
  INSERT INTO public.orders (agent_id, order_type, network, package_size, customer_phone, amount, status, created_at)
  VALUES (v_user, 'data', 'MTN', '1GB', '0200000000', 0, 'fulfilled', v_seed),
         (v_user, 'free_data_claim', 'MTN', '1GB', '0200000000', 0, 'fulfilled', v_seed);
  SELECT * INTO pr FROM public.mystery_box_progress(c1);
  IF pr.qualifying_orders <> 2 THEN RAISE EXCEPTION 'FAIL (b) counted %', pr.qualifying_orders; END IF;
  RAISE NOTICE 'PASS (b) zero-amount and free-data orders ignored';

  -- (c) first open succeeds and creates a paid prize order (real open #1) ---------------------
  SELECT * INTO r FROM public.mystery_box_open(c1, v_user, '0241234567');
  IF r.box_number <> 1 OR r.prize_label <> '1GB MTN' THEN RAISE EXCEPTION 'FAIL (c) %', row_to_json(r); END IF;
  SELECT count(*) INTO v_count FROM public.orders
   WHERE id = r.order_id AND order_type = 'mystery_box_prize' AND status = 'paid' AND amount = 0
     AND agent_id = v_user AND customer_phone = '0241234567';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL (c) prize order missing'; END IF;
  SELECT count(*) INTO v_count FROM public.mystery_box_opens WHERE order_id = r.order_id AND user_id = v_user;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL (c) open record missing'; END IF;
  SELECT * INTO pr FROM public.mystery_box_progress(c1);
  IF pr.qualifying_orders <> 2 OR pr.boxes_available <> 0 THEN
    RAISE EXCEPTION 'FAIL (c) prize order changed progress: %', row_to_json(pr);
  END IF;
  RAISE NOTICE 'PASS (c) open creates prize order and open record';

  -- (d) second open without new orders is refused --------------------------------------------
  BEGIN
    PERFORM public.mystery_box_open(c1, v_user, '0241234567');
    RAISE EXCEPTION 'FAIL (d) second open allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'not_eligible' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS (d) second open refused with not_eligible';

  -- (d2) invalid phone and closed campaign ----------------------------------------------------
  BEGIN
    PERFORM public.mystery_box_open(c1, v_user, '12345');
    RAISE EXCEPTION 'FAIL (d2) invalid phone allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'invalid_phone' THEN RAISE; END IF;
  END;
  UPDATE public.mystery_box_campaigns SET is_active = false WHERE id = c1;
  BEGIN
    PERFORM public.mystery_box_open(c1, v_user, '0241234567');
    RAISE EXCEPTION 'FAIL (d2) closed campaign allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'campaign_closed' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS (d2) invalid phone and closed campaign refused';

  -- (e) a sold-out prize is never picked again -----------------------------------------------
  INSERT INTO public.mystery_box_campaigns (title, starts_at, ends_at, is_active, orders_per_box, max_boxes_per_user)
  VALUES ('check c3', v_start, now() + interval '1 day', true, 1, 1000) RETURNING id INTO c3;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight, stock_total, stock_remaining)
  VALUES (c3, 'rare', 'MTN', '5GB', 9, 1, 1) RETURNING id INTO pa;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight)
  VALUES (c3, 'common', 'MTN', '1GB', 1);
  FOR i IN 1..50 LOOP
    v_prize := public._mystery_box_pick(c3);
    IF v_prize.label = 'rare' THEN v_a := v_a + 1; END IF;
  END LOOP;
  IF v_a <> 1 THEN RAISE EXCEPTION 'FAIL (e) rare prize picked % times with stock 1', v_a; END IF;
  SELECT stock_remaining INTO v_count FROM public.mystery_box_prizes WHERE id = pa;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL (e) stock_remaining %', v_count; END IF;
  RAISE NOTICE 'PASS (e) sold-out prize never picked again';

  -- (f) everything sold out -> out_of_stock, stock never negative (real open #2) --------------
  INSERT INTO public.mystery_box_campaigns (title, starts_at, ends_at, is_active, orders_per_box, max_boxes_per_user)
  VALUES ('check c4', v_start, now() + interval '1 day', true, 1, 5) RETURNING id INTO c4;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight, stock_total, stock_remaining)
  VALUES (c4, 'only one', 'MTN', '1GB', 1, 1, 1) RETURNING id INTO pa;
  PERFORM public.mystery_box_open(c4, v_user, '0241234567');
  BEGIN
    PERFORM public.mystery_box_open(c4, v_user, '0241234567');
    RAISE EXCEPTION 'FAIL (f) open allowed with no stock';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'out_of_stock' THEN RAISE; END IF;
  END;
  SELECT stock_remaining INTO v_count FROM public.mystery_box_prizes WHERE id = pa;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL (f) stock_remaining %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.mystery_box_opens WHERE campaign_id = c4;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL (f) % opens recorded', v_count; END IF;
  RAISE NOTICE 'PASS (f) out_of_stock when sold out, stock stays at 0';

  -- (g) weights 1:9 give roughly 10% / 90% -----------------------------------------------------
  INSERT INTO public.mystery_box_campaigns (title, starts_at, ends_at, is_active, orders_per_box, max_boxes_per_user)
  VALUES ('check c2', v_start, now() + interval '1 day', true, 1, 1000) RETURNING id INTO c2;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight)
  VALUES (c2, 'A', 'MTN', '2GB', 1), (c2, 'B', 'MTN', '1GB', 9);
  v_a := 0;
  FOR i IN 1..200 LOOP
    v_prize := public._mystery_box_pick(c2);
    IF v_prize.label = 'A' THEN v_a := v_a + 1; END IF;
  END LOOP;
  IF v_a < 8 OR v_a > 36 THEN RAISE EXCEPTION 'FAIL (g) prize A picked %/200 (expected 8-36)', v_a; END IF;
  RAISE NOTICE 'PASS (g) weighted pick 1:9: A = %/200', v_a;

  -- (g2) three prizes 8:1:1 give roughly 80% / 10% / 10% --------------------------------------
  INSERT INTO public.mystery_box_campaigns (title, starts_at, ends_at, is_active, orders_per_box, max_boxes_per_user)
  VALUES ('check c5', v_start, now() + interval '1 day', true, 1, 1000) RETURNING id INTO c5;
  -- Fixed ids put the heavy prize first in running-weight order, the order in which a pick that
  -- re-draws random() per row is most visibly wrong (it gives about 80/18/2).
  INSERT INTO public.mystery_box_prizes (id, campaign_id, label, network, package_size, weight) VALUES
    ('00000000-0000-4000-8000-0000000000a1', c5, 'big', 'MTN', '1GB', 8),
    ('00000000-0000-4000-8000-0000000000a2', c5, 'x', 'MTN', '2GB', 1),
    ('00000000-0000-4000-8000-0000000000a3', c5, 'y', 'MTN', '3GB', 1);
  v_a := 0; v_b := 0; v_c := 0;
  FOR i IN 1..400 LOOP
    v_prize := public._mystery_box_pick(c5);
    IF v_prize.label = 'big' THEN v_a := v_a + 1;
    ELSIF v_prize.label = 'x' THEN v_b := v_b + 1;
    ELSE v_c := v_c + 1; END IF;
  END LOOP;
  -- expected 320/40/40 (sd about 8/6/6); bounds are about 3.5 sd
  IF v_a < 292 OR v_a > 348 OR v_b < 20 OR v_b > 60 OR v_c < 20 OR v_c > 60 THEN
    RAISE EXCEPTION 'FAIL (g2) 8:1:1 gave %/%/% of 400 (expected about 320/40/40)', v_a, v_b, v_c;
  END IF;
  RAISE NOTICE 'PASS (g2) weighted pick 8:1:1 = %/%/%', v_a, v_b, v_c;

  -- (h) clients cannot open boxes, pick prizes or write opens directly -------------------------
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.mystery_box_open(c2, v_user, '0241234567');
    RAISE EXCEPTION 'FAIL (h) authenticated could call mystery_box_open';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public._mystery_box_pick(c2);
    RAISE EXCEPTION 'FAIL (h) authenticated could call _mystery_box_pick';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.mystery_box_opens (campaign_id, user_id, box_number, prize_label, recipient_phone, order_id)
    VALUES (c2, v_user, 999, 'x', '0241234567', gen_random_uuid());
    RAISE EXCEPTION 'FAIL (h) authenticated could insert an open';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'PASS (h) clients cannot open boxes, pick prizes or write opens directly';
  RAISE NOTICE 'ALL MYSTERY BOX CHECKS PASSED';
END;
$$;

ROLLBACK;
