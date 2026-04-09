import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function mapNetworkToApi(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AIRTELTIGO" || normalized === "AIRTEL TIGO") return "AIRTELTIGO";
  if (normalized === "TELECEL" || normalized === "VODAFONE") return "TELECEL";
  if (normalized === "MTN") return "MTN";
  return normalized;
}

function formatDataPlan(packageSize: string): string {
  return packageSize.replace(/\s+/g, "").toUpperCase();
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
  const DATA_PROVIDER_API_KEY = Deno.env.get("DATA_PROVIDER_API_KEY")?.trim();
  const DATA_PROVIDER_BASE_URL = Deno.env.get("DATA_PROVIDER_BASE_URL")?.trim().replace(/\/+$/, "");
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
    console.log("Webhook: Payment successful for reference:", reference);

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

    // Handle agent activation
    if (orderType === "agent_activation") {
      const agentId = metadata?.agent_id;
      if (agentId) {
        await supabase
          .from("profiles")
          .update({ is_agent: true, agent_approved: true })
          .eq("user_id", agentId);
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
        console.log("Agent activated via webhook:", agentId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Fulfill data/AFA orders
    if (!DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
      console.error("Data provider not configured for fulfillment");
      await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Data provider not configured" }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fulfilled = false;

    if (orderType === "afa") {
      const afaData = {
        full_name: metadata?.afa_full_name,
        ghana_card: metadata?.afa_ghana_card,
        occupation: metadata?.afa_occupation,
        email: metadata?.afa_email,
        residence: metadata?.afa_residence,
        date_of_birth: metadata?.afa_date_of_birth,
      };

      const fulfillRes = await fetchWithRetry(
        `${DATA_PROVIDER_BASE_URL}/api/afa-registration`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${DATA_PROVIDER_API_KEY}`,
          },
          body: JSON.stringify(afaData),
        }
      );

      const fulfillData = await fulfillRes.text();
      if (fulfillRes.ok) {
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
        fulfilled = true;
      } else {
        let reason = "AFA registration failed";
        try { reason = JSON.parse(fulfillData)?.message || reason; } catch { /* keep fallback */ }
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", orderId);
      }
    } else {
      const network = metadata?.network;
      const packageSize = metadata?.package_size;
      const customerPhone = metadata?.customer_phone;

      if (network && packageSize && customerPhone) {
        const apiNetwork = mapNetworkToApi(network);
        const dataPlan = formatDataPlan(packageSize);
        console.log("Fulfilling data order:", { orderId, network, apiNetwork, packageSize, dataPlan, customerPhone });

        const fulfillRes = await fetchWithRetry(
          `${DATA_PROVIDER_BASE_URL}/api/order`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "Authorization": `Bearer ${DATA_PROVIDER_API_KEY}`,
            },
            body: JSON.stringify({
              network: apiNetwork,
              data_plan: dataPlan,
              beneficiary: customerPhone,
            }),
          }
        );

        const fulfillData = await fulfillRes.text();
        if (fulfillRes.ok) {
          await supabase.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
          fulfilled = true;
        } else {
          let reason = "Data delivery failed";
          try { reason = JSON.parse(fulfillData)?.message || reason; } catch { /* keep fallback */ }
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
