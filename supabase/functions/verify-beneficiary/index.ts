import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchViaDb } from "../_shared/db_proxy.ts";

declare const Deno: any;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { phone, network } = await req.json();
    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone number is required." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Only MTN numbers require the carrier beneficiary check
    const net = String(network || "").toUpperCase();
    if (!net.includes("MTN") && !net.includes("YELLO")) {
      return new Response(
        JSON.stringify({ success: true, exists: true, message: "Only MTN numbers require beneficiary validation." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if beneficiary verification is enabled in system settings
    const { data: settings } = await supabaseClient
      .from("system_settings")
      .select("beneficiary_verification_enabled")
      .eq("id", 1)
      .maybeSingle();

    if (settings && settings.beneficiary_verification_enabled === false) {
      console.log("[verify-beneficiary] Verification is globally disabled in system settings.");
      return new Response(
        JSON.stringify({ success: true, exists: true, message: "Beneficiary verification is disabled." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Retrieve active DataHub provider config
    const { data: provider, error: pErr } = await supabaseClient
      .from("providers")
      .select("*")
      .eq("handler_type", "datahub")
      .eq("is_active", true)
      .maybeSingle();

    if (pErr || !provider) {
      console.log("[verify-beneficiary] No active DataHub provider found, skipping check.");
      return new Response(
        JSON.stringify({ success: true, exists: true, message: "DataHub provider not active, skipping verification." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanUrl = (provider.base_url || "").trim().replace(/\/+$/, "");
    const url = `${cleanUrl}/purchases/verify-number`;
    const apiKey = provider.api_key || "";

    console.log(`[verify-beneficiary] Fetching DataHub verification for phone: ${phone}`);
    const res = await fetchViaDb(supabaseClient, url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        phone: phone,
        is_ported_number: true
      }),
      disableFallback: true,
    }, 12); // Short timeout for frontend responsiveness

    const text = await res.text();
    console.log(`[verify-beneficiary] DataHub response status ${res.status}: ${text}`);

    if (res.ok) {
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      if (parsed.success || parsed.data?.exists) {
        return new Response(
          JSON.stringify({ success: true, exists: true, message: "Number verified successfully." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Parse the error message if check fails
    let errorMessage = `${phone} is not added to our beneficiary list`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error && parsed.message) {
        errorMessage = parsed.message;
      } else if (parsed["Not on beneficiary list"]?.message) {
        errorMessage = parsed["Not on beneficiary list"].message;
      } else if (parsed["Not on beneficiary list"]?.error) {
        errorMessage = parsed["Not on beneficiary list"].error;
      } else if (parsed.message) {
        errorMessage = parsed.message;
      }
    } catch { /* ignore */ }

    return new Response(
      JSON.stringify({ success: true, exists: false, error: "Not on beneficiary list", message: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[verify-beneficiary] Verification error:", err);
    return new Response(
      JSON.stringify({ 
        success: false, 
        exists: false, 
        error: "Verification service unavailable", 
        message: "MTN beneficiary verification is currently offline. Please try again shortly." 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
