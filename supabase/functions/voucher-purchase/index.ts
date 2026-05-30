import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Dynamic price resolution now performed inside execution handler from database


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
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const qty = parseInt(Quantity, 10);
    if (isNaN(qty) || qty < 1 || qty > 100) {
      return new Response(JSON.stringify({ success: false, error: "Quantity must be between 1 and 100" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientDigits = String(Recipient || "").replace(/\D+/g, "");
    if (recipientDigits.length !== 10 || !recipientDigits.startsWith("0")) {
      return new Response(JSON.stringify({ success: false, error: "Recipient must be a valid 10-digit phone number starting with 0" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Authenticate User (via Session OR API Key)
    let currentUserId = "";
    const authHeader = req.headers.get("Authorization") || "";
    const apiKeyHeader = req.headers.get("X-API-Key") || "";

    if (authHeader.startsWith("Bearer ")) {
      const supabaseUser = createClient(SUPABASE_URL, authHeader.replace("Bearer ", ""));
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (!userError && user) {
        currentUserId = user.id;
      }
    }

    if (!currentUserId && apiKeyHeader) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, api_access_enabled")
        .eq("api_key", apiKeyHeader)
        .maybeSingle();

      if (profile && profile.api_access_enabled) {
        currentUserId = profile.id;
      }
    }

    if (!currentUserId) {
      return new Response(JSON.stringify({ success: false, error: "Invalid session or API key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    console.log(`[Vouchers] Dynamic resolution - Total cost: GHS ${totalCost}, Profit: GHS ${profitValue} for user ${currentUserId}`);
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: currentUserId,
      p_amount: totalCost,
    });

    if (debitError || !debitResult?.success) {
      return new Response(JSON.stringify({ success: false, error: debitResult?.error || "Insufficient balance or wallet error" }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Fetch Active DataHub API Provider
    const { data: providers } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("handler_type", "datahub")
      .eq("is_active", true)
      .limit(1);

    const provider = providers?.[0];
    if (!provider) {
      // Refund wallet on provider unconfigured
      await supabaseAdmin.rpc("debit_wallet", { p_agent_id: currentUserId, p_amount: -totalCost });
      return new Response(JSON.stringify({ success: false, error: "Voucher provider currently unavailable. Wallet refunded." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanBaseUrl = provider.base_url.trim().replace(/\/+$/, "");
    const purchaseUrl = `${cleanBaseUrl}/voucher-purchase`;

    console.log(`[Vouchers] Sending purchase request to DataHub: ${purchaseUrl}`);

    // 6. Call DataHub Voucher API
    const response = await fetch(purchaseUrl, {
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

    const resText = await response.text();
    console.log(`[Vouchers] DataHub response status ${response.status}: ${resText}`);

    let resData;
    try {
      resData = JSON.parse(resText);
    } catch {
      resData = { success: false, error: resText };
    }

    if (response.ok && resData.success) {
      // 7. Save Order and return vouchers successfully
      const orderId = crypto.randomUUID();
      // uses dynamic profitValue calculated earlier


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
      // 8. Refund Wallet on Provider Rejection
      await supabaseAdmin.rpc("debit_wallet", { p_agent_id: currentUserId, p_amount: -totalCost });
      const errorMsg = resData.error || resData.message || "Failed to complete voucher purchase";
      return new Response(JSON.stringify({ success: false, error: errorMsg }), {
        status: response.status === 200 ? 400 : response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (err: any) {
    console.error("[Vouchers] Internal error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
