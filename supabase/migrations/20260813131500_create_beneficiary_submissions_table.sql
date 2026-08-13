-- Create beneficiary_submissions table if not exists
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

-- Enable Row Level Security
ALTER TABLE public.beneficiary_submissions ENABLE ROW LEVEL SECURITY;

-- Allow insert from anon / public web users and Edge Functions
CREATE POLICY "Allow public insert to beneficiary_submissions"
ON public.beneficiary_submissions FOR INSERT
WITH CHECK (true);

-- Allow reading all records for authenticated users and admins
CREATE POLICY "Allow authenticated read beneficiary_submissions"
ON public.beneficiary_submissions FOR SELECT
USING (true);

-- Allow public select for admin dashboard queries
CREATE POLICY "Allow public select beneficiary_submissions"
ON public.beneficiary_submissions FOR SELECT
USING (true);

-- Allow updates for admins
CREATE POLICY "Allow authenticated update beneficiary_submissions"
ON public.beneficiary_submissions FOR UPDATE
USING (true);

-- Allow deletion for admins
CREATE POLICY "Allow authenticated delete beneficiary_submissions"
ON public.beneficiary_submissions FOR DELETE
USING (true);
