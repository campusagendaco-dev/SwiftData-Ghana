-- Checks for 20261125010000_agent_price_floor.sql. Part 1 changes one profile inside a
-- transaction that is rolled back (no error = passed). Part 2 only reads.

-- Part 1: a signed-in agent can't save a price below the minimum, but can save a fair one
BEGIN;
DO $$
DECLARE
  v_user uuid;
  g record;
  v_floor numeric;
  v_failed boolean := false;
BEGIN
  SELECT * INTO g FROM public.global_package_settings
   WHERE COALESCE(NULLIF(agent_price, 0), public_price) > 1 ORDER BY network, package_size LIMIT 1;
  SELECT user_id INTO v_user FROM public.profiles ORDER BY user_id LIMIT 1;
  IF g IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'FAIL: need a priced bundle and a profile to test with'; END IF;
  v_floor := public._agent_price_floor(g.network, g.package_size);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.profiles
       SET agent_prices = jsonb_build_object(g.network, jsonb_build_object(g.package_size, 0.1))
     WHERE user_id = v_user;
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FAIL: a price of GH₵0.10 was saved for % %', g.network, g.package_size; END IF;

  UPDATE public.profiles
     SET agent_prices = jsonb_build_object(g.network, jsonb_build_object(g.package_size, v_floor + 1))
   WHERE user_id = v_user;
END $$;
SELECT 'agent price floor checks passed' AS result;
ROLLBACK;

-- Part 2 (read-only): store prices already saved below the minimum, lowest first
SELECT p.full_name, p.store_name, p.email, m.price_list,
       public._price_net_label(e.net) AS network, e.size AS bundle, e.price AS store_price,
       public._agent_price_floor(e.net, e.size) AS minimum
FROM public.profiles p
CROSS JOIN LATERAL (VALUES
  ('agent_prices', to_jsonb(p) -> 'agent_prices'),
  ('sub_agent_prices', to_jsonb(p) -> 'sub_agent_prices'),
  ('registered_user_prices', to_jsonb(p) -> 'registered_user_prices')
) AS m(price_list, prices)
CROSS JOIN LATERAL public._price_map_entries(m.prices) e
WHERE e.price > 0 AND e.price < public._agent_price_floor(e.net, e.size)
ORDER BY e.price, p.full_name;
