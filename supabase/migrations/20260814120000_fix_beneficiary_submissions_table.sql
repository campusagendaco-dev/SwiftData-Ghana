-- The 20260813131500 migration that creates beneficiary_submissions was never
-- actually applied to production (confirmed: PostgREST returns PGRST205 "table
-- not found" when queried). Every insert from the Submit Numbers flow — client
-- and server side — has therefore been silently failing since launch, so the
-- admin dashboard has never had a real record of submitted beneficiary numbers.
-- This migration re-creates it (idempotent) and adds the missing pieces needed
-- to make the log trustworthy: a unique constraint so re-submissions/retries
-- update the existing row instead of piling up duplicates, and columns to
-- record real evidence of whether the provider was actually reached.

CREATE TABLE IF NOT EXISTS public.beneficiary_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL,
    network TEXT DEFAULT 'MTN',
    status TEXT DEFAULT 'submitted',
    source TEXT DEFAULT 'web_ui',
    submitted_by TEXT DEFAULT 'Public User',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.beneficiary_submissions ENABLE ROW LEVEL SECURITY;

-- INSERT and UPDATE stay open: submission is genuinely public (guests use the
-- form too), and the app's upsert-by-phone-number design means status rows
-- aren't owned by whoever first submitted them — any submitter of the same
-- number legitimately needs to update the existing row (onConflict: "phone_number").
DROP POLICY IF EXISTS "Allow public insert to beneficiary_submissions" ON public.beneficiary_submissions;
CREATE POLICY "Allow public insert to beneficiary_submissions"
ON public.beneficiary_submissions FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update beneficiary_submissions" ON public.beneficiary_submissions;
CREATE POLICY "Allow authenticated update beneficiary_submissions"
ON public.beneficiary_submissions FOR UPDATE
USING (true)
WITH CHECK (true);

-- SELECT and DELETE are scoped: admins see/manage everything (Admin Submitted
-- Numbers page), everyone else can see their own submission history (the "My
-- Submitted Numbers" panel, matched on their own email) PLUS the status of any
-- number tied to one of their own orders — an agent's failed order can get
-- submitted for approval by the admin, not just by the agent themselves, and
-- they still need to see that status on their own Transactions page. There is
-- no legitimate reason for any non-admin to read someone else's numbers beyond that.
DROP POLICY IF EXISTS "Allow authenticated read beneficiary_submissions" ON public.beneficiary_submissions;
DROP POLICY IF EXISTS "Allow public select beneficiary_submissions" ON public.beneficiary_submissions;
DROP POLICY IF EXISTS "Allow scoped select beneficiary_submissions" ON public.beneficiary_submissions;
CREATE POLICY "Allow scoped select beneficiary_submissions"
ON public.beneficiary_submissions FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin')
  OR submitted_by = (auth.jwt() ->> 'email')
  OR phone_number IN (
    SELECT customer_phone FROM public.orders WHERE agent_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Allow authenticated delete beneficiary_submissions" ON public.beneficiary_submissions;
DROP POLICY IF EXISTS "Allow admin delete beneficiary_submissions" ON public.beneficiary_submissions;
CREATE POLICY "Allow admin delete beneficiary_submissions"
ON public.beneficiary_submissions FOR DELETE
USING ( public.has_role(auth.uid(), 'admin') );

-- Track the raw provider HTTP status for each logged number, so "did we
-- actually reach the provider" is a fact in the row, not a guess.
ALTER TABLE public.beneficiary_submissions
    ADD COLUMN IF NOT EXISTS provider_status_code INTEGER;

-- Collapse any pre-existing duplicate rows for the same number before the
-- unique index is added (keeps the newest row per phone number).
DELETE FROM public.beneficiary_submissions a
USING public.beneficiary_submissions b
WHERE a.phone_number = b.phone_number
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS beneficiary_submissions_phone_number_key
ON public.beneficiary_submissions (phone_number);
