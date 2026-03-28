import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function mapNetworkToApi(network: string): string {
  const map: Record<string, string> = {
    "MTN": "MTN",
    "Telecel": "TELECEL",
    "AirtelTigo": "AIRTELTIGO_ISHARE",
  };
  return map[network] || network;
}

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.status >= 400 && res.status < 500) return res;
      if (res.ok) return res;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
      } else {
        return res;
      }
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error("fetchWithRetry: should not reach here");
}

// Base prices for wallet deduction
const basePrices: Record<string, Record<string, number>> = {
  MTN: { "1GB": 4.45, "2GB": 8.9, "3GB": 13.1, "4GB": 17.3, "5GB": 21.2, "6GB": 25.7, "7GB": 29.6, "8GB": 33.2, "10GB": 42.5, "15GB": 62.0, "20GB": 80.2, "25GB": 100.8, "30GB": 124.0, "40GB": 159.0, "50GB": 199.3, "100GB": 385.0 },
  Telecel: { "5GB": 23.0, "10GB": 41.8, "12GB": 49.0, "15GB": 58.99, "18GB": 71.8, "20GB": 78.5, "22GB": 82.5, "25GB": 102.0, "30GB": 125.5, "40GB": 166.0, "50GB": 190.0 },
  AirtelTigo: { "1GB": 4.3, "2GB": 8.2, "3GB": 12.0, "4GB": 15.8, "5GB": 19.85, "6GB": 23.49, "7GB": 27.0, "8GB": 30.59, "9GB": 34.2 },
};

// Emergency safety switch: keep false to prevent double-charging agents on Paystack data purchases.
const ENABLE_AGENT_WALLET_DEDUCTION = false;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
  const DATA_PROVIDER_API_KEY = Deno.env.get("DATA_PROVIDER_API_KEY")?.trim();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing required secrets");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const hash = createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  if (hash !== signature) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = JSON.parse(rawBody);
    if (body.event !== "charge.success") {
      return new Response(JSON.stringify({ received: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reference, metadata } = body.data;
    console.log("Payment successful for reference:", reference);

    // Verify with Paystack
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.status || verifyData.data.status !== "success") {
      console.error("Payment verification failed:", verifyData);
      return new Response(JSON.stringify({ error: "Payment verification failed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderId = metadata?.order_id || reference;
    const orderType = metadata?.order_type;

    // Update order to paid
    await supabase.from("orders").update({ status: "paid" }).eq("id", orderId);

    // Handle wallet top-up
    if (orderType === "wallet_topup") {
      const { data: order } = await supabase.from("orders").select("amount, agent_id").eq("id", orderId).maybeSingle();
      if (order) {
        const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", order.agent_id).maybeSingle();
        if (wallet) {
          const newBalance = parseFloat(((wallet.balance || 0) + order.amount).toFixed(2));
          await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", order.agent_id);
        } else {
          await supabase.from("wallets").insert({ agent_id: order.agent_id, balance: order.amount });
        }
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fulfill based on order type
    let fulfilled = false;

    if (orderType === "afa") {
      if (!DATA_PROVIDER_API_KEY) {
        return new Response(JSON.stringify({ error: "Server misconfigured: DATA_PROVIDER_API_KEY missing" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const afaData = {
        fullName: metadata?.afa_full_name,
        ghanaCardNumber: metadata?.afa_ghana_card,
        occupation: metadata?.afa_occupation,
        email: metadata?.afa_email,
        placeOfResidence: metadata?.afa_residence,
        dateOfBirth: metadata?.afa_date_of_birth,
      };

      const fulfillRes = await fetchWithRetry(
        `https://backend.mycledanet.com/api/afa-registration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": DATA_PROVIDER_API_KEY },
          body: JSON.stringify(afaData),
        }
      );

      const fulfillData = await fulfillRes.text();
      if (fulfillRes.ok) {
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
        fulfilled = true;
      } else {
        let reason = "AFA registration failed";
        try { reason = JSON.parse(fulfillData)?.message || reason; } catch { /* keep fallback reason */ }
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", orderId);
      }
    } else {
      if (!DATA_PROVIDER_API_KEY) {
        return new Response(JSON.stringify({ error: "Server misconfigured: DATA_PROVIDER_API_KEY missing" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const network = metadata?.network;
      const packageSize = metadata?.package_size;
      const customerPhone = metadata?.customer_phone;
      const agentId = metadata?.agent_id;
      const shouldDeductAgentWallet =
        metadata?.deduct_agent_wallet === true || metadata?.deduct_agent_wallet === "true";
      const walletSettlementMode = metadata?.wallet_settlement_mode === "manual" ? "manual" : "automatic";
      const { data: orderRow } = await supabase
        .from("orders")
        .select("agent_id, profit")
        .eq("id", orderId)
        .maybeSingle();
      const resolvedAgentId = orderRow?.agent_id || agentId;
      const isAgentStoreSale =
        metadata?.payment_source === "agent_store" || Number(orderRow?.profit || 0) > 0;

      if (network && packageSize && customerPhone) {
        // Deduct base price only for flows that explicitly require agent-wallet settlement.
        // This prevents double charging when an agent pays directly via Paystack from dashboard.
        if (
          ENABLE_AGENT_WALLET_DEDUCTION &&
          shouldDeductAgentWallet &&
          walletSettlementMode === "manual" &&
          isAgentStoreSale &&
          resolvedAgentId &&
          resolvedAgentId !== "00000000-0000-0000-0000-000000000000"
        ) {
          const metadataBasePrice = Number(metadata?.base_price);
          const basePrice = Number.isFinite(metadataBasePrice) && metadataBasePrice > 0
            ? metadataBasePrice
            : (basePrices[network]?.[packageSize] || 0);
          if (basePrice > 0) {
            const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", resolvedAgentId).maybeSingle();
            if (wallet && wallet.balance >= basePrice) {
              const newBalance = parseFloat((wallet.balance - basePrice).toFixed(2));
              await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", resolvedAgentId);
              console.log(`Deducted GH₵${basePrice} from agent ${resolvedAgentId} wallet. New balance: ${newBalance}`);
            } else {
              console.warn(`Agent ${resolvedAgentId} insufficient wallet balance for ${network} ${packageSize}. Balance: ${wallet?.balance || 0}, Required: ${basePrice}`);
              // Still proceed with fulfillment but log the warning
            }
          }
        }
        if (shouldDeductAgentWallet && walletSettlementMode === "automatic") {
          console.log(`Automatic settlement enabled for order ${orderId}; skipping wallet deduction.`);
        }

        let size = 0;
        const gbMatch = packageSize.match(/^(\d+(?:\.\d+)?)\s*GB$/i);
        const mbMatch = packageSize.match(/^(\d+(?:\.\d+)?)\s*MB$/i);
        if (gbMatch) size = parseFloat(gbMatch[1]);
        else if (mbMatch) size = parseFloat(mbMatch[1]) / 1000;

        const apiNetwork = mapNetworkToApi(network);
        console.log("Fulfilling data order:", { orderId, network, apiNetwork, packageSize, size, customerPhone });

        const fulfillRes = await fetchWithRetry(
          `https://backend.mycledanet.com/api/order`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": DATA_PROVIDER_API_KEY },
            body: JSON.stringify({ phone: customerPhone, size, network: apiNetwork }),
          }
        );

        const fulfillData = await fulfillRes.text();
        if (fulfillRes.ok) {
          await supabase.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
          fulfilled = true;
        } else {
          let reason = "Data delivery failed";
          try { reason = JSON.parse(fulfillData)?.message || reason; } catch { /* keep fallback reason */ }
          await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", orderId);
        }
      }
    }

    return new Response(JSON.stringify({ received: true, fulfilled }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
