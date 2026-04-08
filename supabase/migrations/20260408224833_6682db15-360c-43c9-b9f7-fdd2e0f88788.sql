
-- 1. Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- 2. Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Create has_role security definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4. user_roles RLS
CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp_number TEXT NOT NULL DEFAULT '',
  support_number TEXT NOT NULL DEFAULT '',
  store_name TEXT NOT NULL DEFAULT '',
  whatsapp_group_link TEXT,
  slug TEXT UNIQUE,
  momo_number TEXT NOT NULL DEFAULT '',
  momo_network TEXT NOT NULL DEFAULT '',
  momo_account_name TEXT NOT NULL DEFAULT '',
  markups JSONB NOT NULL DEFAULT '{}',
  agent_prices JSONB NOT NULL DEFAULT '{}',
  disabled_packages JSONB NOT NULL DEFAULT '{}',
  is_agent BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  agent_approved BOOLEAN NOT NULL DEFAULT FALSE,
  topup_reference TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Allow public read of agent profiles for store pages
CREATE POLICY "Public can view agent store profiles" ON public.profiles
  FOR SELECT TO anon
  USING (is_agent = true AND onboarding_complete = true AND agent_approved = true);

-- 6. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Auto-generate topup reference
CREATE OR REPLACE FUNCTION public.generate_topup_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref TEXT;
  attempts INT := 0;
BEGIN
  IF NEW.topup_reference IS NULL THEN
    LOOP
      ref := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE topup_reference = ref);
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique topup reference';
      END IF;
    END LOOP;
    NEW.topup_reference := ref;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_topup_reference
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_topup_reference();

-- 8. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Wallets table
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wallet" ON public.wallets
  FOR SELECT TO authenticated USING (auth.uid() = agent_id);

CREATE POLICY "Admins can view all wallets" ON public.wallets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert wallets" ON public.wallets
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all wallets" ON public.wallets
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Service role / edge functions can also manage wallets
CREATE POLICY "Service role wallet access" ON public.wallets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10. Orders table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  order_type TEXT NOT NULL DEFAULT 'data',
  customer_phone TEXT,
  network TEXT,
  package_size TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  profit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  afa_full_name TEXT,
  afa_ghana_card TEXT,
  afa_occupation TEXT,
  afa_email TEXT,
  afa_residence TEXT,
  afa_date_of_birth TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can insert orders for public purchases
CREATE POLICY "Anyone can create orders" ON public.orders
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Users can view own orders" ON public.orders
  FOR SELECT TO authenticated USING (auth.uid()::text = agent_id::text);

CREATE POLICY "Admins can view all orders" ON public.orders
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update orders" ON public.orders
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Anon can view their order by ID (for order status page)
CREATE POLICY "Anon can view orders by id" ON public.orders
  FOR SELECT TO anon USING (true);

CREATE POLICY "Service role order access" ON public.orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11. Withdrawals table
CREATE TABLE public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own withdrawals" ON public.withdrawals
  FOR SELECT TO authenticated USING (auth.uid() = agent_id);

CREATE POLICY "Users can create own withdrawals" ON public.withdrawals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Admins can view all withdrawals" ON public.withdrawals
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update withdrawals" ON public.withdrawals
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role withdrawal access" ON public.withdrawals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_withdrawals_updated_at
  BEFORE UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 12. Notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'all',
  target_user_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view notifications" ON public.notifications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can create notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete notifications" ON public.notifications
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 13. Notification dismissals
CREATE TABLE public.notification_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES public.notifications(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notification_id, user_id)
);
ALTER TABLE public.notification_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dismissals" ON public.notification_dismissals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can create own dismissals" ON public.notification_dismissals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 14. Global package settings
CREATE TABLE public.global_package_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network TEXT NOT NULL,
  package_size TEXT NOT NULL,
  agent_price NUMERIC(12, 2),
  public_price NUMERIC(12, 2),
  is_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (network, package_size)
);
ALTER TABLE public.global_package_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read package settings" ON public.global_package_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins can manage package settings" ON public.global_package_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_global_package_settings_updated_at
  BEFORE UPDATE ON public.global_package_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 15. System settings (singleton)
CREATE TABLE public.system_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_api_switch BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_provider TEXT NOT NULL DEFAULT 'primary',
  backup_provider TEXT NOT NULL DEFAULT 'secondary',
  holiday_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  holiday_message TEXT NOT NULL DEFAULT 'Holiday mode is active. Orders will resume soon.',
  disable_ordering BOOLEAN NOT NULL DEFAULT FALSE,
  dark_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  customer_service_number TEXT NOT NULL DEFAULT '+233203256540',
  support_channel_link TEXT NOT NULL DEFAULT 'https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read system settings" ON public.system_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins can manage system settings" ON public.system_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role system settings access" ON public.system_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Insert default row
INSERT INTO public.system_settings (id) VALUES (1);

CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 16. Maintenance settings (singleton)
CREATE TABLE public.maintenance_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT NOT NULL DEFAULT 'We are performing scheduled maintenance. Please check back soon.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read maintenance settings" ON public.maintenance_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins can manage maintenance settings" ON public.maintenance_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role maintenance access" ON public.maintenance_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.maintenance_settings (id) VALUES (1);

CREATE TRIGGER update_maintenance_settings_updated_at
  BEFORE UPDATE ON public.maintenance_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 17. Enable realtime for orders
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
