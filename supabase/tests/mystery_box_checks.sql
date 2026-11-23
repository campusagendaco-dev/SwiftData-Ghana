-- Checks for migration 20261123120000_mystery_box_campaigns.sql.
-- Everything runs inside a transaction that is rolled back, so it is safe to run on production
-- after the migration is applied. It needs at least one row in auth.users.
-- Every line of output should read PASS; any FAIL raises and stops the script.
BEGIN;

DO $$
DECLARE
  v_user uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  pa uuid; pb uuid;
  pr record;
  r record;
  v_count int;
  v_a int := 0;
  v_err text;
  i int;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'checks need at least one row in auth.users'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- (a) only fulfilled orders count --------------------------------------------------------
  INSERT INTO public.mystery_box_campaigns (title, starts_at, ends_at, is_active, orders_per_box, max_boxes_per_user)
  VALUES ('check c1', now() - interval '1 second', now() + interval '1 day', true, 2, 2) RETURNING id INTO c1;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight)
  VALUES (c1, '1GB MTN', 'MTN', '1GB', 1);

  INSERT INTO public.orders (agent_id, order_type, network, package_size, customer_phone, amount, status, created_at)
  SELECT v_user, 'data', 'MTN', '1GB', '0200000000', 5, 'paid', now() FROM generate_series(1, 2);

  SELECT * INTO pr FROM public.mystery_box_progress(c1);
  IF pr.qualifying_orders <> 0 OR pr.boxes_available <> 0 OR pr.orders_to_next <> 2 THEN
    RAISE EXCEPTION 'FAIL (a) paid orders counted: %', row_to_json(pr);
  END IF;

  UPDATE public.orders SET status = 'fulfilled'
   WHERE agent_id = v_user AND order_type = 'data' AND status = 'paid' AND customer_phone = '0200000000';
  SELECT * INTO pr FROM public.mystery_box_progress(c1);
  IF pr.qualifying_orders <> 2 OR pr.boxes_earned <> 1 OR pr.boxes_available <> 1 OR pr.orders_to_next <> 2 THEN
    RAISE EXCEPTION 'FAIL (a) fulfilled orders not counted: %', row_to_json(pr);
  END IF;
  RAISE NOTICE 'PASS (a) only fulfilled orders count';

  -- (b) zero-amount and free-data orders do not count ---------------------------------------
  INSERT INTO public.orders (agent_id, order_type, network, package_size, customer_phone, amount, status, created_at)
  VALUES (v_user, 'data', 'MTN', '1GB', '0200000000', 0, 'fulfilled', now()),
         (v_user, 'free_data_claim', 'MTN', '1GB', '0200000000', 0, 'fulfilled', now());
  SELECT * INTO pr FROM public.mystery_box_progress(c1);
  IF pr.qualifying_orders <> 2 THEN RAISE EXCEPTION 'FAIL (b) counted %', pr.qualifying_orders; END IF;
  RAISE NOTICE 'PASS (b) zero-amount and free-data orders ignored';

  -- (c) first open succeeds and creates a paid prize order ----------------------------------
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
  VALUES ('check c3', now() - interval '1 second', now() + interval '1 day', true, 1, 1000) RETURNING id INTO c3;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight, stock_total, stock_remaining)
  VALUES (c3, 'rare', 'MTN', '5GB', 9, 1, 1) RETURNING id INTO pa;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight)
  VALUES (c3, 'common', 'MTN', '1GB', 1) RETURNING id INTO pb;
  -- c1's two fulfilled orders also count for c3 (same window), so add 48 more for 50 boxes.
  INSERT INTO public.orders (agent_id, order_type, network, package_size, customer_phone, amount, status, created_at)
  SELECT v_user, 'data', 'MTN', '1GB', '0200000000', 5, 'fulfilled', now() FROM generate_series(1, 48);
  FOR i IN 1..50 LOOP
    SELECT * INTO r FROM public.mystery_box_open(c3, v_user, '0241234567');
    IF r.prize_label = 'rare' THEN v_a := v_a + 1; END IF;
  END LOOP;
  IF v_a <> 1 THEN RAISE EXCEPTION 'FAIL (e) rare prize picked % times with stock 1', v_a; END IF;
  SELECT stock_remaining INTO v_count FROM public.mystery_box_prizes WHERE id = pa;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL (e) stock_remaining %', v_count; END IF;
  RAISE NOTICE 'PASS (e) sold-out prize never picked again';

  -- (f) everything sold out -> out_of_stock, stock never negative -----------------------------
  INSERT INTO public.mystery_box_campaigns (title, starts_at, ends_at, is_active, orders_per_box, max_boxes_per_user)
  VALUES ('check c4', now() - interval '1 second', now() + interval '1 day', true, 1, 5) RETURNING id INTO c4;
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
  VALUES ('check c2', now() - interval '1 second', now() + interval '1 day', true, 1, 1000) RETURNING id INTO c2;
  INSERT INTO public.mystery_box_prizes (campaign_id, label, network, package_size, weight)
  VALUES (c2, 'A', 'MTN', '2GB', 1), (c2, 'B', 'MTN', '1GB', 9);
  -- 50 fulfilled orders exist already; add 150 for 200 boxes.
  INSERT INTO public.orders (agent_id, order_type, network, package_size, customer_phone, amount, status, created_at)
  SELECT v_user, 'data', 'MTN', '1GB', '0200000000', 5, 'fulfilled', now() FROM generate_series(1, 150);
  v_a := 0;
  FOR i IN 1..200 LOOP
    SELECT * INTO r FROM public.mystery_box_open(c2, v_user, '0241234567');
    IF r.prize_label = 'A' THEN v_a := v_a + 1; END IF;
  END LOOP;
  IF v_a < 8 OR v_a > 36 THEN RAISE EXCEPTION 'FAIL (g) prize A picked %/200 (expected 8-36)', v_a; END IF;
  RAISE NOTICE 'PASS (g) weighted pick: A = %/200', v_a;

  -- (h) clients cannot call the open function or write opens ---------------------------------
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.mystery_box_open(c2, v_user, '0241234567');
    RAISE EXCEPTION 'FAIL (h) authenticated could call mystery_box_open';
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
  RAISE NOTICE 'PASS (h) clients cannot open boxes or write opens directly';
END;
$$;

ROLLBACK;
