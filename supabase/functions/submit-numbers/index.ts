import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchViaDb } from "../_shared/db_proxy.ts";

declare const Deno: any;

function normalizeGhanaPhone(phone: string): { normalized: string; isValid: boolean; raw: string } {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");

  let normalized = "";
  if (digits.startsWith("233") && digits.length === 12) {
    normalized = "0" + digits.slice(3);
  } else if (digits.length === 9) {
    normalized = "0" + digits;
  } else if (digits.startsWith("0") && digits.length === 10) {
    normalized = digits;
  }

  // Validate Ghanaian 10-digit mobile number starting with 0
  const isValid = /^0(23|24|25|53|54|55|59|20|50|27|57|26|56)\d{7}$/.test(normalized);

  return {
    normalized: isValid ? normalized : raw,
    isValid,
    raw,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // This endpoint has no auth (verify_jwt = false, by design — it's called
    // by anonymous visitors from the public Submit Numbers form) and also
    // triggers the Korba bridge/proxy chain per request, so it needs its own
    // throttle to prevent spam/abuse from burning proxy bandwidth or hammering
    // the upstream provider.
    const clientIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "anon";
    const { data: withinLimit } = await supabaseClient.rpc("check_generic_rate_limit", {
      p_key: `submit_numbers:${clientIp}`,
      p_rate_limit: 10, // max 10 submission requests per minute per IP
    });
    if (withinLimit === false) {
      return new Response(
        JSON.stringify({ success: false, error: "Too many submissions. Please wait a moment and try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const rawNumbersInput = body.numbers;

    if (!rawNumbersInput) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    let items: string[] = [];
    if (Array.isArray(rawNumbersInput)) {
      items = rawNumbersInput.map((n) => String(n).trim()).filter(Boolean);
    } else if (typeof rawNumbersInput === "string") {
      items = rawNumbersInput
        .split(/[\n,\s]+/)
        .map((n) => n.trim())
        .filter(Boolean);
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (items.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'numbers is required — e.g. { "numbers": "0241234567, 0551234569" } or { "numbers": ["0241234567"] }',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (items.length > 30) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Maximum 30 numbers allowed per request (got ${items.length})`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const validNumbers: string[] = [];
    const invalidNumbers: string[] = [];

    for (const item of items) {
      const parsed = normalizeGhanaPhone(item);
      if (parsed.isValid) {
        if (!validNumbers.includes(parsed.normalized)) {
          validNumbers.push(parsed.normalized);
        }
      } else {
        if (!invalidNumbers.includes(parsed.raw)) {
          invalidNumbers.push(parsed.raw);
        }
      }
    }

    if (validNumbers.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No valid phone numbers found",
          invalid: invalidNumbers,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Retrieve active DataHub provider config
    const { data: provider } = await supabaseClient
      .from("providers")
      .select("*")
      .eq("handler_type", "datahub")
      .eq("is_active", true)
      .maybeSingle();

    // Priority to Environment Secrets as per system rule:
    const apiKey = Deno.env.get("DATAHUB_API_KEY") || provider?.api_key || "";
    const rawBaseUrl = Deno.env.get("DATAHUB_BASE_URL") || provider?.base_url || "https://user.datahubgh.com/api/external";
    const cleanUrl = rawBaseUrl.trim().replace(/\/+$/, "");

    if (!apiKey) {
      console.warn("[submit-numbers] DataHub API key is missing.");
    }

    const targetUrl = cleanUrl.endsWith("/purchases/submit-numbers")
      ? cleanUrl
      : cleanUrl.includes("/purchases")
      ? `${cleanUrl}/submit-numbers`
      : `${cleanUrl}/purchases/submit-numbers`;

    console.log(`[submit-numbers] Proxying ${validNumbers.length} number(s) to DataHub: ${targetUrl}`);

    let dhResponse: Response;
    try {
      dhResponse = await fetchViaDb(
        supabaseClient,
        targetUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            numbers: validNumbers.join(", "),
          }),
          disableFallback: true,
        },
        10
      );
    } catch (err: any) {
      console.error("[submit-numbers] DataHub connection error:", err);

      // We never even got a response from the provider — record that plainly
      // rather than let these numbers disappear with no trace.
      try {
        const unreachedRecords = validNumbers.map((num) => ({
          phone_number: num,
          network: "MTN",
          status: "failed",
          source: "submit-numbers-api",
          submitted_by: "API User",
          notes: `Never reached provider — connection error: ${String(err?.message || err).slice(0, 200)}`,
          provider_status_code: null,
        }));
        const { error: logErr } = await supabaseClient
          .from("beneficiary_submissions")
          .upsert(unreachedRecords, { onConflict: "phone_number" });
        if (logErr) console.error("[submit-numbers] DB failure-record FAILED:", logErr);
      } catch (e) {
        console.error("[submit-numbers] DB failure-record FAILED:", e);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to submit numbers for approval. Please try again later.",
          data: {
            submitted: 0,
            invalid: invalidNumbers,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
      );
    }

    const resText = await dhResponse.text();
    console.log(`[submit-numbers] DataHub status ${dhResponse.status}: ${resText}`);

    let parsedResponse: any = null;
    try {
      parsedResponse = JSON.parse(resText);
    } catch {
      /* ignore non-json */
    }

    if (dhResponse.ok) {
      const responseData = parsedResponse?.data || {
        submitted: validNumbers.length,
        numbers: validNumbers,
        invalid: invalidNumbers,
        message: `${validNumbers.length} number(s) submitted for beneficiary approval`,
      };

      // Record to beneficiary_submissions database table (upsert so retries/
      // duplicate tiers update the existing row per number instead of
      // piling up duplicates)
      try {
        const recordsToUpsert = validNumbers.map((num) => ({
          phone_number: num,
          network: "MTN",
          status: "submitted",
          source: "submit-numbers-api",
          submitted_by: "API User",
          notes: `Submitted via submit-numbers Edge Function — provider responded ${dhResponse.status}`,
          provider_status_code: dhResponse.status,
        }));
        const { error: logErr } = await supabaseClient
          .from("beneficiary_submissions")
          .upsert(recordsToUpsert, { onConflict: "phone_number" });
        if (logErr) console.error("[submit-numbers] DB record FAILED:", logErr);
      } catch (e) {
        console.error("[submit-numbers] DB record FAILED:", e);
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            submitted: responseData.submitted ?? validNumbers.length,
            numbers: responseData.numbers ?? validNumbers,
            invalid: [...(responseData.invalid || []), ...invalidNumbers],
            message: responseData.message ?? `${validNumbers.length} number(s) submitted for beneficiary approval`,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Upstream error handling — log the rejection too so these numbers are
    // still visible to admin instead of silently vanishing.
    try {
      const failedRecords = validNumbers.map((num) => ({
        phone_number: num,
        network: "MTN",
        status: "failed",
        source: "submit-numbers-api",
        submitted_by: "API User",
        notes: `Provider rejected — HTTP ${dhResponse.status}: ${resText.slice(0, 200)}`,
        provider_status_code: dhResponse.status,
      }));
      const { error: logErr } = await supabaseClient
        .from("beneficiary_submissions")
        .upsert(failedRecords, { onConflict: "phone_number" });
      if (logErr) console.error("[submit-numbers] DB failure-record FAILED:", logErr);
    } catch (e) {
      console.error("[submit-numbers] DB failure-record FAILED:", e);
    }

    if (parsedResponse) {
      return new Response(JSON.stringify(parsedResponse), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: dhResponse.status,
      });
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to submit numbers for approval. Please try again later.",
        data: {
          submitted: 0,
          invalid: invalidNumbers,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
    );
  } catch (err: any) {
    console.error("[submit-numbers] Execution error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to submit numbers for approval",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
