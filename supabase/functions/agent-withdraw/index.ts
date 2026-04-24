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
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
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

    if (!amount || amount < 25) {
      return new Response(JSON.stringify({ error: "Minimum withdrawal amount is GHS 25.00" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify agent
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("momo_number, momo_network, momo_account_name, full_name, is_agent, agent_approved")
      .eq("user_id", agentId)
      .maybeSingle();

    if (!profile || !profile.is_agent || !profile.agent_approved) {
      return new Response(JSON.stringify({ error: "Agent not found or not approved" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile.momo_number || !profile.momo_network) {
      return new Response(JSON.stringify({ error: "MoMo details not configured. Update your settings." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use atomic RPC to calculate balance and insert withdrawal safely
    const { data: result, error: rpcError } = await supabaseAdmin.rpc("request_withdrawal", {
      p_agent_id: agentId,
      p_amount: amount,
    });

    if (rpcError || !result?.success) {
      const errMsg = result?.error || "Withdrawal failed";
      return new Response(JSON.stringify({
        error: errMsg === "Insufficient balance"
          ? `Insufficient balance. Available: GHS ${(result?.available || 0).toFixed(2)}`
          : errMsg,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await sendWithdrawalSms(supabaseAdmin, agentId, amount);

    return new Response(JSON.stringify({ success: true, withdrawal_id: result.withdrawal_id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


