-- Backfill slugs for agents who don't have one
UPDATE profiles
SET slug = LOWER(REPLACE(REPLACE(REPLACE(store_name, ' ', '-'), '&', 'and'), '''', '')) || '-' || SUBSTRING(user_id::text, 1, 4)
WHERE (is_agent = true OR agent_approved = true)
  AND (slug IS NULL OR slug = '')
  AND store_name IS NOT NULL;

-- If store_name is also null, use their full_name
UPDATE profiles
SET slug = LOWER(REPLACE(REPLACE(REPLACE(full_name, ' ', '-'), '&', 'and'), '''', '')) || '-' || SUBSTRING(user_id::text, 1, 4)
WHERE (is_agent = true OR agent_approved = true)
  AND (slug IS NULL OR slug = '')
  AND full_name IS NOT NULL;

-- Final fallback using just user_id if needed
UPDATE profiles
SET slug = 'agent-' || SUBSTRING(user_id::text, 1, 8)
WHERE (is_agent = true OR agent_approved = true)
  AND (slug IS NULL OR slug = '');

-- Ensure store_name is not null for agents
UPDATE profiles
SET store_name = full_name || ' Store'
WHERE (is_agent = true OR agent_approved = true)
  AND (store_name IS NULL OR store_name = '');
