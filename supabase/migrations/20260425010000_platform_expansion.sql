-- Phase 2: Platform Expansion - Database Migration

-- 1. Utility Bill Payments
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utility_type TEXT; -- 'electricity', 'water', 'tv'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utility_provider TEXT; -- 'ECG', 'GWCL', 'DSTV', etc.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utility_account_number TEXT; -- Meter No or Smartcard No
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utility_account_name TEXT;

-- 2. Airtime-to-Cash
CREATE TABLE IF NOT EXISTS airtime_to_cash_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    network TEXT NOT NULL,
    amount DECIMAL(12,2) NOT NULL, -- The airtime amount sent
    cash_value DECIMAL(12,2) NOT NULL, -- The value to be added to wallet (after fee)
    sender_phone TEXT NOT NULL,
    reference_code TEXT, -- Any transaction ID provided by the network
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE airtime_to_cash_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view and create their own airtime requests"
    ON airtime_to_cash_requests
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 3. In-App Support Chat
CREATE TABLE IF NOT EXISTS support_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    last_message TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    unread_count_admin INTEGER DEFAULT 0,
    unread_count_user INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view and manage their own conversations"
    ON support_conversations
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view and send messages in their conversations"
    ON support_messages
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM support_conversations 
            WHERE id = support_messages.conversation_id 
            AND user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM support_conversations 
            WHERE id = support_messages.conversation_id 
            AND user_id = auth.uid()
        )
    );

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE support_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE support_messages;
