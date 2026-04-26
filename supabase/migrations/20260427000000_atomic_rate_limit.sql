-- ATOMIC RATE LIMITING
-- Replaces the TOCTOU order-count check with a single atomic DB operation.
-- INSERT ... ON CONFLICT DO UPDATE is one transaction — no concurrent requests
-- can slip through simultaneously.

CREATE TABLE IF NOT EXISTS public.api_rate_limit_counters (
  user_id       UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER     NOT NULL DEFAULT 1,
  CONSTRAINT positive_count CHECK (request_count >= 0)
);

-- Only service_role (edge functions) should touch this table
ALTER TABLE public.api_rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limit_counters FROM anon, authenticated;
GRANT ALL ON public.api_rate_limit_counters TO service_role;

-- Returns TRUE if the request is within the rate limit, FALSE if exceeded.
-- Atomically resets the window when > 1 minute has elapsed.
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_user_id   UUID,
  p_rate_limit INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_now   TIMESTAMPTZ := NOW();
BEGIN
  INSERT INTO api_rate_limit_counters (user_id, window_start, request_count)
  VALUES (p_user_id, v_now, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET
      request_count = CASE
        WHEN api_rate_limit_counters.window_start < v_now - INTERVAL '1 minute'
        THEN 1
        ELSE api_rate_limit_counters.request_count + 1
      END,
      window_start = CASE
        WHEN api_rate_limit_counters.window_start < v_now - INTERVAL '1 minute'
        THEN v_now
        ELSE api_rate_limit_counters.window_start
      END
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_rate_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit TO service_role;
