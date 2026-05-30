import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";

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

  const payload = await req.json().catch(() => null);
  const rawToken = req.headers.get("x-user-access-token") || (typeof payload?.access_token === "string" ? payload.access_token.trim() : "");
  const authHeader = rawToken ? `Bearer ${rawToken}` : (req.headers.get("Authorization") || null);
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

    const { amount, wallet_credit, callback_url, wallet_type } = payload || {};
    const chargeAmount = Number(amount);
    const creditAmount = Number(wallet_credit || amount);
    const isApiWallet = wallet_type === "api";

    if (!chargeAmount || chargeAmount < 10) {
      return new Response(JSON.stringify({ error: "Minimum top-up amount is GHS 10.00" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch dynamic fee configuration & paystack secret key
    const { data: settings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("paystack_deposit_fee_percent, paystack_secret_key")
      .eq("id", 1)
      .maybeSingle();

    let PAYSTACK_SECRET_KEY = settings?.paystack_secret_key || "";
    if (!PAYSTACK_SECRET_KEY) {
      PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
    }

    if (!PAYSTACK_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Paystack API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const feeRate = Number(settings?.paystack_deposit_fee_percent ?? 0.03);
    const feeCap = 100;
    // Zero fee for API wallet, standard fee for Main wallet
    const calculatedFee = isApiWallet ? 0 : Math.min(creditAmount * feeRate, feeCap);
    const expectedTotal = Number((creditAmount + calculatedFee).toFixed(2));

    if (chargeAmount < expectedTotal - 0.01) {
      return new Response(JSON.stringify({ 
        error: isApiWallet 
          ? `Invalid amount. Expected GHS ${creditAmount.toFixed(2)} (0% Fee).`
          : `Invalid amount. To credit GHS ${creditAmount.toFixed(2)}, you must pay GHS ${expectedTotal.toFixed(2)} (including Paystack fees).` 
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure wallet exists
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("agent_id", user.id)
      .maybeSingle();

    if (!wallet) {
      await supabaseAdmin.from("wallets").insert({ agent_id: user.id, balance: 0 });
    }

    // Create an order record for the top-up (amount = credit amount, fee tracked separately)
    const orderId = crypto.randomUUID();
    const paystackFee = parseFloat((chargeAmount - creditAmount).toFixed(2));
    await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "wallet_topup",
      amount: creditAmount,
      paystack_fee: paystackFee > 0 ? paystackFee : 0,
      profit: 0,
      status: "pending",
      metadata: { wallet_type: isApiWallet ? "api" : "main" }
    });

    // Initialize Paystack payment
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("user_id", user.id)
      .maybeSingle();

    const amountInPesewas = Math.round(chargeAmount * 100);
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: profile?.email || user.email,
        amount: amountInPesewas,
        reference: orderId,
        callback_url: callback_url || undefined,
        metadata: { 
          order_id: orderId, 
          order_type: "wallet_topup", 
          agent_id: user.id, 
          wallet_credit: creditAmount,
          wallet_type: isApiWallet ? "api" : "main" 
        },
        currency: "GHS",
      }),
    });

    const data = await response.json();
    if (!data.status) {
      return new Response(JSON.stringify({ error: data.message || "Payment initialization failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      authorization_url: data.data.authorization_url,
      reference: orderId,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Wallet topup error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
