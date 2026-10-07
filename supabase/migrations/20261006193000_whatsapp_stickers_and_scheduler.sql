-- Migration: WhatsApp Stickers Management & Campaign Scheduler Suite
-- Provides table schema for custom sticker library and scheduled WhatsApp channel / customer broadcasts

CREATE TABLE IF NOT EXISTS public.whatsapp_stickers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  webp_url TEXT NOT NULL,
  png_url TEXT,
  trigger_event TEXT DEFAULT 'none', -- order_delivered, payment_received, welcome_morning, none
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'channel', -- 'channel', 'all_customers', 'custom_numbers'
  channel_jid TEXT DEFAULT '120363425720623850@newsletter',
  recipients TEXT[] DEFAULT '{}',
  message TEXT,
  sticker_url TEXT,
  image_url TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'processing', 'completed', 'cancelled', 'failed'
  repeat_frequency TEXT NOT NULL DEFAULT 'none', -- 'none', 'daily_morning', 'daily_evening', 'weekly'
  last_run_at TIMESTAMPTZ,
  result_summary JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wa_stickers_category ON public.whatsapp_stickers(category);
CREATE INDEX IF NOT EXISTS idx_wa_stickers_trigger ON public.whatsapp_stickers(trigger_event);
CREATE INDEX IF NOT EXISTS idx_wa_scheduled_status_time ON public.whatsapp_scheduled_posts(status, scheduled_for ASC);

-- Enable RLS
ALTER TABLE public.whatsapp_stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_scheduled_posts ENABLE ROW LEVEL SECURITY;

-- Policies for whatsapp_stickers
DROP POLICY IF EXISTS "Public and authenticated read whatsapp_stickers" ON public.whatsapp_stickers;
CREATE POLICY "Public and authenticated read whatsapp_stickers"
  ON public.whatsapp_stickers FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Admins manage whatsapp_stickers" ON public.whatsapp_stickers;
CREATE POLICY "Admins manage whatsapp_stickers"
  ON public.whatsapp_stickers FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Policies for whatsapp_scheduled_posts
DROP POLICY IF EXISTS "Admins manage whatsapp_scheduled_posts" ON public.whatsapp_scheduled_posts;
CREATE POLICY "Admins manage whatsapp_scheduled_posts"
  ON public.whatsapp_scheduled_posts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Grants
GRANT SELECT ON public.whatsapp_stickers TO anon, authenticated;
GRANT ALL ON public.whatsapp_stickers TO authenticated, service_role;
GRANT ALL ON public.whatsapp_scheduled_posts TO authenticated, service_role;

-- Pre-populate default sticker library
INSERT INTO public.whatsapp_stickers (name, title, category, webp_url, png_url, trigger_event) VALUES
  ('good_morning', 'Good Morning Sun', 'Greeting', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/good_morning.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/good_morning.png', 'welcome_morning'),
  ('fast_delivery_ongoing', 'Fast Delivery Ongoing', 'Fulfillment', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/fast_delivery_ongoing.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/fast_delivery_ongoing.png', 'order_delivered'),
  ('keep_orders_coming', 'Keep Orders Coming', 'Orders', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/keep_orders_coming.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/keep_orders_coming.png', 'payment_received'),
  ('serving_24_7', '24/7 Serving', 'Support', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/serving_24_7.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/serving_24_7.png', 'welcome_general'),
  ('serving_stacked', 'Serving Brand Stacked', 'Support', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/serving_stacked.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/serving_stacked.png', 'none'),
  ('serving_word', 'Serving Text', 'Support', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/serving_word.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/serving_word.png', 'none'),
  ('trader_buy_sell', 'Trader Buy & Sell', 'Promotions', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/trader_buy_sell.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/trader_buy_sell.png', 'none'),
  ('trader_buy_sell_2', 'Trader Buy & Sell Alternate', 'Promotions', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/trader_buy_sell_2.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/trader_buy_sell_2.png', 'none'),
  ('fire_stickman', 'Fire Stickman', 'Hype', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/fire_stickman.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/fire_stickman.png', 'none'),
  ('fire_warrior', 'Fire Warrior Power', 'Hype', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/fire_warrior.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/fire_warrior.png', 'none'),
  ('alligator_standing', 'Alligator Waiting', 'Reactions', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/alligator_standing.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/alligator_standing.png', 'none'),
  ('baby_drinking', 'Baby Drinking Straw', 'Reactions', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/baby_drinking.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/baby_drinking.png', 'none'),
  ('aki_pawpaw_serious', 'Aki Serious Face', 'Memes', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/aki_pawpaw_serious.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/aki_pawpaw_serious.png', 'none'),
  ('crying_cloth', 'Crying Meme', 'Memes', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/crying_cloth.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/crying_cloth.png', 'none'),
  ('sleeping_baby', 'Sleeping Baby', 'Night Mode', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/sleeping_baby.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/sleeping_baby.png', 'none'),
  ('happy_dog', 'Happy Dog Smile', 'Thank You', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/happy_dog.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/happy_dog.png', 'none'),
  ('man_serious', 'Serious Gentleman', 'Memes', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/man_serious.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/man_serious.png', 'none'),
  ('girl_smiling', 'Girl Smiling', 'Reactions', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/girl_smiling.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/girl_smiling.png', 'none'),
  ('boy_profile', 'Boy Profile Outdoors', 'Reactions', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/boy_profile.webp', 'https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/stickers/boy_profile.png', 'none')
ON CONFLICT (name) DO UPDATE SET
  title = EXCLUDED.title,
  category = EXCLUDED.category,
  webp_url = EXCLUDED.webp_url,
  png_url = EXCLUDED.png_url,
  trigger_event = EXCLUDED.trigger_event,
  updated_at = now();
