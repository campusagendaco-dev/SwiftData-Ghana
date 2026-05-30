import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: sysSettings } = await supabase
      .from("v_system_settings_with_secrets").select("disable_ordering, holiday_message").eq("id", 1).maybeSingle();
    if (sysSettings?.disable_ordering) {
      return new Response(JSON.stringify({
        error: sysSettings.holiday_message || "Ordering is currently disabled.",
        success: false
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = await req.json().catch(() => null);
    const promoCode = typeof payload?.promo_code === "string" ? payload.promo_code.trim().toUpperCase() : "";
    const phone = typeof payload?.phone === "string" ? payload.phone.replace(/\D+/g, "") : "";
    const network = typeof payload?.network === "string" ? payload.network.trim() : "";
    const packageSize = typeof payload?.package_size === "string" ? payload.package_size.trim() : "";

    if (!promoCode || !phone || !network || !packageSize) {
      return new Response(JSON.stringify({ error: "Missing required fields", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validPhone = phone.length >= 9 && phone.length <= 12;
    if (!validPhone) {
      return new Response(JSON.stringify({ error: "Invalid phone number", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atomically claim the promo code
    const { data: claimRows, error: claimError } = await supabase.rpc("claim_promo_code", {
      p_code: promoCode,
      p_phone: phone,
    });

    if (claimError || !claimRows || claimRows.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid or already claimed promo code", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimResult = claimRows[0] as { promo_id: string; discount_percentage: number; is_free: boolean };

    if (!claimResult.is_free) {
      return new Response(JSON.stringify({ error: "This code is for discounts, not free data", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch original price for tracking
    const { data: pkgRow } = await supabase
      .from("global_package_settings")
      .select("public_price, agent_price")
      .eq("network", network)
      .eq("package_size", packageSize.replace(/\s+/g, "").toUpperCase())
      .maybeSingle();

    const originalPrice = Number(pkgRow?.public_price) || Number(pkgRow?.agent_price) || 0;

    // Create order record
    const orderId = crypto.randomUUID();
    await supabase.from("orders").insert({
      id: orderId,
      order_type: "free_data_claim",
      payment_method: "promo",
      network,
      package_size: packageSize,
      customer_phone: phone,
      amount: 0,
      profit: 0,
      status: "paid",
      promo_code_id: claimResult.promo_id,
      discount_amount: originalPrice,
    });

    // Update claim with order_id
    await supabase.from("promo_claims").update({ order_id: orderId }).eq("promo_code_id", claimResult.promo_id).eq("claimed_by_phone", phone);

    // DELEGATE fulfillment to verify-payment for standard provider logic
    try {
      const fulfillRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({ reference: orderId }),
      });
      const fulfillData = await fulfillRes.json();

      if (fulfillData.status === "fulfilled" || fulfillData.status === "processing") {
        return new Response(JSON.stringify({ success: true, order_id: orderId, status: fulfillData.status }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: false,
        order_id: orderId,
        error: fulfillData.reason || fulfillData.error || "Fulfillment failed. Contact support."
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (e) {
      console.error("Fulfillment trigger error:", e);
      return new Response(JSON.stringify({
        success: false,
        order_id: orderId,
        error: "Claim recorded but fulfillment failed to start. Contact support."
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

  } catch (err) {
    console.error("claim-free-data error:", err);
    return new Response(JSON.stringify({ error: "Internal server error", success: false }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
