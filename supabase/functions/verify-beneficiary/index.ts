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
    const body = await req.json().catch(() => ({}));
    if (body.action === "submit_numbers" || (body.numbers && !body.phone)) {
      const rawInput = body.numbers;
      if (!rawInput) {
        return new Response(
          JSON.stringify({ success: false, error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" }' }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      let items: string[] = [];
      if (Array.isArray(rawInput)) {
        items = rawInput.map((n: any) => String(n).trim()).filter(Boolean);
      } else if (typeof rawInput === "string") {
        items = rawInput.split(/[\n,\s]+/).map((n: string) => n.trim()).filter(Boolean);
      }

      const validNumbers: string[] = [];
      const invalidNumbers: string[] = [];

      for (const item of items) {
        const raw = String(item).trim();
        const digits = raw.replace(/\D/g, "");
        let normalized = "";
        if (digits.startsWith("233") && digits.length === 12) {
          normalized = "0" + digits.slice(3);
        } else if (digits.length === 9) {
          normalized = "0" + digits;
        } else if (digits.startsWith("0") && digits.length === 10) {
          normalized = digits;
        }

        const isValid = /^0(23|24|25|53|54|55|59|20|50|27|57|26|56)\d{7}$/.test(normalized);
        if (isValid) {
          if (!validNumbers.includes(normalized)) validNumbers.push(normalized);
        } else {
          if (!invalidNumbers.includes(raw)) invalidNumbers.push(raw);
        }
      }

      if (validNumbers.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "No valid phone numbers found", invalid: invalidNumbers }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: provider } = await supabaseClient
        .from("providers")
        .select("*")
        .eq("handler_type", "datahub")
        .eq("is_active", true)
        .maybeSingle();

      const apiKey = Deno.env.get("DATAHUB_API_KEY") || provider?.api_key || "";
      const cleanUrl = (Deno.env.get("DATAHUB_BASE_URL") || provider?.base_url || "https://user.datahubgh.com/api/external").trim().replace(/\/+$/, "");
      const targetUrl = cleanUrl.endsWith("/purchases/submit-numbers")
        ? cleanUrl
        : cleanUrl.includes("/purchases")
        ? `${cleanUrl}/submit-numbers`
        : `${cleanUrl}/purchases/submit-numbers`;

      try {
        const dhRes = await fetchViaDb(supabaseClient, targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({ numbers: validNumbers.join(", ") }),
          disableFallback: true,
        }, 10);

        const resText = await dhRes.text();
        let parsed: any = null;
        try { parsed = JSON.parse(resText); } catch {}

        if (dhRes.ok) {
          const resData = parsed?.data || {
            submitted: validNumbers.length,
            numbers: validNumbers,
            invalid: invalidNumbers,
            message: `${validNumbers.length} number(s) submitted for beneficiary approval`
          };
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                submitted: resData.submitted ?? validNumbers.length,
                numbers: resData.numbers ?? validNumbers,
                invalid: [...(resData.invalid || []), ...invalidNumbers],
                message: resData.message ?? `${validNumbers.length} number(s) submitted for beneficiary approval`
              }
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }

        if (parsed) {
          return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: dhRes.status });
        }
      } catch (err: any) {
        console.error("[verify-beneficiary/submit-numbers] Proxy error:", err);
      }

      return new Response(
        JSON.stringify({ success: false, error: "Failed to submit numbers for approval. Please try again later.", data: { submitted: 0, invalid: invalidNumbers } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
      );
    }

    const { phone, network } = body;
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

    // Normalize phone number to test both local 10-digit (0...) and intl 12-digit (233...) formats
    const cleanDigits = phone.replace(/\D/g, "");
    let localFormat = cleanDigits;
    let intlFormat = cleanDigits;

    if (cleanDigits.startsWith("233") && cleanDigits.length === 12) {
      localFormat = "0" + cleanDigits.slice(3);
    } else if (cleanDigits.length === 9) {
      localFormat = "0" + cleanDigits;
      intlFormat = "233" + cleanDigits;
    } else if (cleanDigits.startsWith("0") && cleanDigits.length === 10) {
      intlFormat = "233" + cleanDigits.slice(1);
    }

    const formatsToTest = [...new Set([localFormat, intlFormat])];

    // Check if the number has any successful order history (means it is already verified)
    const { data: hasHistory } = await supabaseClient
      .from("orders")
      .select("id")
      .in("status", ["fulfilled", "completed"])
      .or(`customer_phone.eq.${localFormat},customer_phone.eq.${intlFormat}`)
      .limit(1)
      .maybeSingle();

    if (hasHistory) {
      console.log(`[verify-beneficiary] Number ${localFormat} has successful order history. Automatically verified.`);
      return new Response(
        JSON.stringify({ success: true, exists: true, message: "Number verified via order history." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let exists = false;
    let text = "";
    let status = 200;

    for (const testPhone of formatsToTest) {
      console.log(`[verify-beneficiary] Testing DataHub variant: ${testPhone}`);
      try {
        const res = await fetchViaDb(supabaseClient, url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            phone: testPhone,
            is_ported_number: true
          }),
          disableFallback: true,
        }, 10);

        text = await res.text();
        status = res.status;
        console.log(`[verify-beneficiary] Response for ${testPhone} status ${res.status}: ${text}`);

        if (res.ok) {
          let parsed: any = {};
          try { parsed = JSON.parse(text); } catch { /* ignore */ }
          if (parsed.success || parsed.data?.exists) {
            exists = true;
            break;
          }
        }
      } catch (err) {
        console.error(`[verify-beneficiary] Error testing ${testPhone}:`, err);
      }
    }

    if (exists) {
      return new Response(
        JSON.stringify({ success: true, exists: true, message: "Number verified successfully." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    // Datamart API failover handles non-beneficiary numbers natively
    return new Response(
      JSON.stringify({ 
        success: true, 
        exists: true, 
        is_non_beneficiary: true,
        route_via_datamart: true,
        message: "Number verified for Datamart Instant API routing (No beneficiary registration required)." 
      }),
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
