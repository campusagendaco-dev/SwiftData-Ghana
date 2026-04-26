-- HASH API KEYS AT REST
-- Plaintext secrets must never sit in the database. SHA-256 is appropriate
-- here because keys are 128-bit random (brute-force infeasible even without salt).
-- The prefix column preserves fast O(1) lookup without exposing the full key.

-- 1. Add new columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,
  ADD COLUMN IF NOT EXISTS api_key_hash   TEXT;

-- 2. Backfill from existing plaintext keys
UPDATE public.profiles
SET
  api_key_prefix = LEFT(api_key, 12),
  api_key_hash   = encode(sha256(api_key::bytea), 'hex')
WHERE api_key IS NOT NULL
  AND LENGTH(api_key) > 10;

-- 3. Fast index for prefix lookups (replaces the slow LIKE scan)
CREATE INDEX IF NOT EXISTS idx_profiles_api_key_prefix
  ON public.profiles (api_key_prefix)
  WHERE api_key_prefix IS NOT NULL;

-- 4. Erase all plaintext keys
UPDATE public.profiles
  SET api_key = NULL
  WHERE api_key_hash IS NOT NULL;

COMMENT ON COLUMN public.profiles.api_key_prefix IS 'First 12 chars of the API key for fast DB lookup. Non-secret.';
COMMENT ON COLUMN public.profiles.api_key_hash   IS 'SHA-256 hex digest of the API key. Replaces plaintext api_key.';
