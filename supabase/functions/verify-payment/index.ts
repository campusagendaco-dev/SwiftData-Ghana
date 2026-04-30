import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// --- Utilities ---

function mapNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n === "MTN" || n === "YELLO") return "MTN";
  if (n === "VOD" || n === "VODAFONE" || n === "TELECEL") return "VOD";
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return "AT";
  return n;
}

function parseCapacity(packageSize: string): number {
  const match = packageSize.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function normalizeRecipient(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return phone.trim();
}

async function callProviderApi(baseUrl: string, apiKey: string, endpoint: string, data: any) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/${endpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(data),
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { status: "error", message: text }; }
    
    if (res.ok && (parsed.status === "success" || parsed.status === true || parsed.status === "true")) {
      return { ok: true, data: parsed };
    }
    return { ok: false, reason: parsed.message || "Provider error" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// --- Main Handler ---

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const reference = body?.reference;
    
    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), { status: 400, headers: corsHeaders });
    }

    // 1. Check if already processed
    const { data: existingOrder } = await supabase.from("orders").select("*").eq("id", reference).maybeSingle();
    
    if (existingOrder?.status === "fulfilled" || existingOrder?.status === "completed") {
      return new Response(JSON.stringify({ status: "fulfilled", message: "Already processed" }), { headers: corsHeaders });
    }

    // 2. Verify with Paystack
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}` },
    });
    
    const verifyData = await verifyRes.json();
    if (!verifyData.status || !verifyData.data || verifyData.data.status !== "success") {
      return new Response(JSON.stringify({ status: "not_paid", error: "Payment not verified" }), { headers: corsHeaders });
    }

    const verifiedAmount = verifyData.data.amount / 100;
    const metadata = verifyData.data.metadata;
    const orderType = metadata?.order_type || existingOrder?.order_type || "data";

    // 3. Mark as processing
    await supabase.from("orders").update({ status: "processing" }).eq("id", reference);

    // 4. Fulfillment Logic
    if (orderType === "agent_activation") {
      const AGENT_ACTIVATION_MINIMUM = 80;
      if (verifiedAmount < AGENT_ACTIVATION_MINIMUM * 0.97) {
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Amount too low" }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Amount too low" }), { headers: corsHeaders });
      }

      const agentId = metadata?.agent_id;
      if (agentId) {
        await supabase.from("profiles").update({ 
          is_agent: true, 
          agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: false,
          parent_agent_id: null
        }).eq("user_id", agentId);
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });

    } else if (orderType === "sub_agent_activation") {
      const SUB_AGENT_MINIMUM = 80;
      if (verifiedAmount < SUB_AGENT_MINIMUM * 0.97) {
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Amount too low" }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Amount too low" }), { headers: corsHeaders });
      }

      const subAgentId = metadata?.sub_agent_id;
      const parentAgentId = metadata?.parent_agent_id;
      const activationFee = Number(metadata?.activation_fee || verifiedAmount);
      const agentProfit = Math.max(0, parseFloat((activationFee - 80).toFixed(2)));

      if (subAgentId) {
        const { data: parentProfile } = await supabase.from("profiles").select("sub_agent_prices").eq("user_id", parentAgentId).maybeSingle();
        const subAgentPrices = parentProfile?.sub_agent_prices || {};

        await supabase.from("profiles").update({
          is_agent: true,
          agent_approved: true,
          sub_agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: true,
          parent_agent_id: parentAgentId || null,
          agent_prices: subAgentPrices,
        }).eq("user_id", subAgentId);

        await supabase.from("orders").update({
          status: "fulfilled",
          parent_profit: agentProfit,
          parent_agent_id: parentAgentId || null,
        }).eq("id", reference);

        if (parentAgentId && agentProfit > 0) {
          await supabase.rpc("credit_order_profits", { p_order_id: reference });
        }
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });

    } else if (orderType === "wallet_topup") {
      const agentId = existingOrder?.agent_id || metadata?.agent_id;
      if (agentId) {
        await supabase.rpc("credit_wallet", { p_agent_id: agentId, p_amount: verifiedAmount });
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });

    } else {
      // Data fulfillment
      const DATA_PROVIDER_BASE_URL = Deno.env.get("DATA_PROVIDER_BASE_URL");
      const DATA_PROVIDER_API_KEY = Deno.env.get("DATA_PROVIDER_API_KEY");
      
      const networkKey = mapNetworkKey(existingOrder?.network || metadata?.network);
      const recipient = normalizeRecipient(existingOrder?.customer_phone || metadata?.customer_phone);

      if (!recipient) {
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Missing recipient phone" }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Missing recipient phone" }), { headers: corsHeaders });
      }

      if (!DATA_PROVIDER_BASE_URL || !DATA_PROVIDER_API_KEY) {
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: "Provider not configured" }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Provider not configured" }), { headers: corsHeaders });
      }

      const result = await callProviderApi(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "purchase", {
        networkKey, recipient, amount: existingOrder?.amount || verifiedAmount, 
        capacity: parseCapacity(existingOrder?.package_size || metadata?.package_size || "")
      });

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled" }).eq("id", reference);
        await supabase.rpc("credit_order_profits", { p_order_id: reference });
        return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });
      } else {
        await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: result.reason }), { headers: corsHeaders });
      }
    }

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});