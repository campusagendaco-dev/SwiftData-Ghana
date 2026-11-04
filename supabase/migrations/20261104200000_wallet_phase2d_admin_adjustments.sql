-- ═══════════════════════════════════════════════════════════════════════════
-- Wallet Phase 2d: controlled manual adjustments (four-eyes rule).
--
-- Every manual credit/debit by an admin goes through admin_wallet_adjust():
--   * |amount| <= threshold  → applied now via wallet_post(), labelled with the
--                              admin and the written reason.
--   * |amount| >  threshold  → stored as a pending request; a DIFFERENT admin
--                              must approve it with admin_wallet_decide().
-- Every adjustment, applied or pending, is kept in wallet_adjustment_requests.
-- Debits can never overdraw (wallet_post rule), including the API wallet.
-- Thresholds live in wallet_controls and can be changed without a deploy.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wallet_controls (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.wallet_controls (key, value, description) VALUES
  ('admin_adjust_approval_threshold', 200, 'Manual adjustments above this amount (GH₵) need a second admin'),
  ('max_topup_amount', 5000, 'Largest single wallet top-up allowed (GH₵)')
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.wallet_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read wallet controls" ON public.wallet_controls;
CREATE POLICY "Admins read wallet controls" ON public.wallet_controls FOR SELECT TO authenticated USING (public.is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.wallet_controls FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.wallet_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  account text NOT NULL CHECK (account IN ('main', 'api')),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'rejected', 'failed')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  result jsonb
);
CREATE INDEX IF NOT EXISTS wallet_adjustment_requests_status_idx ON public.wallet_adjustment_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS wallet_adjustment_requests_agent_idx ON public.wallet_adjustment_requests (agent_id, requested_at DESC);
ALTER TABLE public.wallet_adjustment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read adjustment requests" ON public.wallet_adjustment_requests;
CREATE POLICY "Admins read adjustment requests" ON public.wallet_adjustment_requests FOR SELECT TO authenticated USING (public.is_admin());
REVOKE INSERT, UPDATE, DELETE ON public.wallet_adjustment_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(
  p_admin_id uuid, p_agent_id uuid, p_account text, p_amount numeric, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold numeric := coalesce((SELECT value FROM public.wallet_controls WHERE key = 'admin_adjust_approval_threshold'), 200);
  v_amount numeric(14,2) := round(p_amount, 2);
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Manual adjustment by admin');
  v_req uuid;
  v_res jsonb;
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin privileges required');
  END IF;
  IF p_account NOT IN ('main', 'api') OR v_amount IS NULL OR v_amount = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid account or amount');
  END IF;

  IF abs(v_amount) > v_threshold THEN
    INSERT INTO public.wallet_adjustment_requests (agent_id, account, amount, reason, requested_by)
    VALUES (p_agent_id, p_account, v_amount, v_reason, p_admin_id)
    RETURNING id INTO v_req;
    RETURN jsonb_build_object('success', true, 'pending', true, 'request_id', v_req, 'threshold', v_threshold,
      'message', format('Adjustments above GH₵%s need a second admin to approve.', v_threshold));
  END IF;

  INSERT INTO public.wallet_adjustment_requests (agent_id, account, amount, reason, requested_by, status, decided_by, decided_at, decision_note)
  VALUES (p_agent_id, p_account, v_amount, v_reason, p_admin_id, 'executed', p_admin_id, now(), 'Within single-admin limit')
  RETURNING id INTO v_req;

  v_res := public.wallet_post(p_agent_id, p_account, v_amount,
                              CASE WHEN v_amount > 0 THEN 'admin_credit' ELSE 'admin_debit' END,
                              'admin_adjustment', v_req::text, 'admin_adjustment:' || v_req::text,
                              v_reason || ' (by admin ' || p_admin_id::text || ')');
  IF NOT coalesce((v_res->>'success')::boolean, false) THEN
    RAISE EXCEPTION '%', coalesce(v_res->>'error', 'Adjustment failed');  -- rolls back the request row too
  END IF;
  UPDATE public.wallet_adjustment_requests SET result = v_res WHERE id = v_req;
  RETURN v_res || jsonb_build_object('executed', true, 'request_id', v_req);
EXCEPTION WHEN raise_exception THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_wallet_decide(
  p_admin_id uuid, p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_res jsonb;
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin privileges required');
  END IF;
  SELECT * INTO r FROM public.wallet_adjustment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already ' || r.status);
  END IF;
  IF r.requested_by = p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'A different admin must approve this adjustment');
  END IF;

  IF NOT p_approve THEN
    UPDATE public.wallet_adjustment_requests
       SET status = 'rejected', decided_by = p_admin_id, decided_at = now(), decision_note = p_note
     WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'rejected', true);
  END IF;

  v_res := public.wallet_post(r.agent_id, r.account, r.amount,
                              CASE WHEN r.amount > 0 THEN 'admin_credit' ELSE 'admin_debit' END,
                              'admin_adjustment', r.id::text, 'admin_adjustment:' || r.id::text,
                              r.reason || ' (requested by ' || r.requested_by::text || ', approved by ' || p_admin_id::text || ')');
  UPDATE public.wallet_adjustment_requests
     SET status = CASE WHEN coalesce((v_res->>'success')::boolean, false) THEN 'executed' ELSE 'failed' END,
         decided_by = p_admin_id, decided_at = now(), decision_note = p_note, result = v_res
   WHERE id = p_request_id;
  RETURN v_res || jsonb_build_object('executed', coalesce((v_res->>'success')::boolean, false), 'request_id', r.id,
                                     'agent_id', r.agent_id, 'account', r.account, 'amount', r.amount);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_wallet_adjust(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_wallet_decide(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wallet_adjust(uuid, uuid, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_wallet_decide(uuid, uuid, boolean, text) TO service_role;
