import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
  const DATA_PROVIDER_API_KEY_RAW = Deno.env.get("DATA_PROVIDER_API_KEY");
  const DATA_PROVIDER_API_KEY = DATA_PROVIDER_API_KEY_RAW?.trim();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const DATA_PROVIDER_BASE_URL = "https://backend.mycledanet.com";

  if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { reference } = await req.json();
    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the order
    const { data: order } = await supabase
      .from("orders")
      .select("*")
      .eq("id", reference)
      .maybeSingle();

    // If order exists and already fulfilled, return immediately
    if (order?.status === "fulfilled") {
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Always verify with Paystack to get ground truth
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
    });

    const verifyContentType = verifyRes.headers.get("content-type");
    if (!verifyContentType?.includes("application/json")) {
      return new Response(JSON.stringify({ status: order?.status || "unknown", error: "Verification failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyData = await verifyRes.json();
    if (!verifyData.status || verifyData.data.status !== "success") {
      return new Response(JSON.stringify({ status: order?.status || "pending" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Payment verified with Paystack
    const metadata = verifyData.data.metadata || {};
    const orderType = order?.order_type || metadata.order_type;
    const agentId = order?.agent_id || metadata.agent_id;
    const paidAmount = order?.amount || (verifyData.data.amount / 100); // Paystack returns amount in pesewas

    // If order doesn't exist, recreate it from Paystack metadata
    if (!order && agentId) {
      console.log("Order not found locally, recreating from Paystack metadata:", { reference, orderType, agentId });
      const walletCredit = metadata.wallet_credit || metadata.amount || paidAmount;
      await supabase.from("orders").insert({
        id: reference,
        agent_id: agentId,
        order_type: orderType || "wallet_topup",
        amount: orderType === "wallet_topup" ? walletCredit : paidAmount,
        profit: 0,
        status: "paid",
        network: metadata.network || null,
        package_size: metadata.package_size || null,
        customer_phone: metadata.customer_phone || null,
      });
    } else if (order?.status === "pending") {
      await supabase.from("orders").update({ status: "paid" }).eq("id", reference);
    }

    console.log("Payment verified for:", reference, "type:", orderType);

    // Handle wallet top-up
    if (orderType === "wallet_topup") {
      // Use the wallet_credit from metadata if available, otherwise fall back to order amount
      const creditAmount = metadata.wallet_credit || order?.amount || paidAmount;
      
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", agentId)
        .maybeSingle();

      if (wallet) {
        const newBalance = parseFloat(((wallet.balance || 0) + creditAmount).toFixed(2));
        await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", agentId);
        console.log(`Credited wallet for agent ${agentId}: +${creditAmount}, new balance: ${newBalance}`);
      } else {
        await supabase.from("wallets").insert({ agent_id: agentId, balance: creditAmount });
        console.log(`Created wallet for agent ${agentId} with balance: ${creditAmount}`);
      }

      await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle data/AFA fulfillment
    const needsFulfillment = !order || order.status === "pending" || order.status === "paid" || order.status === "fulfillment_failed";
    if (!needsFulfillment) {
      return new Response(JSON.stringify({ status: order?.status || "unknown" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fulfilled = false;

    if (orderType === "afa") {
      if (!DATA_PROVIDER_API_KEY) {
        return new Response(JSON.stringify({ error: "Server misconfigured: DATA_PROVIDER_API_KEY missing" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const afaData = {
        full_name: order?.afa_full_name || metadata.afa_full_name,
        ghana_card: order?.afa_ghana_card || metadata.afa_ghana_card,
        occupation: order?.afa_occupation || metadata.afa_occupation,
        email: order?.afa_email || metadata.afa_email,
        residence: order?.afa_residence || metadata.afa_residence,
        date_of_birth: order?.afa_date_of_birth || metadata.afa_date_of_birth,
      };

      console.log("Fulfilling AFA order:", afaData);
      const fulfillRes = await fetchWithRetry(
        `${DATA_PROVIDER_BASE_URL}/api/afa-registration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": DATA_PROVIDER_API_KEY },
          body: JSON.stringify(afaData),
        }
      );

      const fulfillText = await fulfillRes.text();
      console.log("AFA fulfillment response:", fulfillRes.status, fulfillText);

      if (fulfillRes.ok) {
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
        fulfilled = true;
      } else {
        const reason = fulfillText || "AFA registration failed";
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", reference);
      }
    } else {
      if (!DATA_PROVIDER_API_KEY) {
        return new Response(JSON.stringify({ error: "Server misconfigured: DATA_PROVIDER_API_KEY missing" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const network = order?.network || metadata.network;
      const packageSize = order?.package_size || metadata.package_size;
      const customerPhone = order?.customer_phone || metadata.customer_phone;

      if (network && packageSize && customerPhone) {
        let size = 0;
        const gbMatch = packageSize.match(/^(\d+(?:\.\d+)?)\s*GB$/i);
        const mbMatch = packageSize.match(/^(\d+(?:\.\d+)?)\s*MB$/i);
        if (gbMatch) size = parseFloat(gbMatch[1]);
        else if (mbMatch) size = parseFloat(mbMatch[1]) / 1000;

        const apiNetwork = mapNetworkToApi(network);
        console.log("Fulfilling data order:", { network, apiNetwork, packageSize, size, customerPhone });

        const fulfillRes = await fetchWithRetry(
          `${DATA_PROVIDER_BASE_URL}/api/order`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": DATA_PROVIDER_API_KEY },
            body: JSON.stringify({ phone: customerPhone, size, network: apiNetwork }),
          }
        );

        const fulfillText = await fulfillRes.text();
        console.log("Data fulfillment response:", fulfillRes.status, fulfillText);

        if (fulfillRes.ok) {
          await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
          fulfilled = true;
        } else {
          const reason = JSON.parse(fulfillText)?.message || fulfillText || "Data delivery failed";
          console.error("Fulfillment failed. Status:", fulfillRes.status, "Body:", fulfillText);
          await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", reference);
        }
      }
    }

    const { data: updatedOrder } = await supabase.from("orders").select("status, failure_reason").eq("id", reference).maybeSingle();
    const resolvedStatus = updatedOrder?.status || (fulfilled ? "fulfilled" : "pending");

    return new Response(JSON.stringify({
      status: resolvedStatus,
      _internal_status: updatedOrder?.status || null,
      failure_reason: updatedOrder?.failure_reason || null,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
