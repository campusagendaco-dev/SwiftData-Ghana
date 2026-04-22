-- Create Promo Codes Table
CREATE TABLE IF NOT EXISTS promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    discount_percentage DECIMAL NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
    max_uses INT NOT NULL DEFAULT 100,
    current_uses INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Support Tickets Table
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    admin_response TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add advanced API settings to system_settings if they don't exist
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS paystack_secret_key TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS hubtel_client_id TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS hubtel_client_secret TEXT;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS mtn_markup_percentage DECIMAL DEFAULT 0;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS telecel_markup_percentage DECIMAL DEFAULT 0;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS at_markup_percentage DECIMAL DEFAULT 0;

-- RLS Policies
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Admins can do everything on promo codes. Users can only read active ones.
CREATE POLICY "Admins manage promo codes" ON promo_codes FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users can view active promo codes" ON promo_codes FOR SELECT USING (is_active = true);

-- Admins manage all tickets. Users manage their own.
CREATE POLICY "Admins view all tickets" ON support_tickets FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users view own tickets" ON support_tickets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users create own tickets" ON support_tickets FOR INSERT WITH CHECK (user_id = auth.uid());

-- Only admins can read/write audit logs
CREATE POLICY "Admins manage audit logs" ON audit_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
