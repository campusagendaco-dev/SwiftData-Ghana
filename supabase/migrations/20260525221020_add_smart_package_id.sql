-- Add smart package_id to api.v_plans
DROP VIEW IF EXISTS api.v_plans;
CREATE OR REPLACE VIEW api.v_plans AS
SELECT 
  CASE 
    WHEN lower(network) = 'mtn' THEN 'yellow_' || lower(replace(package_size, ' ', ''))
    WHEN lower(network) IN ('airteltigo', 'at', 'at_premium') THEN 'blue_' || lower(replace(package_size, ' ', ''))
    WHEN lower(network) IN ('vodafone', 'telecel') THEN 'red_' || lower(replace(package_size, ' ', ''))
    ELSE lower(network) || '_' || lower(replace(package_size, ' ', ''))
  END AS package_id,
  network,
  package_size,
  agent_price,
  public_price,
  api_price,
  is_unavailable
FROM public.global_package_settings;
