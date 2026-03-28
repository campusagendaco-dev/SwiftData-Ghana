
-- Add slug column for clean store URLs
ALTER TABLE public.profiles ADD COLUMN slug TEXT UNIQUE;

-- Add markup column (JSON storing per-network markup amounts)
ALTER TABLE public.profiles ADD COLUMN markups JSONB NOT NULL DEFAULT '{"MTN": "2.00", "Telecel": "2.50", "AirtelTigo": "1.50"}';

-- Allow public read access to agent store profiles (only agents with completed onboarding)
CREATE POLICY "Public can view agent stores"
ON public.profiles FOR SELECT
USING (is_agent = true AND onboarding_complete = true);
