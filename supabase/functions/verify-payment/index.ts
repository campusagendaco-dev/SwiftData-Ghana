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

async function callProviderApi(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "User-Agent": "DataHiveGH/1.0",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
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

    const { data: order } = await supabase
      .from("orders")
      .select("*")
      .eq("id", reference)
      .maybeSingle();

    if (order?.status === "fulfilled") {
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify with Paystack
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

    const metadata = verifyData.data.metadata || {};
    const orderType = order?.order_type || metadata.order_type;
    const agentId = order?.agent_id || metadata.agent_id;
    const paidAmount = order?.amount || (verifyData.data.amount / 100);

    // Recreate order from Paystack metadata if missing
    if (!order && agentId) {
      console.log("Recreating order from Paystack metadata:", { reference, orderType, agentId });
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

    // Agent activation — auto-approve
    if (orderType === "agent_activation" && agentId) {
      console.log("Processing agent activation for:", agentId);
      await supabase.from("profiles").update({ is_agent: true, agent_approved: true }).eq("user_id", agentId);
      await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Wallet top-up
    if (orderType === "wallet_topup") {
      const creditAmount = metadata.wallet_credit || order?.amount || paidAmount;
      const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", agentId).maybeSingle();
      if (wallet) {
        const newBalance = parseFloat(((wallet.balance || 0) + creditAmount).toFixed(2));
        await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", agentId);
      } else {
        await supabase.from("wallets").insert({ agent_id: agentId, balance: creditAmount });
      }
      await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Data/AFA fulfillment
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
      const result = await callProviderApi(`${DATA_PROVIDER_BASE_URL}/api/afa-registration`, DATA_PROVIDER_API_KEY, afaData);
      console.log("AFA fulfillment response:", result.status, result.text);

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
        fulfilled = true;
      } else {
        let reason = result.text || "AFA registration failed";
        try { reason = JSON.parse(result.text)?.message || reason; } catch { /* keep raw */ }
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", reference);
      }
    } else {
      const network = order?.network || metadata.network;
      const packageSize = order?.package_size || metadata.package_size;
      const customerPhone = order?.customer_phone || metadata.customer_phone;

      if (network && packageSize && customerPhone) {
        const apiNetwork = mapNetworkToApi(network);
        const dataPlan = formatDataPlan(packageSize);
        console.log("Fulfilling data order:", { apiNetwork, dataPlan, customerPhone });

        const result = await callProviderApi(`${DATA_PROVIDER_BASE_URL}/api/order`, DATA_PROVIDER_API_KEY, {
          network: apiNetwork,
          data_plan: dataPlan,
          beneficiary: customerPhone,
        });
        console.log("Data fulfillment response:", result.status, result.text);

        if (result.ok) {
          await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
          fulfilled = true;
        } else {
          let reason = result.text || "Data delivery failed";
          try { reason = JSON.parse(result.text)?.message || reason; } catch { /* keep raw */ }
          await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: reason }).eq("id", reference);
        }
      }
    }

    const { data: updatedOrder } = await supabase.from("orders").select("status, failure_reason").eq("id", reference).maybeSingle();

    return new Response(JSON.stringify({
      status: updatedOrder?.status || (fulfilled ? "fulfilled" : "pending"),
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
