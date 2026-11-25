-- Agent store price floor (2026-11-25).
-- A store price below the site's own price for that bundle can never be charged (checkout and
-- wallet purchases use the higher of the two), but it was still saved, which the margin
-- watchdog reports as a loss and customers can see. Saving a NEW or CHANGED price below the
-- minimum (global agent_price, else public_price, for the same network + bundle) is now refused
-- with a clear message, from every screen. Prices already saved are left alone (so nobody is
-- stuck) and listed by supabase/tests/agent_price_floor_checks.sql. The server (service role)
-- is not limited. Apply in the SQL editor (never db push). Safe to run twice.

-- Network names the way checkout reads them (initialize-payment normalizeNetwork)
CREATE OR REPLACE FUNCTION public._price_net(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN n LIKE '%MASH%' THEN 'MTN MASH UP'
    WHEN n LIKE '%TELECEL%' OR n LIKE '%VODA%' OR n LIKE '%VDF%' OR n = 'RED' THEN 'TELECEL'
    WHEN n LIKE '%AIRTEL%' OR n LIKE '%TIGO%' OR n LIKE '%AT%' THEN 'AIRTELTIGO'
    ELSE 'MTN'
  END
  FROM (SELECT upper(btrim(regexp_replace(coalesce(p, ''), '^\s*korba', '', 'i'))) AS n) x;
$$;

-- How a normalised network is shown to people
CREATE OR REPLACE FUNCTION public._price_net_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE public._price_net(p) WHEN 'MTN MASH UP' THEN 'MTN Mash Up' WHEN 'TELECEL' THEN 'Telecel'
                                   WHEN 'AIRTELTIGO' THEN 'AirtelTigo' ELSE 'MTN' END;
$$;

CREATE OR REPLACE FUNCTION public._price_size(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(coalesce(p, ''), '\s', '', 'g'));
$$;

-- Every (network, bundle, price) in a store price map: nested {"MTN": {"30GB": 120}} or flat {"MTN_30GB": 120}
CREATE OR REPLACE FUNCTION public._price_map_entries(m jsonb)
RETURNS TABLE(net text, size text, price numeric) LANGUAGE sql IMMUTABLE AS $$
  WITH raw AS (
    SELECT n.key AS k_net, s.key AS k_size, s.value #>> '{}' AS v
    FROM jsonb_each(CASE WHEN jsonb_typeof(m) = 'object' THEN m ELSE '{}'::jsonb END) n
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(n.value) = 'object' THEN n.value ELSE '{}'::jsonb END) s
    UNION ALL
    SELECT r[1], r[2], f.value #>> '{}'
    FROM jsonb_each(CASE WHEN jsonb_typeof(m) = 'object' THEN m ELSE '{}'::jsonb END) f
    CROSS JOIN LATERAL regexp_match(f.key, '^([A-Za-z0-9_]+?)[\s:_-]+([0-9]+(?:\.[0-9]+)?\s*(?:GB|MB))$', 'i') r
    WHERE jsonb_typeof(f.value) IN ('number', 'string')
  )
  SELECT public._price_net(k_net), public._price_size(k_size), v::numeric
  FROM raw
  WHERE v ~ '^\s*[0-9]+(\.[0-9]+)?\s*$';
$$;

-- The minimum a store may list a bundle at: what checkout already charges as the floor
CREATE OR REPLACE FUNCTION public._agent_price_floor(p_net text, p_size text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(COALESCE(NULLIF(g.agent_price, 0), g.public_price))
  FROM public.global_package_settings g
  WHERE public._price_net(g.network) = public._price_net(p_net)
    AND public._price_size(g.package_size) = public._price_size(p_size);
$$;
REVOKE ALL ON FUNCTION public._agent_price_floor(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._agent_price_floor(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_agent_price_floor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col text;
  new_map jsonb;
  old_map jsonb;
  e record;
  old_price numeric;
  floor_price numeric;
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  FOREACH col IN ARRAY ARRAY['agent_prices', 'sub_agent_prices', 'registered_user_prices'] LOOP
    new_map := to_jsonb(NEW) -> col;
    IF new_map IS NULL OR jsonb_typeof(new_map) <> 'object' THEN CONTINUE; END IF;
    old_map := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) -> col END;
    IF new_map IS NOT DISTINCT FROM old_map THEN CONTINUE; END IF;
    FOR e IN SELECT * FROM public._price_map_entries(new_map) WHERE price > 0 LOOP
      -- only new or changed prices are checked; ones already saved are reported, not blocked
      SELECT o.price INTO old_price FROM public._price_map_entries(old_map) o
       WHERE o.net = e.net AND o.size = e.size LIMIT 1;
      IF old_price IS NOT NULL AND old_price = e.price THEN CONTINUE; END IF;
      floor_price := public._agent_price_floor(e.net, e.size);
      IF floor_price > 0 AND e.price < floor_price THEN
        RAISE EXCEPTION 'Price too low: % % at GH₵% is below the minimum of GH₵%. Set at least GH₵% or leave it empty.',
          public._price_net_label(e.net), e.size, to_char(e.price, 'FM999990.00'), to_char(floor_price, 'FM999990.00'), to_char(floor_price, 'FM999990.00')
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_agent_price_floor() FROM PUBLIC, anon, authenticated;

-- Fire only when a price column is written (registered_user_prices only where it exists)
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND column_name IN ('agent_prices', 'sub_agent_prices', 'registered_user_prices');
  EXECUTE 'DROP TRIGGER IF EXISTS trg_guard_agent_price_floor ON public.profiles';
  IF cols IS NOT NULL THEN
    EXECUTE format('CREATE TRIGGER trg_guard_agent_price_floor BEFORE INSERT OR UPDATE OF %s ON public.profiles
                    FOR EACH ROW EXECUTE FUNCTION public.guard_agent_price_floor()', cols);
  END IF;
END $$;
