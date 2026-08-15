-- Migration to fix beneficiary_submissions user_id linkage and case-insensitive RLS policy

ALTER TABLE public.beneficiary_submissions
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_beneficiary_submissions_user_id ON public.beneficiary_submissions(user_id);

-- Backfill user_id on existing beneficiary_submissions rows matching auth.users email
UPDATE public.beneficiary_submissions bs
SET user_id = u.id
FROM auth.users u
WHERE bs.user_id IS NULL
  AND LOWER(bs.submitted_by) = LOWER(u.email);

-- Update RLS SELECT policy
DROP POLICY IF EXISTS "Allow scoped select beneficiary_submissions" ON public.beneficiary_submissions;
DROP POLICY IF EXISTS "Allow authenticated read beneficiary_submissions" ON public.beneficiary_submissions;
DROP POLICY IF EXISTS "Allow public select beneficiary_submissions" ON public.beneficiary_submissions;

CREATE POLICY "Allow scoped select beneficiary_submissions"
ON public.beneficiary_submissions FOR SELECT
USING (
  public.has_role(auth.uid(), 'admin')
  OR user_id = auth.uid()
  OR LOWER(submitted_by) = LOWER(auth.jwt() ->> 'email')
  OR phone_number IN (
    SELECT customer_phone FROM public.orders WHERE agent_id = auth.uid()
  )
);

-- Update RLS UPDATE policy
DROP POLICY IF EXISTS "Allow authenticated update beneficiary_submissions" ON public.beneficiary_submissions;

CREATE POLICY "Allow authenticated update beneficiary_submissions"
ON public.beneficiary_submissions FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin')
  OR user_id = auth.uid()
  OR LOWER(submitted_by) = LOWER(auth.jwt() ->> 'email')
)
WITH CHECK (true);
