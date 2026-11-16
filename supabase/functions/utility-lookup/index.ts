import "../deno.d.ts";
declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { fetchViaDb } from "../_shared/db_proxy.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatTo233(phone: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.startsWith("233") && digits.length === 12) return digits;
  if (digits.length === 9) return `233${digits}`;
  return "233240000000"; // fallback
}

function findName(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  
  const keys = ["customer_name", "customerName", "name", "client_name", "customer_number_name", "customer_name_name", "display_name", "fullName", "full_name", "Display", "display", "alias"];
  for (const k of keys) {
    if (obj[k] && typeof obj[k] === "string") return obj[k];
  }
  
  for (const k of Object.keys(obj)) {
    if (obj[k] && typeof obj[k] === "object") {
      const nested = findName(obj[k]);
      if (nested) return nested;
    }
  }
  return null;
}

function isValidGhanaPhone(phone: string): boolean {
  const digits = (phone || "").replace(/\D+/g, "");
  return (
    (digits.startsWith("0") && digits.length === 10) ||
    (digits.startsWith("233") && digits.length === 12) ||
    digits.length === 9
  );
}

function pickErrorMessage(res: any): string | null {
  if (!res || typeof res !== "object") return typeof res === "string" && res.trim() ? res.trim() : null;
  const results = res.results && typeof res.results === "object" ? res.results : null;
  const candidates = [
    typeof results?.data === "string" ? results.data : null,
    results?.error_message,
    results?.message,
    results?.error,
    results?.detail,
    res.error_message,
    res.error,
    res.detail,
    res.message,
    typeof res.data === "string" ? res.data : null,
    results?.data && typeof results.data === "object"
      ? results.data.message || results.data.detail || results.data.error
      : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const nested = c.message || c.detail || c.error || (typeof c.data === "string" ? c.data : null);
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  // DRF-style field errors: { "meter_number": ["This field is required."] }
  const fieldErrors = (res.errors && typeof res.errors === "object" ? res.errors : null)
    || (results?.errors && typeof results.errors === "object" ? results.errors : null);
  if (fieldErrors) {
    const first = Object.entries(fieldErrors)[0];
    if (first) return `${first[0]}: ${Array.isArray(first[1]) ? first[1][0] : first[1]}`;
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const { action, utility_type, provider, account_number, phone_number } = body;

    if (action === "add_meter") {
      const { alias, meter_number, phone_number: regPhone, meter_category, account_number: regAccount } = body;
      if (!alias || !meter_number || !regPhone || !meter_category) {
        return new Response(JSON.stringify({ success: false, error: "Missing required fields for Add Meter" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!isValidGhanaPhone(String(regPhone))) {
        return new Response(JSON.stringify({ success: false, error: "Please enter a valid 10-digit Ghana mobile phone number (e.g. 024XXXXXXX)." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: meterProviders } = await supabaseAdmin
        .from("providers")
        .select("*")
        .eq("provider_type", "utility")
        .order("priority", { ascending: true });
      const korbaProv = (meterProviders as any[])?.find((p: any) => p.is_active && p.name === "Korba")
        || (meterProviders as any[])?.find((p: any) => p.name === "Korba");

      const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || korbaProv?.settings?.client_id || "2419";
      const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || korbaProv?.api_key || korbaProv?.settings?.client_key || "";
      const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || korbaProv?.api_secret || korbaProv?.settings?.secret_key || "";

      if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
        return new Response(JSON.stringify({ success: false, error: "Korba credentials not configured" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const payload = {
        client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        alias: String(alias).trim(),
        meter_number: String(meter_number).trim(),
        phone_number: formatTo233(String(regPhone)),
        meter_category: String(meter_category).trim().toUpperCase(),
        account_number: regAccount ? String(regAccount).trim() : undefined
      };

      // Generate HMAC signature
      const sortedKeys = Object.keys(payload).sort();
      const messageParts = [];
      for (const key of sortedKeys) {
        if ((payload as any)[key] !== undefined) {
          messageParts.push(`${key}=${(payload as any)[key]}`);
        }
      }
      const message = messageParts.join("&");
      
      const keyData = new TextEncoder().encode(KORBA_SECRET_KEY);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const messageData = new TextEncoder().encode(message);
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      console.log("Sending Add Meter Request:", payload);
      const response = await fetchViaDb(supabaseAdmin, "https://xchange.korba365.com/api/v1.0/ecg_direct_add_meter/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`,
        },
        body: JSON.stringify(payload),
        disableFallback: true,
      });

      const responseText = await response.text();
      console.log("Add Meter response text:", responseText);

      let jsonResponse;
      try {
        jsonResponse = JSON.parse(responseText);
      } catch {
        console.error(`Add Meter: non-JSON response (HTTP ${response.status}):`, responseText.slice(0, 500));
        return new Response(JSON.stringify({ success: false, error: `Invalid response from Korba (HTTP ${response.status})` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (response.ok && jsonResponse?.success && jsonResponse?.results?.success !== false) {
        return new Response(JSON.stringify({ success: true, results: jsonResponse.results }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const reason = pickErrorMessage(jsonResponse) || `Failed to add meter (HTTP ${response.status}).`;

      // If ECG reports that this meter is already linked to the customer's account, treat as idempotent success
      // so the UI immediately verifies and loads the meter via the linked phone number instead of blocking the user.
      if (/already\s+exists/i.test(reason)) {
        console.log("Add Meter: meter already exists on account; returning idempotent success:", reason);
        return new Response(
          JSON.stringify({
            success: true,
            already_registered: true,
            message: reason,
            results: jsonResponse?.results ?? null,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.error(`Add Meter failed (HTTP ${response.status}):`, responseText.slice(0, 1000));
      return new Response(JSON.stringify({ success: false, error: reason }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!utility_type || !provider || (!account_number && !phone_number)) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: dbProviders } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("provider_type", "utility")
      .order("priority", { ascending: true });

    const activeProvider = (dbProviders as any[])?.find((p: any) => p.is_active && p.name === "Korba") 
      || (dbProviders as any[])?.find((p: any) => p.is_active)
      || (dbProviders as any[])?.find((p: any) => p.name === "Korba")
      || { name: "Korba", handler_type: "korba" };

    const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || activeProvider?.settings?.client_id || "2419";
    const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || activeProvider?.api_key || activeProvider?.settings?.client_key || "";
    const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || activeProvider?.api_secret || activeProvider?.settings?.secret_key || "";

    let lookupUrl = "";
    let payload: any = {};
    let isKorba = false;

    const provUpper = String(provider).toUpperCase();
    if (provUpper.includes("ECG")) {
      lookupUrl = "https://xchange.korba365.com/api/v1.0/ecg_direct_meter_detail/";
      let phoneVal = "";
      let accountVal = "";
      
      const lookupInput = (account_number || "").trim() || (phone_number || "").trim();
      const digits = lookupInput.replace(/\D+/g, "");
      const isGhanaMobilePhone = 
        ((digits.startsWith("02") || digits.startsWith("05")) && digits.length === 10) ||
        ((digits.startsWith("2332") || digits.startsWith("2335")) && digits.length === 12) ||
        ((digits.startsWith("2") || digits.startsWith("5")) && digits.length === 9);

      if (isGhanaMobilePhone) {
        phoneVal = formatTo233(lookupInput);
      } else {
        accountVal = lookupInput;
      }
      
      payload = {
        client_id: parseInt(KORBA_CLIENT_ID) || 2419
      };
      if (phoneVal) {
        payload.phone_number = phoneVal;
      } else {
        payload.account_number = accountVal;
      }
      isKorba = true;
    } else if (provUpper.includes("WATER") || provUpper.includes("GWCL")) {
      lookupUrl = "https://xchange.korba365.com/api/v1.0/gwcl_customer_lookup/";
      payload = {
        client_id: parseInt(KORBA_CLIENT_ID) || 2419,
        account_number: account_number
      };
      isKorba = true;
    } else if (provUpper.includes("DSTV") || provUpper.includes("GOTV") || provUpper.includes("STARTIMES") || provUpper.includes("KWESE") || provUpper.includes("GBC")) {
      lookupUrl = "https://xchange.korba365.com/api/v1.0/utilities_validate_user/";
      let billType = "DSTV";
      if (provUpper.includes("GOTV")) billType = "GOTV";
      else if (provUpper.includes("STARTIMES")) billType = "STARTIMES";
      else if (provUpper.includes("KWESE")) billType = "KWESETV";
      else if (provUpper.includes("GBC")) billType = "GBCTV";

      payload = {
        customer_number: account_number,
        bill_type: billType,
        transaction_id: crypto.randomUUID(),
        client_id: parseInt(KORBA_CLIENT_ID) || 2419
      };
      isKorba = true;
    } else {
      lookupUrl = `${activeProvider.base_url}/api/payment/bills/lookup`;
      payload = {
        customerNumber: account_number,
        billType: provider
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (isKorba) {
      const sortedKeys = Object.keys(payload).sort();
      const messageParts = [];
      for (const key of sortedKeys) {
        messageParts.push(`${key}=${payload[key]}`);
      }
      const message = messageParts.join("&");
      
      const keyData = new TextEncoder().encode(KORBA_SECRET_KEY);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      
      const messageData = new TextEncoder().encode(message);
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
      
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      headers["Authorization"] = `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`;
    } else {
      headers["Authorization"] = `Bearer ${activeProvider.api_key}`;
      headers["X-API-Key"] = activeProvider.api_key;
    }

    const response = await fetchViaDb(supabaseAdmin, lookupUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseText);
    } catch (e) {
      console.error(`Invalid JSON from ${lookupUrl}: ${responseText}`, e);
      return new Response(JSON.stringify({ success: false, error: "Provider returned invalid response" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (isKorba && response.status === 401 && KORBA_CLIENT_ID === "PLACEHOLDER_CLIENT_ID") {
      return new Response(JSON.stringify({ 
        success: true, 
        accountName: "JOHN DOE (KORBA MOCK)",
        raw: { success: true, message: "Mocked response due to missing Korba credentials" } 
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.ok || !jsonResponse.success) {
      let apiError = jsonResponse.error_message || jsonResponse.error || jsonResponse.message || (typeof jsonResponse.data === 'string' ? jsonResponse.data : JSON.stringify(jsonResponse));
      
      const fullResponseStr = typeof jsonResponse === 'object' ? JSON.stringify(jsonResponse) : String(responseText);
      const errorLower = fullResponseStr.toLowerCase();
      const isNoMeters = errorLower.includes("no meters") || errorLower.includes("no_meters") || errorLower.includes("could not process") || errorLower.includes("phone_number");

      if (provUpper.includes("ECG") && isNoMeters) {
        apiError = "No ECG meters found. For ECG Prepaid, please enter the phone number linked to your ECG PowerApp mobile app (e.g. 054XXXXXXX), not the physical prepaid card/meter number.";
      }

      console.error("Korba API Error:", responseText);
      return new Response(JSON.stringify({ success: false, error: apiError }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (provUpper.includes("ECG") && (!jsonResponse.results?.data || (Array.isArray(jsonResponse.results.data) && jsonResponse.results.data.length === 0))) {
      return new Response(JSON.stringify({ success: false, error: "No meters found. For ECG Prepaid, please enter the phone number linked to your ECG PowerApp mobile app (e.g. 054XXXXXXX), not the physical prepaid card/meter number." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const customerName = findName(jsonResponse.data) || findName(jsonResponse);

    if (!customerName) {
      return new Response(JSON.stringify({ success: false, error: jsonResponse.error_message || jsonResponse.error || "Could not find customer name in response" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      accountName: customerName,
      meters: jsonResponse.results?.data || null,
      raw: jsonResponse 
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Lookup error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
