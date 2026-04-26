import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function getEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = Deno.env.get(k)?.trim();
    if (v) return v;
  }
  return "";
}

function mapNetworkKey(network: string): string {
  const n = network.trim().toUpperCase();
  if (n === "AIRTELTIGO" || n === "AIRTEL TIGO" || n === "AT") return "AT_PREMIUM";
  if (n === "TELECEL" || n === "VODAFONE") return "TELECEL";
  if (n === "MTN") return "YELLO";
  return n;
}

function parseCapacity(pkg: string): number {
  const m = pkg.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function normalizeRecipient(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return phone.trim();
}

function isHtml(ct: string | null, body: string): boolean {
  const p = body.trim().slice(0, 200).toLowerCase();
  return Boolean(ct?.includes("text/html") || p.startsWith("<!doctype") || p.startsWith("<html"));
}

async function callProvider(
  baseUrl: string,
  apiKey: string,
  network: string,
  packageSize: string,
  phone: string,
  webhookUrl: string,
): Promise<{ ok: boolean; reason: string }> {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  const aliases = ["purchase", "order", "airtime", "buy"];
  let rootUrl = "";
  try {
    const parsed = new URL(clean);
    rootUrl = parsed.origin;
  } catch {
    rootUrl = "";
  }

  for (const alias of aliases) {
    candidates.add(`${clean}/api/${alias}`);
    candidates.add(`${clean}/${alias}`);
    if (rootUrl) {
      candidates.add(`${rootUrl}/api/${alias}`);
      candidates.add(`${rootUrl}/${alias}`);
    }
  }

  const body: Record<string, unknown> = {
    networkRaw: network,
    networkKey: mapNetworkKey(network),
    recipient: normalizeRecipient(phone),
    capacity: parseCapacity(packageSize),
  };
  if (webhookUrl) body.webhook_url = webhookUrl;

  for (const url of candidates) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const text = await res.text();
      if (res.ok && !isHtml(res.headers.get("content-type"), text)) {
        try {
          const parsed = JSON.parse(text);
          const s = String(parsed?.status || "").toLowerCase();
          if (s === "false" || s === "error" || s === "failed") {
            return { ok: false, reason: parsed?.message || "Provider rejected the order" };
          }
        } catch { /* non-JSON 2xx treated as ok */ }
        return { ok: true, reason: "" };
      }
      if (res.status === 404 || isHtml(res.headers.get("content-type"), text)) continue;
      const reason = `Provider error ${res.status}`;
      return { ok: false, reason };
    } catch (e) {
      clearTimeout(tid);
      if (url === [...candidates].at(-1)) {
        return { ok: false, reason: e instanceof Error ? e.message : "Provider unreachable" };
      }
    }
  }
  return { ok: false, reason: "All provider endpoints failed" };
}

async function sendSms(phone: string, message: string) {
  const apiKey = getEnv("TXTCONNECT_API_KEY");
  const senderId = getEnv("TXTCONNECT_SENDER_ID") || "SwiftDataGh";
  const digits = phone.replace(/\D+/g, "");
  const to = digits.startsWith("0") && digits.length === 10
    ? `233${digits.slice(1)}`
    : (digits.startsWith("233") ? digits : digits);
  if (!apiKey || !to) return;
  try {
    await fetch("https://api.txtconnect.net/dev/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ to, from: senderId, sms: message }),
    });
  } catch { /* non-critical */ }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Check ordering is enabled
    const { data: sysSettings } = await supabase
      .from("system_settings").select("disable_ordering, holiday_message").eq("id", 1).maybeSingle();
    if (sysSettings?.disable_ordering) {
      return new Response(JSON.stringify({
        error: sysSettings.holiday_message || "Ordering is currently disabled.",
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = await req.json().catch(() => null);
    const promoCode = typeof payload?.promo_code === "string" ? payload.promo_code.trim().toUpperCase() : "";
    const phone = typeof payload?.phone === "string" ? payload.phone.replace(/\D+/g, "") : "";
    const network = typeof payload?.network === "string" ? payload.network.trim() : "";
    const packageSize = typeof payload?.package_size === "string" ? payload.package_size.trim() : "";

    if (!promoCode || !phone || !network || !packageSize) {
      return new Response(JSON.stringify({ error: "Missing required fields: promo_code, phone, network, package_size" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validPhone = phone.length >= 9 && phone.length <= 12;
    if (!validPhone) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ALLOWED_NETWORKS = ["MTN", "Telecel", "AirtelTigo"];
    if (!ALLOWED_NETWORKS.includes(network)) {
      return new Response(JSON.stringify({ error: "Invalid network" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check package exists and is available
    const normalizedNet = network;
    const normalizedPkg = packageSize.replace(/\s+/g, "").toUpperCase();
    const { data: pkgRow } = await supabase
      .from("global_package_settings")
      .select("public_price, agent_price, is_unavailable")
      .eq("network", normalizedNet)
      .eq("package_size", normalizedPkg)
      .maybeSingle();

    if (pkgRow?.is_unavailable) {
      return new Response(JSON.stringify({ error: "This package is currently unavailable" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const originalPrice = Number(pkgRow?.public_price) > 0
      ? Number(pkgRow!.public_price)
      : Number(pkgRow?.agent_price) || 0;

    // Atomically claim the promo code via DB function
    const { data: claimRows, error: claimError } = await supabase.rpc("claim_promo_code", {
      p_code: promoCode,
      p_phone: phone,
    });

    if (claimError || !claimRows || claimRows.length === 0) {
      // Distinguish "already claimed" vs "invalid code"
      const { data: existingPromo } = await supabase
        .from("promo_codes")
        .select("id, current_uses, max_uses, is_active, expires_at")
        .eq("code", promoCode)
        .maybeSingle();

      let reason = "Invalid or inactive promo code";
      if (existingPromo) {
        if (!existingPromo.is_active) reason = "This promo code is inactive";
        else if (existingPromo.expires_at && new Date(existingPromo.expires_at) < new Date()) reason = "Promo code has expired";
        else if (existingPromo.current_uses >= existingPromo.max_uses) reason = "Promo code has been fully claimed";
        else {
          // Check if already claimed by this phone
          const { data: alreadyClaimed } = await supabase
            .from("promo_claims")
            .select("id")
            .eq("promo_code_id", existingPromo.id)
            .eq("claimed_by_phone", phone)
            .maybeSingle();
          if (alreadyClaimed) reason = "You have already claimed this code";
        }
      }

      return new Response(JSON.stringify({ error: reason }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimResult = claimRows[0] as { promo_id: string; discount_percentage: number; is_free: boolean };

    if (!claimResult.is_free) {
      // Partial discount codes should go through Paystack — this endpoint is free-data only
      // Rollback by decrementing (best-effort)
      await supabase
        .from("promo_codes")
        .update({ current_uses: supabase.rpc("claim_promo_code" as any, {}) as any })
        .eq("id", claimResult.promo_id);
      return new Response(JSON.stringify({ error: "This code is a discount code, not a free data code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create order record
    const orderId = crypto.randomUUID();
    await supabase.from("orders").insert({
      id: orderId,
      order_type: "free_data_claim",
      network,
      package_size: packageSize,
      customer_phone: phone,
      amount: 0,
      profit: 0,
      parent_profit: 0,
      status: "paid",
      promo_code_id: claimResult.promo_id,
      discount_amount: originalPrice,
    });

    // Update claim with order_id
    await supabase
      .from("promo_claims")
      .update({ order_id: orderId })
      .eq("promo_code_id", claimResult.promo_id)
      .eq("claimed_by_phone", phone);

    // Trigger data provider
    const DATA_PROVIDER_API_KEY = getEnv("PRIMARY_DATA_PROVIDER_API_KEY", "DATA_PROVIDER_API_KEY");
    const DATA_PROVIDER_BASE_URL = getEnv("PRIMARY_DATA_PROVIDER_BASE_URL", "DATA_PROVIDER_BASE_URL").replace(/\/+$/, "");
    const WEBHOOK_URL = getEnv("DATA_PROVIDER_WEBHOOK_URL", "PRIMARY_DATA_PROVIDER_WEBHOOK_URL");

    if (!DATA_PROVIDER_API_KEY || !DATA_PROVIDER_BASE_URL) {
      await supabase.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: "Data provider not configured",
      }).eq("id", orderId);
      return new Response(JSON.stringify({
        success: false,
        order_id: orderId,
        error: "Data provider not configured — your claim was recorded. Contact support.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await callProvider(DATA_PROVIDER_BASE_URL, DATA_PROVIDER_API_KEY, network, packageSize, phone, WEBHOOK_URL);

    if (result.ok) {
      await supabase.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", orderId);
      await sendSms(phone, `Your free ${packageSize} ${network} data bundle has been sent! Reference: ${orderId.slice(0, 8).toUpperCase()}. Thanks for using SwiftData GH.`);
      return new Response(JSON.stringify({ success: true, order_id: orderId, status: "fulfilled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("orders").update({
      status: "fulfillment_failed",
      failure_reason: result.reason,
    }).eq("id", orderId);

    return new Response(JSON.stringify({
      success: false,
      order_id: orderId,
      status: "fulfillment_failed",
      error: `Data delivery failed: ${result.reason}. Your claim was recorded — contact support with ref ${orderId.slice(0, 8).toUpperCase()}.`,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("claim-free-data error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
