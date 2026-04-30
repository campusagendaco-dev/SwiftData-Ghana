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

// Maps network names to the keys the provider API expects (must match wallet-buy-data)
function mapNetworkKey(network: string): string {
  const n = (network || "").trim().toUpperCase();
  if (n === "AIRTELTIGO" || n === "AIRTEL TIGO" || n === "AIRTEL-TIGO" || n === "AT") return "AT_PREMIUM";
  if (n === "TELECEL" || n === "VODAFONE" || n === "VOD") return "TELECEL";
  if (n === "MTN" || n === "YELLO") return "YELLO";
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

  const { data: settings } = await supabaseAdmin
    .from("system_settings")
    .select("data_provider_api_key, data_provider_base_url")
    .eq("id", 1)
    .maybeSingle();

  return {
    apiKey: apiKey || settings?.data_provider_api_key || "",
    baseUrl: (baseUrl || settings?.data_provider_base_url || "").replace(/\/+$/, ""),
  };
}

function buildProviderUrls(baseUrl: string, endpoint: string = "purchase"): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return [];

  const urls = new Set<string>();
  const aliases = endpoint === "purchase" ? ["purchase", "order", "airtime", "buy"] : ["status", "query", "check"];

  let rootUrl = "";
  try {
    rootUrl = new URL(clean).origin;
  } catch { /* ignore */ }

  // If the configured URL already ends with an alias, use it directly
  for (const alias of aliases) {
    if (clean.endsWith(`/${alias}`) || clean.endsWith(`/api/${alias}`)) {
      urls.add(clean);
    }
  }

  // Build /api/<alias> and /<alias> variants from the configured base
  for (const alias of aliases) {
    if (clean.endsWith("/api")) {
      urls.add(`${clean}/${alias}`);
      urls.add(`${clean.replace(/\/api$/, "")}/api/${alias}`);
    } else {
      urls.add(`${clean}/api/${alias}`);
      urls.add(`${clean}/${alias}`);
    }
  }

  // Also try from the root origin in case the base URL has an extra path segment
  if (rootUrl) {
    for (const alias of aliases) {
      urls.add(`${rootUrl}/api/${alias}`);
      urls.add(`${rootUrl}/${alias}`);
    }
  }

  return Array.from(urls);
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  const preview = body.trim().slice(0, 200).toLowerCase();
  return Boolean(
    preview.startsWith("<!doctype html") ||
    preview.startsWith("<html") ||
    preview.includes("<title>"),
  );
}

function parseProviderResponse(body: string, contentType: string | null): { ok: boolean; reason?: string; id?: string; status?: string } {
  try {
    const parsed = JSON.parse(body);
    const rawStatus = parsed?.status;
    const status = String(rawStatus || "").toLowerCase();
    const message = typeof parsed?.message === "string" ? parsed.message : undefined;
    const orderId = parsed?.transaction_id || parsed?.order_id || parsed?.reference || parsed?.id;
    const deliveryStatus = String(parsed?.delivery_status || parsed?.status_message || "").toLowerCase();

    if (rawStatus === true || status === "true" || status === "success") {
      return { ok: true, id: orderId, status: deliveryStatus };
    }
    
    if (rawStatus === false || status === "false" || status === "error" || status === "failed" || status === "failure") {
      return { ok: false, reason: message || "Provider rejected this order." };
    }

    const statusCode = Number(parsed?.statusCode);
    if (Number.isFinite(statusCode) && statusCode >= 400) {
      return { ok: false, reason: message || "Provider rejected this order." };
    }
    
    // If it has an ID, it's likely a successful initiation even if status isn't "success" explicitly
    if (orderId) return { ok: true, id: orderId, status: deliveryStatus };

  } catch { /* non-JSON */ }

  if (isHtmlResponse(contentType, body)) {
    return { ok: false, reason: "Provider returned an HTML response. Check API URL configuration." };
  }

  return { ok: true };
}

async function callProviderApi(
  baseUrl: string,
  apiKey: string,
  data: Record<string, unknown>,
  endpoint: string = "purchase"
): Promise<{ ok: boolean; reason: string; id?: string; status?: string }> {
  const urls = buildProviderUrls(baseUrl, endpoint);

  let lastReason = "Provider error";

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "X-API-Key": apiKey,
            "User-Agent": "DataHiveGH/1.0",
          },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(25000),
        });

        const contentType = res.headers.get("content-type");
        const text = await res.text();

        if (res.ok) {
          const semantic = parseProviderResponse(text, contentType);
          if (semantic.ok) return { ok: true, reason: "", id: semantic.id, status: semantic.status };
          return { ok: false, reason: semantic.reason || "Provider rejected this order." };
        }

        let parsedMsg = "";
        try { parsedMsg = JSON.parse(text)?.message || ""; } catch { /* ignore */ }
        lastReason = parsedMsg || `Provider returned ${res.status}`;

        // Auth failures — don't retry at all
        if (res.status === 401 || res.status === 403) return { ok: false, reason: lastReason };

        // 404 or HTML — move to next URL
        if (res.status === 404 || isHtmlResponse(contentType, text)) break;

        // Retryable server errors
        if (res.status >= 500 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        break;
      } catch (e: any) {
        lastReason = e?.message || "Network error";
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300));
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
      return new Response(JSON.stringify({ 
        status: "fulfilled", 
        message: "Already processed",
        provider_order_id: existingOrder?.provider_order_id 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { apiKey, baseUrl } = await getProviderCredentials(supabaseAdmin);

    // 2. If already processing and has provider ID, check status instead of re-fulfilling
    if (existingOrder?.status === "processing" && existingOrder?.provider_order_id && baseUrl && apiKey) {
      console.log(`[verify-payment] Checking status for existing processing order: ${reference}`);
      const checkResult = await callProviderApi(baseUrl, apiKey, {
        transaction_id: existingOrder.provider_order_id,
        reference: reference
      }, "status");

      if (checkResult.ok) {
        const isDelivered = checkResult.status === "delivered" || checkResult.status === "success" || checkResult.status === "fulfilled";
        if (isDelivered) {
          await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: reference });
          return new Response(JSON.stringify({ 
            status: "fulfilled", 
            message: "Confirmed delivered",
            provider_order_id: existingOrder.provider_order_id 
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Still processing
        return new Response(JSON.stringify({ 
          status: "processing", 
          message: "Still processing at provider",
          provider_order_id: existingOrder.provider_order_id 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Status check failed or endpoint not found — fall through to verification
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

    // 3. Mark as processing (Atomic Update)
    const { data: claimedOrder, error: claimError } = await supabaseAdmin.from("orders")
      .update({ status: "processing", paystack_verified_amount: verifiedAmount })
      .eq("id", reference)
      .in("status", ["pending", "paid", "fulfillment_failed"])
      .select("*")
      .maybeSingle();

    if (claimError) {
      console.error("[verify-payment] Claim error:", claimError);
    }

    if (!claimedOrder && existingOrder?.status === "processing") {
      // Already being processed by another request
      return new Response(JSON.stringify({ status: "processing", message: "Fulfillment already in progress" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

      const requestBody = {
        networkKey: mapNetworkKey(network),
        networkRaw: network,
        recipient,
        capacity: parseCapacity(packageSize),
        amount: existingOrder?.amount || verifiedAmount,
        order_type: "data",
        description: `Data purchase: ${packageSize} for ${recipient}`,
      };

      console.log("[verify-payment] Provider request:", { baseUrl, network, networkKey: requestBody.networkKey, recipient, packageSize });

      const result = await callProviderApi(baseUrl, apiKey, requestBody);

      if (result.ok) {
        const patch: Record<string, any> = { failure_reason: null };
        if (result.id) patch.provider_order_id = result.id;
        
        // If the provider specifically says it's already delivered or doesn't return a status (meaning it's immediate)
        const isActuallyDelivered = !result.status || result.status === "delivered" || result.status === "success" || result.status === "fulfilled";
        
        if (isActuallyDelivered) {
          patch.status = "fulfilled";
        }

        await supabaseAdmin.from("orders").update(patch).eq("id", reference);
        
        if (isActuallyDelivered) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: reference });
        }
        
        return new Response(JSON.stringify({ 
          status: patch.status || "processing",
          provider_order_id: patch.provider_order_id || result.id
        }), { headers: corsHeaders });
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
