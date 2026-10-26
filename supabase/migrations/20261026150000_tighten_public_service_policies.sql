-- ============================================================================
-- Tighten "service role" policies that were accidentally granted to PUBLIC.
--
-- These policies are PERMISSIVE with USING (true) / WITH CHECK (true). Because
-- permissive policies are OR'ed, they silently overrode the owner/admin-only
-- policies and let ANY authenticated user read/modify every row:
--   * sms_logs                    -> leaked all phone numbers + SMS bodies
--   * failed_logins               -> brute-force telemetry readable/erasable
--   * whatsapp_processed_messages -> dedupe table writable by any user
-- service_role bypasses RLS anyway, so scoping them TO service_role keeps
-- Edge Functions working while restoring the intended owner/admin policies
-- (e.g. "Users can view own sms logs", "admins_manage_sms_logs").
-- ============================================================================

DROP POLICY IF EXISTS "service_role_all_sms_logs" ON public.sms_logs;
CREATE POLICY "service_role_all_sms_logs" ON public.sms_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_failed_logins" ON public.failed_logins;
CREATE POLICY "service_role_all_failed_logins" ON public.failed_logins
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on whatsapp_processed_messages" ON public.whatsapp_processed_messages;
CREATE POLICY "Service role full access on whatsapp_processed_messages" ON public.whatsapp_processed_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
