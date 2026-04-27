import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, sendPaymentSms } from "../_shared/sms.ts";

function getFirstEnvValue(keys: string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key)?.trim();
    if (value) return value;
  }
  return "";
}


function buildProviderUrls(baseUrl: string, aliases: string[]): string[] {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return [];
  const urls = new Set<string>();

  let rootUrl = "";
  try { const parsed = new URL(clean); rootUrl = parsed.origin; } catch { rootUrl = ""; }

  // If baseUrl already ends with one of the alias paths, add it as-is first.
  for (const alias of aliases) {
    if (clean.endsWith(`/${alias}`) || clean.endsWith(`/api/${alias}`)) {
      urls.add(clean);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  let projectUrl = "";
  try {
    if (supabaseUrl) projectUrl = new URL(supabaseUrl).origin;
  } catch { /* ignore */ }

  // Build candidate URLs from the base.
  for (const alias of aliases) {
    if (clean.endsWith("/api")) {
      urls.add(`${clean}/${alias}`);
    } else {
      urls.add(`${clean}/api/${alias}`);
      urls.add(`${clean}/${alias}`);
    }
    if (rootUrl) {
      urls.add(`${rootUrl}/api/${alias}`);
      urls.add(`${rootUrl}/${alias}`);
      urls.add(`${rootUrl}/functions/v1/developer-api/${alias}`);
    }
    if (projectUrl) {
      urls.add(`${projectUrl}/functions/v1/developer-api/${alias}`);
    }
  }
  return Array.from(urls);
}

async function getAirtimeCredentials(supabaseAdmin: any): Promise<{ apiKey: string; directUrl: string; baseUrl: string }> {
  // Try fetching from DB first
  const { data: dbSettings } = await supabaseAdmin.from("system_settings").select("*").eq("id", 1).maybeSingle();

  const directUrl = getFirstEnvValue(["AIRTIME_PROVIDER_URL", "AIRTIME_API_URL"]).replace(/\/+$/, "");
  
  const apiKey = getFirstEnvValue([
    "AIRTIME_PROVIDER_API_KEY",
    "PRIMARY_DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_API_KEY",
    "DATA_PROVIDER_PRIMARY_API_KEY",
  ]) || dbSettings?.airtime_provider_api_key || dbSettings?.data_provider_api_key || "";
  
  const baseUrl = getFirstEnvValue([
    "AIRTIME_PROVIDER_BASE_URL",
    "PRIMARY_DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_BASE_URL",
    "DATA_PROVIDER_PRIMARY_BASE_URL",
  ]) || dbSettings?.data_provider_base_url || "";
  
  return { apiKey, directUrl, baseUrl: baseUrl.replace(/\/+$/, "") };
}

function isHtmlResponse(contentType: string | null, body: string): boolean {
  const preview = body.trim().slice(0, 200).toLowerCase();
  return Boolean(preview.startsWith("<!doctype html") || preview.startsWith("<html") || preview.includes("<title>"));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getProviderFailureReason(status: number, body: string, contentType: string | null): string {
  if (status === 404) return "Provider endpoint not found. Check API URL configuration.";
  if (isHtmlResponse(contentType, body)) return "Provider returned an HTML error page instead of a response.";
  try {
    const p = JSON.parse(body);
    return p.message || p.error || "Provider rejected the request.";
  } catch {
    const cleaned = stripHtml(body);
    return cleaned.length > 150 ? cleaned.slice(0, 147) + "..." : cleaned || "Unknown provider error";
  }
}

function mapNetworkKey(network: string, variant: number = 0): string {
  const n = network.trim().toUpperCase();
  if (n === "MTN" || n === "YELLO") return variant === 0 ? "MTN" : "MTN-GH";
  if (n === "VOD" || n === "VODAFONE" || n === "TELECEL") return variant === 0 ? "TELECEL" : "VODAFONE";
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return variant === 0 ? "AIRTELTIGO" : "AIRTEL-TIGO";
  if (n === "GLO") return "GLO";
  return n;
}

function getNetworkAliases(network: string): string[] {
  const normalized = network.trim().toUpperCase();
  if (normalized === "MTN" || normalized === "YELLO") return ["YELLO", "MTN"];
  if (normalized === "TELECEL" || normalized === "VODAFONE" || normalized === "VOD") return ["TELECEL", "TELECEL", "VODAFONE"];
  if (normalized === "AT" || normalized === "AIRTELTIGO" || normalized === "AT_PREMIUM") return ["AT_PREMIUM", "AT", "AIRTELTIGO"];
  return [network];
}

function normalizeRecipient(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return phone.trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await req.json().catch(() => null);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { network, phone, amount } = payload || {};
    const clientReference = typeof payload?.reference === "string" ? payload.reference.trim() : "";

    if (!network || !phone || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Missing required fields: network, phone, amount" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── IDEMPOTENCY CHECK ────────────────────────────────────────────────────
    if (clientReference) {
      const { data: existing } = await supabaseAdmin
        .from("orders")
        .select("id, status, failure_reason")
        .eq("id", clientReference)
        .eq("agent_id", user.id)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ 
          success: true, 
          order_id: existing.id, 
          status: existing.status,
          failure_reason: existing.failure_reason,
          reused: true 
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Atomic debit
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: amount,
    });

    if (debitError || !debitResult?.success) {
      return new Response(JSON.stringify({ error: debitResult?.error || "Insufficient balance" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orderId = clientReference || crypto.randomUUID();
    await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "airtime",
      network,
      customer_phone: normalizePhone(phone),
      amount,
      status: "paid",
    });

    const { apiKey, directUrl, baseUrl } = await getAirtimeCredentials(supabaseAdmin);
    if (!apiKey || (!directUrl && !baseUrl)) {
      // No provider configured — mock success
      await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: "Mock fulfillment (provider not configured)" }).eq("id", orderId);
      return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfilled", message: "Airtime purchase simulated" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Same provider endpoint as data — try all variations for maximum reliability
    const AIRTIME_ALIASES = ["purchase", "order", "airtime", "buy", "topup", "recharge"];
    const urls = buildProviderUrls(directUrl || baseUrl, AIRTIME_ALIASES);

    try {
      const networkKey = mapNetworkKey(network);
      const recipient = normalizeRecipient(phone);
      
      const airtimePayload = {
        customerNumber: recipient,
        amount: amount,
        networkCode: networkKey,
        description: `Airtime topup: GHS ${amount} for ${recipient}`
      };

      let lastError = "All provider endpoints failed (404 or connection error). Check AIRTIME_PROVIDER_URL.";

      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "X-API-Key": apiKey,
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(airtimePayload),
          });

          const contentType = res.headers.get("content-type");
          const resText = await res.text();

          if (res.ok && !isHtmlResponse(contentType, resText)) {
            // Parse response body — provider may return 200 with {"status": false}
            try {
              const parsed = JSON.parse(resText);
              const s = String(parsed?.status ?? "").toLowerCase();
              const success = parsed?.success === true || parsed?.status === "success" || parsed?.status === true;
              
              if (!success && (s === "false" || s === "error" || s === "failed" || s === "failure")) {
                lastError = parsed?.message || parsed?.reason || "Provider rejected the airtime request.";
                throw new Error(lastError);
              }
              
              // If we have success: true or equivalent, proceed
              if (success) {
                await supabaseAdmin.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
                await sendPaymentSms(supabaseAdmin, phone, "payment_success", {
                  service: `${network} Airtime`,
                  recipient: phone,
                  order_id: orderId.slice(0, 8).toUpperCase()
                });
                return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfilled" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }
            } catch (parseErr: any) {
              if (parseErr.message === lastError) throw parseErr;
              // Non-JSON 200 is treated as success if no error was explicitly parsed
            }
            
            await supabaseAdmin.from("orders").update({ status: "fulfilled" }).eq("id", orderId);
            return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfilled" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          } else {
            lastError = getProviderFailureReason(res.status, resText, contentType);
            if (res.status === 404) continue; // Try next URL alias
            throw new Error(lastError);
          }
        } catch (err: any) {
          if (url === urls[urls.length - 1]) throw err;
          console.warn(`[airtime] Alias failed: ${url}. Error: ${err.message}`);
        }
      }

      throw new Error(lastError);
    } catch (err: any) {
      const attemptedUrls = urls.join(", ");
      console.error(`[airtime] Fulfillment failed. Attempted URLs: ${attemptedUrls}. Error: ${err.message}`);
      
      await supabaseAdmin.from("orders").update({ 
        status: "fulfillment_failed", 
        failure_reason: err.message
      }).eq("id", orderId);
      
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: amount });
      
      let finalError = `Fulfillment failed: ${err.message}. Refunded.`;
      const isInsufficient = err.message.toLowerCase().includes("insufficient") || err.message.toLowerCase().includes("balance");
      
      let currentBalance = "Unknown";
      if (isInsufficient) {
        // Try to fetch current balance to show in error
        try {
          const balanceUrls = buildProviderUrls(directUrl || baseUrl, ["balance"]);
          for (const bUrl of balanceUrls) {
            const bRes = await fetch(bUrl, { headers: { "X-API-Key": apiKey, "Authorization": `Bearer ${apiKey}` } });
            if (bRes.ok) {
              const bData = await bRes.json();
              const bal = bData.balance ?? bData.data?.balance ?? bData.wallet_balance;
              if (bal !== undefined) {
                currentBalance = `GH₵ ${bal}`;
                break;
              }
            }
          }
        } catch { /* ignore balance fetch error */ }

        finalError = `Provider balance is insufficient (Current: ${currentBalance}). Please top up your provider wallet in Admin Settings. Your agent wallet has been refunded.`;
      }

      return new Response(JSON.stringify({ 
        error: finalError,
        diagnostics: {
          provider_error: err.message,
          attempted_urls: urls,
          api_key_used: apiKey ? `${apiKey.slice(0, 8)}...` : "missing",
          network_mapped: mapNetworkKey(network)
        }
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error(`[airtime] Global Error: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
