-- Migration: Harden withdrawals table RLS by removing direct INSERT policy for authenticated users.
-- This ensures all withdrawal requests MUST go through the agent-withdraw Edge Function and the request_withdrawal RPC.

DROP POLICY IF EXISTS "Users can create own withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Agents can insert their own withdrawals" ON public.withdrawals;
