import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate } from "../_shared/sms.ts";

async function sendWithdrawalSms(supabaseAdmin: any, userId: string, amount: number) {
  try {
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle();
    if (!profile?.phone) return;

    const { apiKey, senderId, templates } = await getSmsConfig(supabaseAdmin);
    const recipient = normalizePhone(profile.phone);
    
    if (!apiKey || !recipient) return;

    const message = formatTemplate(templates.withdrawal_request, {
      amount: amount.toFixed(2)
    });

    await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
  } catch (error) {
    console.error("sendWithdrawalSms error:", error);
  }
}

async function triggerPushNotification(supabaseAdmin: any, payload: { user_id: string; title: string; body: string; url?: string; icon?: string }) {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("[Push Withdraw] Trigger failed:", text);
    }
  } catch (e) {
    console.error("[Push Withdraw] Trigger error:", e);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agentId = user.id;
    const { amount } = await req.json();

    if (!amount || Number(amount) <= 0) {
      return new Response(JSON.stringify({ error: "Invalid withdrawal amount" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify agent or sub-agent
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("momo_number, momo_network, momo_account_name, full_name, is_agent, is_sub_agent, agent_approved, sub_agent_approved")
      .eq("user_id", agentId)
      .maybeSingle();

    const isApprovedAgent = profile?.is_agent && profile?.agent_approved;
    const isApprovedSubAgent = profile?.is_sub_agent && profile?.sub_agent_approved;

    if (!profile || (!isApprovedAgent && !isApprovedSubAgent)) {
      return new Response(JSON.stringify({ error: "Access Denied. You must be an approved agent or sub-agent to withdraw." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile.momo_number || !profile.momo_network) {
      return new Response(JSON.stringify({ error: "MoMo details not configured. Update your settings." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ━━━ NEW: AI Flash Payout Logic ━━━
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("ai_trust_score, auto_credit_limit")
      .eq("agent_id", agentId)
      .single();

    const isFlashEligible = (wallet?.ai_trust_score || 0) > 90 && Number(amount) <= 500;

    // Use atomic RPC to calculate balance and insert withdrawal safely
    const { data: result, error: rpcError } = await supabaseAdmin.rpc("request_withdrawal", {
      p_agent_id: agentId,
      p_amount: amount,
    });

    if (rpcError || !result?.success) {
      if (rpcError) {
        console.error("[Withdrawal RPC Error] Failed database execution:", rpcError);
      }
      const errMsg = rpcError?.message || result?.error || "Withdrawal failed";
      return new Response(JSON.stringify({
        error: errMsg === "Insufficient balance"
          ? `Insufficient balance. Available: GHS ${(result?.available || 0).toFixed(2)}`
          : errMsg,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const withdrawalId = result.withdrawal_id;

    // If Flash Eligible, tag for expedited disbursement rather than prematurely marking fulfilled
    if (isFlashEligible) {
      console.log(`[Flash Payout] Priority flag tagged for withdrawal ${withdrawalId} (Agent trust score: ${wallet?.ai_trust_score})`);
      
      await supabaseAdmin.from("sentinel_actions").insert({
        action_type: 'flash_payout_queue',
        status: 'pending_disbursement',
        effectiveness: 1,
        reasoning: `High-trust agent withdrawal prioritized for fast disbursement (Score: ${wallet?.ai_trust_score})`,
        metadata: { amount, withdrawal_id: withdrawalId, agent_id: agentId }
      });
    }

    await sendWithdrawalSms(supabaseAdmin, agentId, amount);

    // Trigger Push Notification for Withdrawal
    await triggerPushNotification(supabaseAdmin, {
      user_id: agentId,
      title: isFlashEligible ? "⚡ Priority Withdrawal Queued" : "💸 Withdrawal Requested",
      body: isFlashEligible 
        ? `Flash! Your request for GHS ${Number(amount).toFixed(2)} is approved with high-priority dispatch.`
        : `Your request for GHS ${Number(amount).toFixed(2)} has been received and is being processed.`,
      url: "/dashboard/withdrawals",
      icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
    });

    return new Response(JSON.stringify({ 
      success: true, 
      withdrawal_id: withdrawalId,
      is_flash: isFlashEligible 
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


