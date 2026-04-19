import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSTACK_FEE_RATE = 0.0195;
const PAYSTACK_FEE_CAP = 100;

function amountMatches(expected: number, actual: number, tolerance = 0.05): boolean {
  return Math.abs(expected - actual) <= tolerance;
}

function calculatePaystackFee(amount: number): number {
  return Math.min(amount * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);
}

function normalizeNetwork(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AT" || normalized === "AIRTELTIGO" || normalized === "AIRTEL TIGO") return "AirtelTigo";
  if (normalized === "VODAFONE") return "Telecel";
  if (normalized === "TELECEL") return "Telecel";
  return "MTN";
}

function hasValidAgentId(agentId: unknown): agentId is string {
  return typeof agentId === "string" && agentId.length > 0 && agentId !== "00000000-0000-0000-0000-000000000000";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!PAYSTACK_SECRET_KEY) {
    console.error("PAYSTACK_SECRET_KEY is not configured");
    return new Response(JSON.stringify({ error: "Paystack not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Validate key type — must be a secret key
  if (PAYSTACK_SECRET_KEY.startsWith("pk_")) {
    console.error("PAYSTACK_SECRET_KEY contains a public key instead of secret key");
    return new Response(JSON.stringify({ error: "Invalid Paystack key configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("holiday_mode_enabled, holiday_message, disable_ordering")
      .eq("id", 1)
      .maybeSingle();

    if (settings?.disable_ordering) {
      // Read order type from body to decide whether to bypass — parse body early
      let earlyOrderType = "data";
      try {
        const earlyBody = await req.clone().json();
        earlyOrderType = earlyBody?.metadata?.order_type || "data";
      } catch { /* ignore */ }
      const bypassTypes = ["agent_activation", "sub_agent_activation", "wallet_topup"];
      if (!bypassTypes.includes(earlyOrderType)) {
        return new Response(JSON.stringify({
          error: settings.holiday_message || "Ordering is currently disabled. Please try again later.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const payload = await req.json();
    const email = typeof payload?.email === "string" ? payload.email.trim() : "";
    const amount = Number(payload?.amount);
    const reference = typeof payload?.reference === "string" ? payload.reference.trim() : "";
    const callback_url = payload?.callback_url;
    const metadata = payload?.metadata || {};

    if (!email || !reference || !Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side order creation — don't trust frontend to create orders
    const orderType = metadata.order_type || "data";
    const agentId = metadata.agent_id || "00000000-0000-0000-0000-000000000000";
    const isAgentLinkedOrder = hasValidAgentId(agentId);

    const { data: providerSettings } = await supabaseAdmin
      .from("system_settings")
      .select("preferred_provider")
      .eq("id", 1)
      .maybeSingle();
    const priceMultiplier = providerSettings?.preferred_provider === "secondary" ? 1.0811 : 1;

    if (orderType === "data") {
      const network = typeof metadata.network === "string" ? metadata.network : "";
      const packageSize = typeof metadata.package_size === "string" ? metadata.package_size : "";
      if (!network || !packageSize) {
        return new Response(JSON.stringify({ error: "Missing data order metadata" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const normalizedNetwork = normalizeNetwork(network);
      const normalizedPackage = packageSize.replace(/\s+/g, "").toUpperCase();
      let basePrice = 0;

      if (isAgentLinkedOrder) {
        const { data: agentProfile } = await supabaseAdmin
          .from("profiles")
          .select("agent_prices")
          .eq("user_id", agentId)
          .maybeSingle();

        const agentPrices = (agentProfile?.agent_prices || {}) as Record<string, Record<string, string | number>>;
        const candidates = [normalizedPackage, packageSize, packageSize.replace(/\s+/g, "")];
        const byNetwork = agentPrices[normalizedNetwork] || agentPrices[network] || null;
        if (byNetwork && typeof byNetwork === "object") {
          for (const candidate of candidates) {
            const value = Number(byNetwork[candidate]);
            if (Number.isFinite(value) && value > 0) {
              basePrice = value;
              break;
            }
          }
        }

        if (!(Number.isFinite(basePrice) && basePrice > 0)) {
          const { data: globalRow } = await supabaseAdmin
            .from("global_package_settings")
            .select("agent_price")
            .eq("network", normalizedNetwork)
            .eq("package_size", normalizedPackage)
            .maybeSingle();
          const fallback = Number(globalRow?.agent_price);
          if (Number.isFinite(fallback) && fallback > 0) basePrice = fallback;
        }
      } else {
        const { data: globalRow } = await supabaseAdmin
          .from("global_package_settings")
          .select("public_price")
          .eq("network", normalizedNetwork)
          .eq("package_size", normalizedPackage)
          .maybeSingle();
        const fallback = Number(globalRow?.public_price);
        if (Number.isFinite(fallback) && fallback > 0) basePrice = fallback;
      }

      if (!(Number.isFinite(basePrice) && basePrice > 0)) {
        return new Response(JSON.stringify({ error: "Package price is not configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adjustedBase = Number((basePrice * priceMultiplier).toFixed(2));
      const expectedTotal = Number((adjustedBase + calculatePaystackFee(adjustedBase)).toFixed(2));
      if (!amountMatches(expectedTotal, amount)) {
        return new Response(JSON.stringify({
          error: `Invalid amount for ${network} ${packageSize}. Expected GHS ${expectedTotal.toFixed(2)}.`,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (orderType === "afa") {
      const { data: afaSetting } = await supabaseAdmin
        .from("global_package_settings")
        .select("agent_price, public_price")
        .eq("network", "AFA")
        .eq("package_size", "BUNDLE")
        .maybeSingle();

      const baseAfa = Number(
        isAgentLinkedOrder
          ? (afaSetting?.agent_price ?? afaSetting?.public_price ?? 0)
          : (afaSetting?.public_price ?? afaSetting?.agent_price ?? 0),
      );
      if (Number.isFinite(baseAfa) && baseAfa > 0) {
        const adjustedBase = Number((baseAfa * priceMultiplier).toFixed(2));
        const expectedTotal = Number((adjustedBase + calculatePaystackFee(adjustedBase)).toFixed(2));
        if (!amountMatches(expectedTotal, amount)) {
          return new Response(JSON.stringify({
            error: `Invalid AFA amount. Expected GHS ${expectedTotal.toFixed(2)}.`,
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (orderType === "wallet_topup") {
      const walletCredit = Number(metadata.wallet_credit);
      if (!Number.isFinite(walletCredit) || walletCredit <= 0) {
        return new Response(JSON.stringify({ error: "Missing valid wallet credit amount" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const expectedTotal = Number((walletCredit + calculatePaystackFee(walletCredit)).toFixed(2));
      if (!amountMatches(expectedTotal, amount) || walletCredit > amount) {
        return new Response(JSON.stringify({
          error: `Invalid wallet top-up amount. Expected GHS ${expectedTotal.toFixed(2)}.`,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check if order already exists (idempotency)
    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("id", reference)
      .maybeSingle();

    if (!existingOrder) {
      const metadataProfit = Number(metadata.profit);
      const normalizedProfit = Number.isFinite(metadataProfit) && metadataProfit > 0
        ? parseFloat(metadataProfit.toFixed(2))
        : 0;

      const orderRow: Record<string, unknown> = {
        id: reference,
        agent_id: agentId,
        order_type: orderType,
        amount,
        profit: normalizedProfit,
        status: "pending",
      };
      if (metadata.customer_phone) orderRow.customer_phone = metadata.customer_phone;
      if (metadata.network) orderRow.network = metadata.network;
      if (metadata.package_size) orderRow.package_size = metadata.package_size;
      // AFA fields
      if (metadata.afa_full_name) orderRow.afa_full_name = metadata.afa_full_name;
      if (metadata.afa_ghana_card) orderRow.afa_ghana_card = metadata.afa_ghana_card;
      if (metadata.afa_occupation) orderRow.afa_occupation = metadata.afa_occupation;
      if (metadata.afa_email) orderRow.afa_email = metadata.afa_email;
      if (metadata.afa_residence) orderRow.afa_residence = metadata.afa_residence;
      if (metadata.afa_date_of_birth) orderRow.afa_date_of_birth = metadata.afa_date_of_birth;

      const { error: insertError } = await supabaseAdmin.from("orders").insert(orderRow);
      if (insertError) {
        console.error("Failed to create order:", insertError);
        return new Response(JSON.stringify({ error: "Failed to create order" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log("Order created server-side:", reference, orderType);
    } else {
      const metadataProfit = Number(metadata.profit);
      const patch: Record<string, unknown> = {};

      if (metadata.agent_id) patch.agent_id = metadata.agent_id;
      if (metadata.customer_phone) patch.customer_phone = metadata.customer_phone;
      if (metadata.network) patch.network = metadata.network;
      if (metadata.package_size) patch.package_size = metadata.package_size;
      if (metadata.afa_full_name) patch.afa_full_name = metadata.afa_full_name;
      if (metadata.afa_ghana_card) patch.afa_ghana_card = metadata.afa_ghana_card;
      if (metadata.afa_occupation) patch.afa_occupation = metadata.afa_occupation;
      if (metadata.afa_email) patch.afa_email = metadata.afa_email;
      if (metadata.afa_residence) patch.afa_residence = metadata.afa_residence;
      if (metadata.afa_date_of_birth) patch.afa_date_of_birth = metadata.afa_date_of_birth;
      if (Number.isFinite(metadataProfit) && metadataProfit > 0) {
        patch.profit = parseFloat(metadataProfit.toFixed(2));
      }

      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("orders").update(patch).eq("id", reference);
      }
    }

    const amountInPesewas = Math.round(amount * 100);
    console.log("Initializing payment:", { email, amount, amountInPesewas, reference });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountInPesewas,
        reference,
        callback_url,
        metadata,
        currency: "GHS",
      }),
    });

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const textResponse = await response.text();
      console.error("Paystack returned non-JSON:", textResponse.substring(0, 500));
      return new Response(JSON.stringify({ error: "Paystack returned an invalid response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    console.log("Paystack response:", JSON.stringify(data));

    if (!response.ok || !data.status) {
      console.error("Paystack initialization failed", {
        status: response.status,
        statusText: response.statusText,
        paystackMessage: data?.message,
      });
      return new Response(JSON.stringify({ error: data.message || "Payment initialization failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Payment init error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
