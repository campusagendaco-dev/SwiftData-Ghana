import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create an admin client to fetch providers regardless of user token expiration
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { utility_type, provider, account_number, phone_number } = await req.json();

    if (!utility_type || !provider || (!account_number && !phone_number)) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch provider settings using admin client to bypass RLS
    const { data: activeProviders, error: providerError } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("provider_type", "utility")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (!activeProviders || activeProviders.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No active utility providers available" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find the right provider
    const activeProvider = activeProviders.find((p) => p.name === "Korba" || p.handler_type === "justbuy") || activeProviders[0];

    const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "PLACEHOLDER_CLIENT_ID";
    const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || "PLACEHOLDER_CLIENT_KEY";
    const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "PLACEHOLDER_SECRET_KEY";

    let lookupUrl = "";
    let payload: any = {};
    let isKorba = false;

    // Use Korba API for ECG Lookups
    if (provider === "ECG" || provider.includes("ECG")) {
      lookupUrl = "https://xchange.korba365.com/api/v1.0/ecg_meter_lookup/";
      payload = {
        client_id: parseInt(KORBA_CLIENT_ID) || 1, // Fallback integer if not set
        meter_code: account_number || phone_number
      };
      isKorba = true;
    } else {
      // Fallback to active provider (JustBuy/other) for other bill types
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
      // 1. Sort payload keys alphabetically
      const sortedKeys = Object.keys(payload).sort();
      
      // 2. Create message string
      const messageParts = [];
      for (const key of sortedKeys) {
          messageParts.push(`${key}=${payload[key]}`);
      }
      const message = messageParts.join("&");
      
      // 3. Generate HMAC-SHA256 signature
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

    const proxyUrl = Deno.env.get("FIXIE_URL") || Deno.env.get("QUOTAGUARDSTATIC_URL");
    const fetchOptions: any = {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    };

    if (proxyUrl) {
      const client = Deno.createHttpClient({ proxy: { url: proxyUrl } });
      fetchOptions.client = client;
    }

    const response = await fetch(lookupUrl, fetchOptions);

    const responseText = await response.text();
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseText);
    } catch (e) {
      console.error(`Invalid JSON from ${lookupUrl}: ${responseText}`, e);
      return new Response(JSON.stringify({ success: false, error: "Provider returned invalid response" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Handle missing Korba credentials gracefully for dev testing
    if (isKorba && response.status === 401 && KORBA_CLIENT_ID === "PLACEHOLDER_CLIENT_ID") {
      return new Response(JSON.stringify({ 
        success: true, 
        accountName: "JOHN DOE (KORBA MOCK)",
        raw: { success: true, message: "Mocked response due to missing Korba credentials" } 
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.ok || !jsonResponse.success) {
       const apiError = jsonResponse.error_message || jsonResponse.error || jsonResponse.message || (typeof jsonResponse.data === 'string' ? jsonResponse.data : JSON.stringify(jsonResponse));
       console.error("Korba API Error:", responseText);
       return new Response(JSON.stringify({ success: false, error: apiError }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let customerName = null;
    
    if (isKorba) {
      // Korba response format: { success: true, data: "John Doe" }
      customerName = jsonResponse.data;
    } else {
      // Legacy JustBuy response format
      if (jsonResponse.meters && jsonResponse.meters.length > 0) {
        customerName = jsonResponse.meters[0].customerName;
      } else if (jsonResponse.customerName) {
        customerName = jsonResponse.customerName;
      } else if (jsonResponse.data && jsonResponse.data.customerName) {
        customerName = jsonResponse.data.customerName;
      }
    }

    if (!customerName) {
       return new Response(JSON.stringify({ success: false, error: jsonResponse.error_message || jsonResponse.error || "Could not find customer name in response" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      accountName: customerName,
      raw: jsonResponse 
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Lookup error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
