import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
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

    // Only count profit from fulfilled orders — paid/failed orders have not delivered service
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("profit")
      .eq("agent_id", agentId)
      .in("status", ["fulfilled"]);

    const totalProfit = (orders || []).reduce((sum: number, o: any) => sum + (Number(o.profit) || 0), 0);

    const { data: withdrawals } = await supabaseAdmin
      .from("withdrawals")
      .select("amount, status")
      .eq("agent_id", agentId)
      .in("status", ["completed", "pending", "processing"]);

    const totalWithdrawn = (withdrawals || []).reduce((sum: number, w: any) => sum + (w.amount || 0), 0);
    const availableBalance = parseFloat((totalProfit - totalWithdrawn).toFixed(2));

    if (amount > availableBalance) {
      return new Response(JSON.stringify({ error: `Insufficient balance. Available: GHS ${availableBalance.toFixed(2)}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create pending withdrawal request (admin will confirm manually)
    const withdrawalId = crypto.randomUUID();
    await supabaseAdmin.from("withdrawals").insert({
      id: withdrawalId,
      agent_id: agentId,
      amount,
      status: "pending",
    });

    return new Response(JSON.stringify({ success: true, withdrawal_id: withdrawalId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


