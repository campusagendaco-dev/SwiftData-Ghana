-- Add WATI WhatsApp configuration columns to system_settings
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS wati_token    text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS wati_endpoint text DEFAULT '' NOT NULL;

-- Update with provided default WATI credentials
UPDATE public.system_settings
SET 
  wati_token = 'wati_ea74c4f2-6576-4843-83ce-80e77dcdbf36.-GT_zdfVSBt0CfBNqHYobLUcpKiOcCSPMtbL9_anZ2YWg48Xp3WxJno6plOTJT370pLCoiOKKZD_7XFd-TvHtIf7Q1ZUNKPxeiCp7nLRJ8hsCvB04SpGNeQtnh11x3la',
  wati_endpoint = 'https://live-mt-server.wati.io/10263110'
WHERE id = 1;
