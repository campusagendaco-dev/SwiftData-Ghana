-- Run this in Supabase SQL Editor to fix "Package price is not configured"
INSERT INTO public.global_package_settings (network, package_size, agent_price, public_price, is_unavailable)
VALUES
  -- MTN
  ('MTN','1GB',4.45,4.98,false),
  ('MTN','2GB',8.90,9.97,false),
  ('MTN','3GB',13.10,14.67,false),
  ('MTN','4GB',17.30,19.38,false),
  ('MTN','5GB',21.20,23.74,false),
  ('MTN','6GB',25.70,28.78,false),
  ('MTN','7GB',29.60,33.15,false),
  ('MTN','8GB',33.20,37.18,false),
  ('MTN','10GB',42.50,47.60,false),
  ('MTN','15GB',62.00,69.44,false),
  ('MTN','20GB',80.20,89.82,false),
  ('MTN','25GB',100.80,112.90,false),
  ('MTN','30GB',124.00,138.88,false),
  ('MTN','40GB',159.00,178.08,false),
  ('MTN','50GB',199.30,223.22,false),
  ('MTN','100GB',385.00,431.20,false),
  -- Telecel
  ('Telecel','5GB',23.00,25.76,false),
  ('Telecel','10GB',41.80,46.82,false),
  ('Telecel','12GB',49.00,54.88,false),
  ('Telecel','15GB',58.99,66.07,false),
  ('Telecel','18GB',71.80,80.42,false),
  ('Telecel','20GB',78.50,87.92,false),
  ('Telecel','22GB',82.50,92.40,false),
  ('Telecel','25GB',102.00,114.24,false),
  ('Telecel','30GB',125.50,140.56,false),
  ('Telecel','40GB',166.00,185.92,false),
  ('Telecel','50GB',190.00,212.80,false),
  -- AirtelTigo
  ('AirtelTigo','1GB',4.30,4.82,false),
  ('AirtelTigo','2GB',8.20,9.18,false),
  ('AirtelTigo','3GB',12.00,13.44,false),
  ('AirtelTigo','4GB',15.80,17.70,false),
  ('AirtelTigo','5GB',19.85,22.23,false),
  ('AirtelTigo','6GB',23.49,26.31,false),
  ('AirtelTigo','7GB',27.00,30.24,false),
  ('AirtelTigo','8GB',30.59,34.26,false),
  ('AirtelTigo','9GB',34.20,38.30,false)
ON CONFLICT (network, package_size)
DO UPDATE SET
  agent_price    = EXCLUDED.agent_price,
  public_price   = EXCLUDED.public_price,
  is_unavailable = EXCLUDED.is_unavailable,
  updated_at     = now();
