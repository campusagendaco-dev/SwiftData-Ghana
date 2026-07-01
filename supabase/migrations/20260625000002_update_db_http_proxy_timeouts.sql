-- Migration: Update Database HTTP Proxy timeouts
-- Purpose: Adjust statement timeout dynamically for proxy calls and pass timeout_milliseconds to pg_net functions.

CREATE OR REPLACE FUNCTION public.exec_http_request_via_db(
  p_method TEXT,
  p_url TEXT,
  p_headers JSONB,
  p_body JSONB DEFAULT NULL,
  p_timeout_seconds INT DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_request_id BIGINT;
  v_response RECORD;
  v_elapsed INT := 0;
BEGIN
  -- Set local statement timeout to be slightly longer than the polling timeout
  -- to prevent pg_net/PostgREST role timeouts (e.g. 8s authenticator timeout) from aborting the query.
  PERFORM set_config('statement_timeout', ((p_timeout_seconds + 5) * 1000)::text, true);

  -- 1. Validate HTTP method and dispatch request
  IF UPPER(p_method) = 'GET' THEN
    SELECT net.http_get(
      url                  := p_url,
      headers              := p_headers,
      timeout_milliseconds := p_timeout_seconds * 1000
    ) INTO v_request_id;
  ELSIF UPPER(p_method) = 'POST' THEN
    SELECT net.http_post(
      url                  := p_url,
      headers              := p_headers,
      body                 := p_body,
      timeout_milliseconds := p_timeout_seconds * 1000
    ) INTO v_request_id;
  ELSE
    RAISE EXCEPTION 'Unsupported HTTP method: %', p_method;
  END IF;

  -- 2. Poll for the response in net._http_response table
  -- We check every 100ms up to the specified timeout seconds
  WHILE v_elapsed < p_timeout_seconds * 10 LOOP
    SELECT status_code, content, headers, error_msg 
    INTO v_response
    FROM net._http_response 
    WHERE id = v_request_id;

    IF FOUND THEN
      -- If pg_net encountered a client/network level error executing the request
      IF v_response.error_msg IS NOT NULL AND v_response.error_msg != '' THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', v_response.error_msg,
          'status', COALESCE(v_response.status_code, 502)
        );
      END IF;
      
      RETURN jsonb_build_object(
        'ok', v_response.status_code >= 200 AND v_response.status_code < 300,
        'status', v_response.status_code,
        'body', v_response.content,
        'headers', v_response.headers
      );
    END IF;

    PERFORM pg_sleep(0.1); -- Sleep 100ms
    v_elapsed := v_elapsed + 1;
  END LOOP;

  -- 3. Return timeout response if loop finishes
  RETURN jsonb_build_object(
    'ok', false,
    'error', 'Gateway Timeout: Database proxy did not receive a response within ' || p_timeout_seconds || ' seconds.',
    'status', 504
  );
END;
$$;

-- Revoke execution from public, grant to service_role and postgres
REVOKE EXECUTE ON FUNCTION public.exec_http_request_via_db(TEXT, TEXT, JSONB, JSONB, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exec_http_request_via_db(TEXT, TEXT, JSONB, JSONB, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.exec_http_request_via_db(TEXT, TEXT, JSONB, JSONB, INT) TO postgres;
