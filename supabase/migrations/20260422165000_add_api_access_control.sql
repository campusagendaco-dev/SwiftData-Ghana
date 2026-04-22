-- Add API access control columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_access_enabled BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS api_rate_limit INT DEFAULT 30;

-- Comment for clarity
COMMENT ON COLUMN profiles.api_access_enabled IS 'Admin-controlled toggle to enable/disable API access per user.';
COMMENT ON COLUMN profiles.api_rate_limit IS 'Max requests per minute allowed for this user via API.';
