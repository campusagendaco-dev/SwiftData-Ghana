-- Franchise Enhancements: N-Level MLM, Custom Domains, Auto-Float Bridging

-- 1. Add fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS agent_path TEXT,
ADD COLUMN IF NOT EXISTS auto_bridge_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_bridge_threshold NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS auto_bridge_amount NUMERIC DEFAULT 0;

-- 2. Create RPC for processing auto-bridges
CREATE OR REPLACE FUNCTION public.process_auto_bridges_for_agent(p_sub_agent_id UUID)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_master_id UUID;
  v_enabled BOOLEAN;
  v_threshold NUMERIC;
  v_amount NUMERIC;
  v_sub_balance NUMERIC;
  v_master_balance NUMERIC;
  v_result json;
BEGIN
  -- Get sub-agent profile settings
  SELECT parent_agent_id, auto_bridge_enabled, auto_bridge_threshold, auto_bridge_amount
  INTO v_master_id, v_enabled, v_threshold, v_amount
  FROM public.profiles
  WHERE user_id = p_sub_agent_id AND is_sub_agent = true;

  -- If not enabled or no parent, exit
  IF NOT v_enabled OR v_master_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Auto-bridge not enabled or no master agent');
  END IF;

  -- Get sub-agent wallet balance
  SELECT balance INTO v_sub_balance
  FROM public.wallets
  WHERE agent_id = p_sub_agent_id;

  -- Check if below threshold
  IF v_sub_balance >= v_threshold THEN
    RETURN json_build_object('success', false, 'message', 'Balance above threshold');
  END IF;

  -- Get master agent wallet balance
  SELECT balance INTO v_master_balance
  FROM public.wallets
  WHERE agent_id = v_master_id;

  -- Check if master has enough funds
  IF v_master_balance < v_amount THEN
    RETURN json_build_object('success', false, 'message', 'Master agent has insufficient funds for auto-bridge');
  END IF;

  -- Call the existing float transfer RPC
  -- This transfers float and creates the necessary transactions/notifications
  SELECT public.transfer_float_to_subagent(v_master_id, p_sub_agent_id, v_amount)
  INTO v_result;

  RETURN v_result;
END;
$$;
