import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendPaymentSms } from "../_shared/sms.ts";

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

    const { utility_type, utility_provider, utility_account_number, utility_account_name, amount, lookup_transaction_id } = payload;

    if (!utility_type || !utility_provider || !utility_account_number || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 200, headers: corsHeaders });
    }

    const payAmount = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(payAmount) || payAmount < 1 || payAmount > 50000) {
      return new Response(JSON.stringify({ error: "Invalid amount. Must be between GHS 1.00 and GHS 50,000.00." }), { status: 200, headers: corsHeaders });
    }

    // Whitelist safe utility metadata fields — never spread arbitrary client metadata
    const rawMeta = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {};
    const ALLOWED_META_KEYS = [
      "meter_id",
      "meter_number",
      "meter_type",
      "meter_category",
      "alias",
      "meter_alias",
      "district",
      "region",
      "customer_name",
      "customer_phone",
      "payment_phone",
      "account_name",
      "account_number",
      "phone",
      "reference_note",
    ];
    const safeMeta: Record<string, string | number | boolean> = {};
    for (const k of ALLOWED_META_KEYS) {
      const v = (rawMeta as Record<string, unknown>)[k];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        safeMeta[k] = typeof v === "string" ? v.slice(0, 200) : v;
      }
    }

    // Fetch user's phone for SMS/WhatsApp token delivery and GWCL customer_number
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("user_id", user.id).maybeSingle();
    const notificationPhone = String(safeMeta.phone || safeMeta.customer_phone || profile?.phone || user.phone || "").trim();

    // Atomic debit
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: payAmount,
    });

    if (debitError || !debitResult?.success) {
      return new Response(JSON.stringify({ 
        error: debitResult?.error || "Wallet debit failed",
        balance: debitResult?.balance 
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orderId = crypto.randomUUID();
    const { error: insertError } = await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "utility",
      network: utility_provider,
      customer_phone: notificationPhone || utility_account_number,
      utility_type,
      utility_provider,
      utility_account_number,
      utility_account_name,
      amount: payAmount,
      status: "paid",
      payment_method: "wallet",
      failure_reason: null,
      metadata: {
        ...safeMeta,
        ...(notificationPhone ? { phone: notificationPhone } : {}),
        base_price: payAmount,
        lookup_transaction_id,
      }
    });

    if (insertError) {
      console.error("[wallet-pay-utility] Order insert failed, refunding wallet:", insertError);
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: payAmount });
      return new Response(JSON.stringify({ error: "Failed to record utility order. Your wallet has been refunded." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trigger verify-payment asynchronously via EdgeRuntime.waitUntil so utility payment returns instantly (<200ms)
    const verifyPaymentUrl = `${SUPABASE_URL}/functions/v1/verify-payment`;
    const triggerPromise = fetch(verifyPaymentUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ reference: orderId }),
    }).then(() => console.log(`[VERIFY-TRIGGER-SUCCESS] verify-payment triggered for order ${orderId}`))
      .catch(e => console.error("[VERIFY-TRIGGER-ERROR]", e));

    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
      (globalThis as any).EdgeRuntime.waitUntil(triggerPromise);
    }
    
    // Send notification
    if (notificationPhone) {
      await sendPaymentSms(supabaseAdmin, notificationPhone, "utility_paid", {
        utility_type,
        account: utility_account_number,
      }, user.id);
    }

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
