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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    // Upstream error handling
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
