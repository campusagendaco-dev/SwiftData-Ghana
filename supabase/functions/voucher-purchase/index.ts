import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// SHA-256 hex digest
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Parse request body
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ success: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { VoucherType, Recipient, Quantity } = body;
    const typeUpper = String(VoucherType || "").toUpperCase();

    // 2. Validate input fields
    if (!typeUpper || (typeUpper !== "WASSCE" && typeUpper !== "BECE")) {
      return new Response(JSON.stringify({ success: false, error: "VoucherType is required (WASSCE or BECE)" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const qty = parseInt(Quantity, 10);
    if (isNaN(qty) || qty < 1 || qty > 100) {
      return new Response(JSON.stringify({ success: false, error: "Quantity must be between 1 and 100" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientDigits = String(Recipient || "").replace(/\D+/g, "");
    if (recipientDigits.length !== 10 || !recipientDigits.startsWith("0")) {
      return new Response(JSON.stringify({ success: false, error: "Recipient must be a valid 10-digit phone number starting with 0" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Authenticate User (via Session OR API Key)
    let currentUserId = "";
    const authHeader = req.headers.get("Authorization") || "";
    const apiKeyHeader = req.headers.get("X-API-Key") || "";

    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (!userError && user) {
          currentUserId = user.id;
        }
      }
    }

    if (!currentUserId && apiKeyHeader) {
      const prefix = apiKeyHeader.slice(0, 12);
      const incomingHash = await sha256Hex(apiKeyHeader);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, user_id, api_access_enabled")
        .eq("api_key_prefix", prefix)
        .eq("api_key_hash", incomingHash)
        .maybeSingle();

      if (profile && profile.api_access_enabled) {
        currentUserId = profile.user_id || profile.id;
      }
    }

    if (!currentUserId) {
      return new Response(JSON.stringify({ success: false, error: "Session expired or invalid API key. Please log in again." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve user profile to check for api_test_mode
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, api_test_mode")
      .or(`user_id.eq.${currentUserId},id.eq.${currentUserId}`)
      .maybeSingle();

    const isTest = body.test_mode === true || userProfile?.api_test_mode === true;

    // 4. Resolve dynamic prices from Admin Settings
    const { data: sysSettings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("wassce_price, bece_price, wassce_cost_price, bece_cost_price")
      .eq("id", 1)
      .maybeSingle();

    const userPrice = typeUpper === "WASSCE" 
      ? Number(sysSettings?.wassce_price || 18.00) 
      : Number(sysSettings?.bece_price || 15.00);
    
    const costPrice = typeUpper === "WASSCE" 
      ? Number(sysSettings?.wassce_cost_price || 17.00) 
      : Number(sysSettings?.bece_cost_price || 14.00);

    const totalCost = userPrice * qty;
    const profitValue = (userPrice - costPrice) * qty;

    // 5. Test/Mock Mode Branch (Generate vouchers and save order without debiting wallet)
    if (isTest) {
      console.log(`[Vouchers] SIMULATED purchase (Test Mode) - Total cost: GHS ${totalCost}, Profit: GHS ${profitValue} for user ${currentUserId}`);
      
      const mockVouchers = [];
      for (let i = 0; i < qty; i++) {
        const randomSerial = "TST-" + Array.from({ length: 8 }, () => 
          "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 36)]
        ).join("");
        const randomPin = Array.from({ length: 10 }, () => 
          Math.floor(Math.random() * 10)
        ).join("");
        
        mockVouchers.push({
          serial: randomSerial,
          pin: randomPin,
          type: typeUpper === "WASSCE" ? "WASSCE Results Checker" : "BECE Results Checker",
          price: userPrice,
          purchasedAt: new Date().toISOString(),
        });
      }

      // Save Order and return vouchers successfully
      const orderId = crypto.randomUUID();

      // Find any active provider just to reference in order, or use null
      const { data: providers } = await supabaseAdmin
        .from("providers")
        .select("id")
        .eq("handler_type", "datahub")
        .eq("is_active", true)
        .limit(1);
      const providerId = providers?.[0]?.id || null;

      await supabaseAdmin.from("orders").insert({
        id: orderId,
        agent_id: currentUserId,
        customer_phone: recipientDigits,
        network: "VOUCHER",
        package_size: `${typeUpper} Results Checker x${qty}`,
        amount: totalCost,
        status: "fulfilled",
        provider_id: providerId,
        profit: profitValue,
        failure_reason: null,
        metadata: {
          vouchers: mockVouchers,
          api_response_message: "Mock voucher purchase (Test Mode)",
          test_mode: true
        }
      });

      return new Response(JSON.stringify({
        success: true,
        message: "Voucher purchase completed",
        vouchers: mockVouchers,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. Debit Wallet (Live Mode only)
    console.log(`[Vouchers] Dynamic resolution - Total cost: GHS ${totalCost}, Profit: GHS ${profitValue} for user ${currentUserId}`);
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: currentUserId,
      p_amount: totalCost,
    });

    if (debitError || !debitResult?.success) {
      return new Response(JSON.stringify({ success: false, error: debitResult?.error || "Insufficient wallet balance" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. Fetch Active DataHub API Provider
    const { data: providers } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("handler_type", "datahub")
      .eq("is_active", true)
      .limit(1);

    const provider = providers?.[0];
    if (!provider) {
      // Refund wallet on provider unconfigured
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: currentUserId, p_amount: totalCost });
      return new Response(JSON.stringify({ success: false, error: "Voucher provider currently unavailable. Wallet refunded." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanBaseUrl = provider.base_url.trim().replace(/\/+$/, "");
    const purchaseUrl = `${cleanBaseUrl}/voucher-purchase`;

    console.log(`[Vouchers] Sending purchase request to DataHub: ${purchaseUrl}`);

    // 8. Call DataHub Voucher API
    let response;
    try {
      response = await fetch(purchaseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": provider.api_key,
        },
        body: JSON.stringify({
          VoucherType: typeUpper,
          Recipient: recipientDigits,
          Quantity: qty,
        }),
      });
    } catch (fetchErr: any) {
      console.error("[Vouchers] Network/Fetch error calling provider:", fetchErr);
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: currentUserId, p_amount: totalCost });
      return new Response(JSON.stringify({
        success: false,
        error: "Voucher provider is currently offline or unreachable. Wallet refunded."
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resText = await response.text();
    console.log(`[Vouchers] DataHub response status ${response.status}: ${resText}`);

    // Check if the response is HTTP 5xx or general failure
    if (response.status >= 500) {
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: currentUserId, p_amount: totalCost });
      return new Response(JSON.stringify({
        success: false,
        error: "Voucher provider is currently offline or out of stock. Please try again later."
      }), {
        status: 200, // Return 200 to prevent console error logs for provider/business-level rejections
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let resData;
    try {
      resData = JSON.parse(resText);
    } catch {
      resData = { success: false, error: resText };
    }

    if (response.ok && resData.success) {
      // 9. Save Order and return vouchers successfully
      const orderId = crypto.randomUUID();

      await supabaseAdmin.from("orders").insert({
        id: orderId,
        agent_id: currentUserId,
        customer_phone: recipientDigits,
        network: "VOUCHER",
        package_size: `${typeUpper} Results Checker x${qty}`,
        amount: totalCost,
        status: "fulfilled",
        provider_id: provider.id,
        profit: profitValue,
        failure_reason: null,
        metadata: {
          vouchers: resData.vouchers || [],
          api_response_message: resData.message,
        }
      });

      // Credit profit
      if (profitValue > 0) {
        try {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });
        } catch (e) {
          console.error("[Vouchers] Profit credit failed:", e);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: "Voucher purchase completed",
        vouchers: resData.vouchers || [],
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // 10. Refund Wallet on Provider Rejection
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: currentUserId, p_amount: totalCost });
      
      let errorMsg = resData.error || resData.message || "Failed to complete voucher purchase";
      if (resText.includes("Internal Server Error") || response.status === 500) {
        errorMsg = "Voucher provider is currently offline or out of stock. Please try again later.";
      }

      return new Response(JSON.stringify({ success: false, error: errorMsg }), {
        status: 200, // Return 200 to prevent console error logs for provider/business-level rejections
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (err: any) {
    console.error("[Vouchers] Internal error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message || "Internal server error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
