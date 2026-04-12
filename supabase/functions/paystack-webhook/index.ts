import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

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

function buildProviderUrls(baseUrl: string, endpoint: string): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return [];

  const urls = new Set<string>();

  if (clean.endsWith(`/${endpoint}`) || clean.endsWith(`/api/${endpoint}`)) {
    urls.add(clean);
  }

  if (clean.endsWith("/api")) {
    urls.add(`${clean}/${endpoint}`);
    urls.add(`${clean.replace(/\/api$/, "")}/api/${endpoint}`);
  } else {
    urls.add(`${clean}/api/${endpoint}`);
    urls.add(`${clean}/${endpoint}`);
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
  body: string;
  reason: string;
  url: string | null;
};

async function callProviderApi(
  baseUrl: string,
  apiKey: string,
  endpoint: "order" | "afa-registration",
  body: Record<string, unknown>,
): Promise<ProviderResult> {
  const urls = buildProviderUrls(baseUrl, endpoint);

  let lastFailure: ProviderResult = {
    ok: false,
    status: 502,
    body: "",
    reason: "Provider request failed",
    url: null,
  };

  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(url, {
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
        const contentType = response.headers.get("content-type");
        const text = await response.text();

        if (response.ok) {
          return { ok: true, status: response.status, body: text, reason: "", url };
        }

        const reason = getProviderFailureReason(response.status, text, contentType);
        lastFailure = { ok: false, status: response.status, body: text, reason, url };

        const retryable = response.status >= 500 || response.status === 429;
        const tryNextUrl = response.status === 404 || (isHtmlResponse(contentType, text) && response.status !== 401 && response.status !== 403);

        if (retryable && attempt < 3) {
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
          body: "",
          reason: error instanceof Error ? `Provider request failed: ${error.message}` : "Provider request failed",
          url,
        };

        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }
    }
  }

  return lastFailure;
}

function buildAfaPayload(metadata: Record<string, unknown>) {
  return {
    fullName: metadata.afa_full_name,
    ghanaCardNumber: metadata.afa_ghana_card,
    occupation: metadata.afa_occupation,
    email: metadata.afa_email,
    placeOfResidence: metadata.afa_residence,
    dateOfBirth: metadata.afa_date_of_birth,
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
    console.error("Missing required secrets");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const hash = createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  if (hash !== signature) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = JSON.parse(rawBody);
    if (body.event !== "charge.success") {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { reference, metadata = {} } = body.data;
    console.log("Webhook: Payment successful for reference:", reference);

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.status || verifyData.data.status !== "success") {
      console.error("Payment verification failed:", verifyData);
      return new Response(JSON.stringify({ error: "Payment verification failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderId = metadata?.order_id || reference;
    const orderType = metadata?.order_type;

    await supabase.from("orders").update({ status: "paid", failure_reason: null }).eq("id", orderId);

    if (orderType === "agent_activation") {
      const agentId = metadata?.agent_id;
      if (agentId) {
        await supabase.from("profiles").update({ is_agent: true, agent_approved: true }).eq("user_id", agentId);
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        console.log("Agent activated via webhook:", agentId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
      }
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
      console.error("Data provider not configured for fulfillment");
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: "Data provider not configured",
      }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderType === "afa") {
      const result = await callProviderApi(
        DATA_PROVIDER_BASE_URL,
        DATA_PROVIDER_API_KEY,
        "afa-registration",
        buildAfaPayload(metadata),
      );

      console.log("Webhook AFA fulfillment response:", {
        orderId,
        status: result.status,
        reason: result.reason,
        url: result.url,
      });

      if (result.ok) {
        await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
        return new Response(JSON.stringify({ received: true, fulfilled: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: result.reason }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const network = typeof metadata?.network === "string" ? metadata.network : "";
    const packageSize = typeof metadata?.package_size === "string" ? metadata.package_size : "";
    const customerPhone = typeof metadata?.customer_phone === "string" ? metadata.customer_phone : "";

    if (!network || !packageSize || !customerPhone) {
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: "Missing order details for fulfillment.",
      }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: "Missing order details for fulfillment." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await callProviderApi(
      DATA_PROVIDER_BASE_URL,
      DATA_PROVIDER_API_KEY,
      "order",
      {
        network: mapNetworkToApi(network),
        data_plan: formatDataPlan(packageSize),
        beneficiary: customerPhone,
      },
    );

    console.log("Webhook data fulfillment response:", {
      orderId,
      status: result.status,
      reason: result.reason,
      url: result.url,
    });

    if (result.ok) {
      await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
      return new Response(JSON.stringify({ received: true, fulfilled: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("orders").update({ status: "fulfillment_failed", failure_reason: result.reason }).eq("id", orderId);
    return new Response(JSON.stringify({ received: true, fulfilled: false, failure_reason: result.reason }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});