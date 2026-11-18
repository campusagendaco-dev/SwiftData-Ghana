import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim() || "";

  if (!PAYSTACK_SECRET_KEY) {
    try {
      const { data: settings } = await supabaseAdmin
        .from("v_system_settings_with_secrets").select("paystack_secret_key")
        .eq("id", 1)
        .maybeSingle();
      PAYSTACK_SECRET_KEY = settings?.paystack_secret_key || "";
    } catch (dbErr) {
      console.error("Failed to fetch paystack_secret_key from DB:", dbErr);
    }
  }

  if (!PAYSTACK_SECRET_KEY) {
    console.error("PAYSTACK_SECRET_KEY is not set");
    return new Response(JSON.stringify({ error: "Paystack secret key is missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const clientIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const { data: rateAllowed } = await supabaseAdmin.rpc("check_generic_rate_limit", {
      p_key: `paystack_resolve:${clientIp}`,
      p_rate_limit: 15,
    });
    if (rateAllowed === false) {
      return new Response(JSON.stringify({ error: "Too many account verification requests. Please wait a minute." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { account_number, bank_code } = await req.json();
    const cleanAccount = String(account_number ?? "").trim();
    const cleanBank = String(bank_code ?? "").trim();

    if (!cleanAccount || !cleanBank) {
      return new Response(JSON.stringify({ error: "Account number and bank code are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!/^\d{6,20}$/.test(cleanAccount) || !/^[A-Za-z0-9]{2,12}$/.test(cleanBank)) {
      return new Response(JSON.stringify({ error: "Invalid account number or bank code format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(cleanAccount)}&bank_code=${encodeURIComponent(cleanBank)}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      if (PAYSTACK_SECRET_KEY.startsWith("sk_test_")) {
        return new Response(JSON.stringify({
          success: true,
          account_name: "TESTING ACCOUNT NAME",
          account_number: account_number,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Ghanaian Mobile Money networks do not support name verification on Paystack live
      const isMomo = ["MTN", "VOD", "ATL"].includes(String(bank_code).toUpperCase());
      if (isMomo) {
        return new Response(JSON.stringify({
          success: true,
          account_name: "Mobile Money User",
          account_number: account_number,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ 
        success: false,
        error: data.message || "Failed to resolve account",
        details: data
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      account_name: data.data.account_name,
      account_number: data.data.account_number,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Paystack Resolve Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
