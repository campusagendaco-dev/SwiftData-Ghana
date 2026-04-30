import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// --- Utilities ---

function getFirstEnv(...keys: string[]): string {
  for (const key of keys) {
    const v = Deno.env.get(key)?.trim();
    if (v) return v;
  }
  return "";
}

function mapNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n === "MTN" || n === "YELLO") return "MTN";
  if (n === "VOD" || n === "VODAFONE" || n === "TELECEL") return "VOD";
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return "AT";
  return n;
}

function parseCapacity(packageSize: string | null | undefined): number {
  if (!packageSize) return 0;
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

async function getProviderCredentials(supabaseAdmin: any): Promise<{ apiKey: string; baseUrl: string }> {
  // 1. Try environment variables first (multiple naming conventions)
  const apiKey = getFirstEnv(
    "PRIMARY_DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_PRIMARY_API_KEY",
  );
  const baseUrl = getFirstEnv(
    "PRIMARY_DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_PRIMARY_BASE_URL",
  ).replace(/\/+$/, "");

  if (apiKey && baseUrl) return { apiKey, baseUrl };

  // 2. Fall back to system_settings in DB
  const { data: settings } = await supabaseAdmin
    .from("system_settings")
    .select("data_provider_api_key, data_provider_base_url, active_api_source")
    .eq("id", 1)
    .maybeSingle();

  const dbApiKey = apiKey || settings?.data_provider_api_key || "";
  const dbBaseUrl = (baseUrl || settings?.data_provider_base_url || "").replace(/\/+$/, "");

  return { apiKey: dbApiKey, baseUrl: dbBaseUrl };
}

async function callProviderApi(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; reason: string }> {
  // Try both URL patterns the provider may expect
  const urls = [
    `${baseUrl}/api/${endpoint}`,
    `${baseUrl}/${endpoint}`,
  ];

  let lastReason = "Provider error";

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "X-API-Key": apiKey,
          },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(25000),
        });
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { status: "error", message: text }; }

        const rawStatus = parsed?.status;
        const ok =
          rawStatus === true ||
          String(rawStatus).toLowerCase() === "success" ||
          String(rawStatus).toLowerCase() === "true";

        if (res.ok && ok) return { ok: true, reason: "" };

        lastReason = parsed?.message || `Provider returned ${res.status}`;

        // Don't retry on auth errors
        if (res.status === 401 || res.status === 403) return { ok: false, reason: lastReason };

        if (attempt < 2 && res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break; // try next URL
      } catch (e: any) {
        lastReason = e?.message || "Network error";
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  return { ok: false, reason: lastReason };
}

// --- Main Handler ---

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const reference = body?.reference;

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Check if already processed
    const { data: existingOrder } = await supabaseAdmin
      .from("orders").select("*").eq("id", reference).maybeSingle();

    if (existingOrder?.status === "fulfilled" || existingOrder?.status === "completed") {
      return new Response(JSON.stringify({ status: "fulfilled", message: "Already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Verify payment with Paystack
    const PAYSTACK_SECRET_KEY = getFirstEnv("PAYSTACK_SECRET_KEY");
    if (!PAYSTACK_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Paystack key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status || !verifyData.data || verifyData.data.status !== "success") {
      return new Response(JSON.stringify({ status: "not_paid", error: "Payment not verified" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifiedAmount = verifyData.data.amount / 100;
    const metadata = verifyData.data.metadata || {};
    const orderType = metadata?.order_type || existingOrder?.order_type || "data";

    // 3. Mark as processing
    await supabaseAdmin.from("orders")
      .update({ status: "processing", paystack_verified_amount: verifiedAmount })
      .eq("id", reference);

    // 4. Fulfillment by order type

    if (orderType === "agent_activation") {
      if (verifiedAmount < 80 * 0.97) {
        await supabaseAdmin.from("orders").update({ status: "fulfillment_failed", failure_reason: "Amount too low" }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Amount too low" }), { headers: corsHeaders });
      }
      const agentId = metadata?.agent_id;
      if (agentId) {
        await supabaseAdmin.from("profiles").update({
          is_agent: true, agent_approved: true, onboarding_complete: true,
          is_sub_agent: false, parent_agent_id: null,
        }).eq("user_id", agentId);
        await supabaseAdmin.from("orders").update({ status: "fulfilled" }).eq("id", reference);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });

    } else if (orderType === "sub_agent_activation") {
      if (verifiedAmount < 80 * 0.97) {
        await supabaseAdmin.from("orders").update({ status: "fulfillment_failed", failure_reason: "Amount too low" }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Amount too low" }), { headers: corsHeaders });
      }
      const subAgentId = metadata?.sub_agent_id;
      const parentAgentId = metadata?.parent_agent_id;
      const agentProfit = Math.max(0, parseFloat((Number(metadata?.activation_fee || verifiedAmount) - 80).toFixed(2)));
      if (subAgentId) {
        const { data: parentProfile } = await supabaseAdmin.from("profiles")
          .select("sub_agent_prices").eq("user_id", parentAgentId).maybeSingle();
        await supabaseAdmin.from("profiles").update({
          is_agent: true, agent_approved: true, sub_agent_approved: true,
          onboarding_complete: true, is_sub_agent: true,
          parent_agent_id: parentAgentId || null,
          agent_prices: parentProfile?.sub_agent_prices || {},
        }).eq("user_id", subAgentId);
        await supabaseAdmin.from("orders").update({
          status: "fulfilled", parent_profit: agentProfit, parent_agent_id: parentAgentId || null,
        }).eq("id", reference);
        if (parentAgentId && agentProfit > 0) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: reference });
        }
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });

    } else if (orderType === "wallet_topup") {
      const agentId = existingOrder?.agent_id || metadata?.agent_id;
      if (agentId) {
        await supabaseAdmin.rpc("credit_wallet", { p_agent_id: agentId, p_amount: verifiedAmount });
        await supabaseAdmin.from("orders").update({ status: "fulfilled" }).eq("id", reference);
      }
      return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });

    } else {
      // Data / default fulfillment
      const { apiKey, baseUrl } = await getProviderCredentials(supabaseAdmin);

      if (!apiKey || !baseUrl) {
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: "Data provider not configured — set DATA_PROVIDER_BASE_URL and DATA_PROVIDER_API_KEY in Supabase secrets",
        }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Data provider not configured" }), { headers: corsHeaders });
      }

      const network = existingOrder?.network || metadata?.network || "";
      const customerPhone = existingOrder?.customer_phone || metadata?.customer_phone || metadata?.phone || "";
      const packageSize = existingOrder?.package_size || metadata?.package_size || "";

      const recipient = normalizeRecipient(customerPhone);
      if (!recipient) {
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed", failure_reason: "Missing recipient phone",
        }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: "Missing recipient phone" }), { headers: corsHeaders });
      }

      const result = await callProviderApi(baseUrl, apiKey, "purchase", {
        networkKey: mapNetworkKey(network),
        networkRaw: network,
        recipient,
        capacity: parseCapacity(packageSize),
        amount: existingOrder?.amount || verifiedAmount,
        order_type: "data",
        description: `Data: ${packageSize} for ${recipient}`,
      });

      if (result.ok) {
        await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: reference });
        return new Response(JSON.stringify({ status: "fulfilled" }), { headers: corsHeaders });
      } else {
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed", failure_reason: result.reason,
        }).eq("id", reference);
        return new Response(JSON.stringify({ status: "failed", reason: result.reason }), { headers: corsHeaders });
      }
    }

  } catch (error: any) {
    console.error("[verify-payment] Error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
