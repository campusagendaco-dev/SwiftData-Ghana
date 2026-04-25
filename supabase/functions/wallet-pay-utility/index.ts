import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await req.json().catch(() => null);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200, headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200, headers: corsHeaders });

    const { utility_type, utility_provider, utility_account_number, utility_account_name, amount } = payload;

    if (!utility_type || !utility_provider || !utility_account_number || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 200, headers: corsHeaders });
    }

    const payAmount = Number(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), { status: 200, headers: corsHeaders });
    }

    // Atomic debit
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: payAmount,
    });

    if (debitError || !debitResult?.success) {
      return new Response(JSON.stringify({ 
        error: debitResult?.error || "Wallet debit failed",
        balance: debitResult?.balance 
      }), { status: 200, headers: corsHeaders });
    }

    const orderId = crypto.randomUUID();
    await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "utility",
      utility_type,
      utility_provider,
      utility_account_number,
      utility_account_name,
      amount: payAmount,
      status: "paid",
      failure_reason: "Awaiting manual fulfillment / Token generation"
    });

    console.log("Wallet utility payment created:", orderId, utility_provider, payAmount);

    return new Response(JSON.stringify({ success: true, order_id: orderId, status: "paid" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Wallet utility payment error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: corsHeaders });
  }
});
