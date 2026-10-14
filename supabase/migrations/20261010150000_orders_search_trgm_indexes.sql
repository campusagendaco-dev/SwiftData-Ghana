-- Migration: Fast admin order search
-- Admin Orders search runs `ILIKE '%term%'` on customer_phone / customer_name across 100k+ orders.
-- Without trigram indexes these are full table scans that hit the statement timeout under RLS (HTTP 500).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_trgm
  ON public.orders USING gin (customer_phone extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm
  ON public.orders USING gin (customer_name extensions.gin_trgm_ops);

-- The search ORs all four columns; every column must be indexed or Postgres falls back to a seq scan.
CREATE INDEX IF NOT EXISTS idx_orders_network_trgm
  ON public.orders USING gin (network extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_package_size_trgm
  ON public.orders USING gin (package_size extensions.gin_trgm_ops);
