import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function mapNetworkToApi(network: string): string {
  const normalized = network.trim().toUpperCase();
  if (normalized === "AIRTELTIGO" || normalized === "AIRTEL TIGO" || normalized === "AT") return "AIRTELTIGO_ISHARE";
  if (normalized === "TELECEL" || normalized === "VODAFONE") return "TELECEL";
  if (normalized === "MTN") return "MTN";
  return normalized;
}

function formatDataPlan(packageSize: string): string {
  return packageSize.replace(/\s+/g, "").toUpperCase().replace(/GB$/, "");
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return "";

  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();

    if (host === "spendless.top" || host === "www.spendless.top") {
      return "https://backend.mycledanet.com/api";
    }
  } catch {
    return clean;
  }

  return clean;
}

function buildProviderUrls(baseUrl: string, endpoint: string): string[] {
  const clean = normalizeProviderBaseUrl(baseUrl);
  if (!clean) return [];

  const urls = new Set<string>();

  if (clean.endsWith(`/${endpoint}`) || clean.endsWith(`/api/${endpoint}`)) {
    urls.add(clean);
  }

  if (clean.endsWith("/api")) {
    urls.add(`${clean}/${endpoint}`);
    urls.add(`${clean.replace(/\/api$/, "")}/api/${endpoint}`);
  } else {
    urls.add(`${clean}/${endpoint}`);
    urls.add(`${clean}/api/${endpoint}`);
  }

  return Array.from(urls);
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  const preview = body.trim().slice(0, 200).toLowerCase();
  return Boolean(
    contentType?.includes("text/html") ||
    preview.startsWith("<!doctype html") ||
    preview.startsWith("<html") ||
    preview.includes("<title>")
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getProviderFailureReason(status: number, body: string, contentType: string | null): string {
  let parsedMessage: string | null = null;

  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string") parsedMessage = parsed.message;
    else if (typeof parsed?.error === "string") parsedMessage = parsed.error;
  } catch {
    parsedMessage = null;
  }

  const normalized = `${parsedMessage || stripHtml(body)}`.toLowerCase();

  if ((normalized.includes("insufficient") || normalized.includes("low")) && normalized.includes("balance")) {
    return "Provider balance is too low. Refill the API source and retry this order.";
  }

  if (normalized.includes("cloudflare")) {
    return "Provider blocked the server request. Ask the data source to allow this server and retry.";
  }

  if (status === 401 || status === 403) {
    return "Provider rejected the API request. Check the data source API key and access permissions.";
  }

  if (status === 404) {
    return "Provider endpoint not found. Update the data source API URL and retry.";
  }

  if (status >= 500 || status === 429) {
    return "Provider is temporarily unavailable. Retry this order shortly.";
  }

  if (parsedMessage) {
    return parsedMessage;
  }

  if (isHtmlResponse(contentType, body)) {
    return "Provider returned an HTML error page. Check the data source API URL and retry.";
  }

  const cleaned = stripHtml(body);
  if (!cleaned) return "Data delivery failed";
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
}

type ProviderResult = {
  ok: boolean;
  status: number;
  text: string;
  reason: string;
  url: string | null;
};

async function callProviderApi(
  baseUrl: string,
  apiKey: string,
  endpoint: "purchase" | "afa-registration",
  body: Record<string, unknown>,
): Promise<ProviderResult> {
  const urls = buildProviderUrls(baseUrl, endpoint);

  let lastFailure: ProviderResult = {
    ok: false,
    status: 502,
    text: "",
    reason: "Provider request failed",
    url: null,
  };

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Key": apiKey,
            "User-Agent": "DataHiveGH/1.0",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const contentType = res.headers.get("content-type");
        const text = await res.text();

        if (res.ok) {
          return { ok: true, status: res.status, text, reason: "", url };
        }

        const reason = getProviderFailureReason(res.status, text, contentType);
        lastFailure = { ok: false, status: res.status, text, reason, url };

        const retryable = res.status >= 500 || res.status === 429;
        const tryNextUrl = res.status === 404 || (isHtmlResponse(contentType, text) && res.status !== 401 && res.status !== 403);

        if (retryable && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        if (tryNextUrl) break;
        return lastFailure;
      } catch (error) {
        clearTimeout(timeoutId);
        lastFailure = {
          ok: false,
          status: 502,
          text: "",
          reason: error instanceof Error ? `Provider request failed: ${error.message}` : "Provider request failed",
          url,
        };

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }
    }
  }

  return lastFailure;
}

function buildAfaPayload(source: Record<string, unknown>) {
  return {
    fullName: source.afa_full_name,
    ghanaCardNumber: source.afa_ghana_card,
    occupation: source.afa_occupation,
    email: source.afa_email,
    placeOfResidence: source.afa_residence,
    dateOfBirth: source.afa_date_of_birth,
  };
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
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = await req.json().catch(() => null);
    const reference = typeof payload?.reference === "string" ? payload.reference.trim() : "";

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: order } = await supabase.from("orders").select("*").eq("id", reference).maybeSingle();

    if (order?.status === "fulfilled") {
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
    });

    const verifyContentType = verifyRes.headers.get("content-type");
    if (!verifyContentType?.includes("application/json")) {
      return new Response(JSON.stringify({ status: order?.status || "unknown", error: "Verification failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyData = await verifyRes.json();
    if (!verifyData.status || verifyData.data.status !== "success") {
      return new Response(JSON.stringify({ status: order?.status || "pending" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const metadata = verifyData.data.metadata || {};
    const orderType = order?.order_type || metadata.order_type;
    const agentId = order?.agent_id || metadata.agent_id;
    const paidAmount = Number(order?.amount || (verifyData.data.amount / 100));

    if (!order && agentId) {
      console.log("Recreating order from Paystack metadata:", { reference, orderType, agentId });
      const walletCredit = Number(metadata.wallet_credit || metadata.amount || paidAmount);
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
      await supabase.from("orders").update({ status: "paid", failure_reason: null }).eq("id", reference);
    }

    console.log("Payment verified for:", reference, "type:", orderType);

    if (orderType === "agent_activation" && agentId) {
      console.log("Processing agent activation for:", agentId);
      await supabase.from("profiles").update({ is_agent: true, agent_approved: true }).eq("user_id", agentId);
      await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "wallet_topup") {
      const creditAmount = Number(metadata.wallet_credit || order?.amount || paidAmount);
      const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", agentId).maybeSingle();
      if (wallet) {
        const newBalance = parseFloat(((wallet.balance || 0) + creditAmount).toFixed(2));
        await supabase.from("wallets").update({ balance: newBalance }).eq("agent_id", agentId);
      } else {
        await supabase.from("wallets").insert({ agent_id: agentId, balance: creditAmount });
      }
      await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
      return new Response(JSON.stringify({ status: "fulfilled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!DATA_PROVIDER_BASE_URL || !DATA_PROVIDER_API_KEY) {
      console.error("Data provider not configured");
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: "Data provider not configured",
      }).eq("id", reference);
      return new Response(JSON.stringify({
        status: "fulfillment_failed",
        failure_reason: "Data provider not configured",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const needsFulfillment = !order || order.status === "pending" || order.status === "paid" || order.status === "fulfillment_failed";
    if (!needsFulfillment) {
      return new Response(JSON.stringify({ status: order?.status || "unknown" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fulfilled = false;

    if (orderType === "afa") {
      const afaData = buildAfaPayload({
        afa_full_name: order?.afa_full_name ?? metadata.afa_full_name,
        afa_ghana_card: order?.afa_ghana_card ?? metadata.afa_ghana_card,
        afa_occupation: order?.afa_occupation ?? metadata.afa_occupation,
        afa_email: order?.afa_email ?? metadata.afa_email,
        afa_residence: order?.afa_residence ?? metadata.afa_residence,
        afa_date_of_birth: order?.afa_date_of_birth ?? metadata.afa_date_of_birth,
      });

      const result = await callProviderApi(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "afa-registration", afaData);
      console.log("AFA fulfillment response:", {
        reference,
        status: result.status,
        reason: result.reason,
        url: result.url,
      });

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
        fulfilled = true;
      } else {
        await supabase.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: result.reason,
        }).eq("id", reference);
      }
    } else {
      const network = order?.network ?? metadata.network;
      const packageSize = order?.package_size ?? metadata.package_size;
      const customerPhone = order?.customer_phone ?? metadata.customer_phone;

      if (!network || !packageSize || !customerPhone) {
        await supabase.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: "Missing order details for fulfillment.",
        }).eq("id", reference);
      } else {
        const apiNetwork = mapNetworkToApi(network);
        const dataPlan = formatDataPlan(packageSize);
        console.log("Fulfilling data order:", { apiNetwork, dataPlan, customerPhone });

        const result = await callProviderApi(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, "purchase", {
          network: apiNetwork,
          data_plan: dataPlan,
          beneficiary: customerPhone,
        });
        console.log("Data fulfillment response:", {
          reference,
          status: result.status,
          reason: result.reason,
          url: result.url,
        });

        if (result.ok) {
          await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", reference);
          fulfilled = true;
        } else {
          await supabase.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: result.reason,
          }).eq("id", reference);
        }
      }
    }

    const { data: updatedOrder } = await supabase.from("orders").select("status, failure_reason").eq("id", reference).maybeSingle();

    return new Response(JSON.stringify({
      status: updatedOrder?.status || (fulfilled ? "fulfilled" : "pending"),
      failure_reason: updatedOrder?.failure_reason || null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});