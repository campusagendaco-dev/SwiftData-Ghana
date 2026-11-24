-- One-time fix (owner decision 2026-11-24, "split as you suggest").
-- Orders stuck in "processing" for 7-30 days that NEVER reached a provider (data/airtime only):
--   * paid by wallet            -> refunded to the wallet now (refund_failed_order: status 'refunded',
--                                  no failure SMS)
--   * paid by card/MoMo, invalid phone number
--                               -> 'cancelled', flagged needs_manual_refund (refund by hand in
--                                  Paystack/Korba; card payments can't be refunded automatically)
--   * paid by card/MoMo, valid phone number
--                               -> re-sent via heal-processing-orders (it re-checks the payment with
--                                  Paystack/Korba before sending)
-- Shows how many orders went each way.
WITH grp1 AS (
  SELECT id, payment_method, customer_phone,
         (customer_phone ~ '^0[0-9]{9}$') AS phone_ok
  FROM public.orders
  WHERE status = 'processing'
    AND order_type IN ('data', 'airtime')
    AND updated_at <  now() - interval '7 days'
    AND updated_at >= now() - interval '30 days'
    AND (provider_order_id IS NULL
         OR provider_order_id IN ('failed_api_call', 'dispatching', 'routed', 'duplicate_cooldown',
                                  'refunded', 'timeout', 'awaiting_provider'))
),
wallet_refunds AS (
  SELECT id, public.refund_failed_order(id) AS refunded
  FROM grp1
  WHERE payment_method IN ('wallet', 'balance')
),
manual_refunds AS (
  UPDATE public.orders o
  SET status = 'cancelled',
      failure_reason = 'Invalid phone number, never sent: refund by hand in Paystack/Korba',
      metadata = coalesce(o.metadata, '{}'::jsonb)
                 || jsonb_build_object('needs_manual_refund', true, 'closed_invalid_phone_at', now())
  FROM grp1 g
  WHERE o.id = g.id
    AND g.payment_method IN ('paystack', 'korba')
    AND NOT g.phone_ok
  RETURNING o.id
),
resend AS (
  SELECT jsonb_agg(id) AS ids
  FROM grp1
  WHERE payment_method IN ('paystack', 'korba') AND phone_ok
),
resend_call AS (
  SELECT jsonb_array_length(ids) AS n,
         net.http_post(
           url := 'https://lsocdjpflecduumopijn.supabase.co/functions/v1/heal-processing-orders',
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || coalesce(
               (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role' LIMIT 1), '')),
           body := jsonb_build_object('order_ids', ids),
           timeout_milliseconds := 180000
         ) AS request_id
  FROM resend
  WHERE ids IS NOT NULL
)
SELECT
  (SELECT count(*) FROM wallet_refunds WHERE refunded)     AS refunded_to_wallet,
  (SELECT count(*) FROM wallet_refunds WHERE NOT refunded) AS wallet_not_refunded,
  (SELECT count(*) FROM manual_refunds)                    AS refund_by_hand,
  (SELECT coalesce(max(n), 0) FROM resend_call)            AS sent_again;
