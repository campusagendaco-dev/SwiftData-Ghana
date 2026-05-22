-- 1. Add vendor status & KYC fields to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_status TEXT NOT NULL DEFAULT 'inactive';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_national_id_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_business_cert_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_registration_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_tin TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_kyc_api_response JSONB;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_rejection_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_kyc_submitted_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_activated_at TIMESTAMPTZ;

-- 2. Create kyc-documents storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('kyc-documents', 'kyc-documents', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Set up Storage RLS Policies for kyc-documents
DROP POLICY IF EXISTS "Public Read KYC Docs" ON storage.objects;
CREATE POLICY "Public Read KYC Docs" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'kyc-documents');

DROP POLICY IF EXISTS "Authenticated Upload KYC Docs" ON storage.objects;
CREATE POLICY "Authenticated Upload KYC Docs" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'kyc-documents');

DROP POLICY IF EXISTS "Owner Manage KYC Docs" ON storage.objects;
CREATE POLICY "Owner Manage KYC Docs" ON storage.objects
    FOR ALL TO authenticated USING (bucket_id = 'kyc-documents' AND auth.uid() = owner);
