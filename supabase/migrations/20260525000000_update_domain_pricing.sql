-- Update domain retail prices in GHS to ensure profitability
-- based on GoDaddy wholesale rates.

UPDATE public.domain_pricing SET sale_price_ghs = 250.00 WHERE tld = '.com';
UPDATE public.domain_pricing SET sale_price_ghs = 280.00 WHERE tld = '.net';
UPDATE public.domain_pricing SET sale_price_ghs = 290.00 WHERE tld = '.org';
UPDATE public.domain_pricing SET sale_price_ghs = 120.00 WHERE tld = '.shop';
UPDATE public.domain_pricing SET sale_price_ghs = 80.00 WHERE tld = '.xyz';
