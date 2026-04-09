import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/[^\d+]/g, "");
  if (!clean) return null;
  if (clean.startsWith("+")) {
    const normalized = `+${clean.slice(1).replace(/\D/g, "")}`;
    return normalized.length >= 11 ? normalized : null;
  }
  const digits = clean.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("233") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+233${digits.slice(1)}`;
  if (digits.startsWith("00") && digits.length > 2) return `+${digits.slice(2)}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

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

function normalizeProviderFailure(rawText: string | null | undefined, fallback: string): string {
  const text = (rawText || "").trim();
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("cf_chl_opt") ||
    lower.includes("just a moment")
  ) {
    return "Provider blocked server request (Cloudflare challenge). Contact support.";
  }
  return text;
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
    const paidAmount = order?.amount || (verifyData.data.amount / 100);

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

    // Handle agent activation — auto-approve the reseller
    if (orderType === "agent_activation" && agentId) {
      console.log("Processing agent activation for:", agentId);
      await supabase
        .from("profiles")
        .update({ is_agent: true, agent_approved: true })
        .eq("user_id", agentId);

      await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);

      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle wallet top-up
    if (orderType === "wallet_topup") {
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
    if (!DATA_PROVIDER_BASE_URL || !DATA_PROVIDER_API_KEY) {
      console.error("Data provider not configured");
      await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Data provider not configured" }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfillment_failed", failure_reason: "Data provider not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const needsFulfillment = !order || order.status === "pending" || order.status === "paid" || order.status === "fulfillment_failed";
    if (!needsFulfillment) {
      return new Response(JSON.stringify({ status: order?.status || "unknown" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fulfilled = false;

    if (orderType === "afa") {
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
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${DATA_PROVIDER_API_KEY}`,
          },
          body: JSON.stringify(afaData),
        },
      );
      const fulfillText = await fulfillRes.text();
      console.log("AFA fulfillment response:", fulfillRes.status, fulfillText);

      if (fulfillRes.ok) {
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
        fulfilled = true;
      } else {
        const reason = normalizeProviderFailure(fulfillText, "AFA registration failed");
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", reference);
      }
    } else {
      const network = order?.network || metadata.network;
      const packageSize = order?.package_size || metadata.package_size;
      const customerPhone = order?.customer_phone || metadata.customer_phone;

      if (network && packageSize && customerPhone) {
        const apiNetwork = mapNetworkToApi(network);
        const dataPlan = formatDataPlan(packageSize);
        console.log("Fulfilling data order:", { network, apiNetwork, packageSize, dataPlan, customerPhone });

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
          },
        );
        const fulfillText = await fulfillRes.text();
        console.log("Data fulfillment response:", fulfillRes.status, fulfillText);

        if (fulfillRes.ok) {
          await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
          fulfilled = true;
        } else {
          let reason = fulfillText || "Data delivery failed";
          try {
            reason = JSON.parse(fulfillText)?.message || reason;
          } catch {
            // keep plain text
          }
          reason = normalizeProviderFailure(reason, "Data delivery failed");
          await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", reference);
        }
      }
    }

    const { data: updatedOrder } = await supabase.from("orders").select("status, failure_reason").eq("id", reference).maybeSingle();
    const resolvedStatus = updatedOrder?.status || (fulfilled ? "fulfilled" : "pending");

    return new Response(JSON.stringify({
      status: resolvedStatus,
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
