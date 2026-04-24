import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = await req.json().catch(() => null);
    const rawCode = typeof payload?.code === "string" ? payload.code.trim().toUpperCase() : "";
    const rawPhone = typeof payload?.phone === "string" ? payload.phone.replace(/\D+/g, "") : "";

    if (!rawCode) {
      return new Response(JSON.stringify({ valid: false, error: "Promo code is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: promo, error } = await supabase
      .from("promo_codes")
      .select("id, code, discount_percentage, max_uses, current_uses, is_active, expires_at")
      .eq("code", rawCode)
      .maybeSingle();

    if (error || !promo) {
      return new Response(JSON.stringify({ valid: false, error: "Invalid promo code" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!promo.is_active) {
      return new Response(JSON.stringify({ valid: false, error: "This promo code is inactive" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return new Response(JSON.stringify({ valid: false, error: "This promo code has expired" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (promo.current_uses >= promo.max_uses) {
      return new Response(JSON.stringify({ valid: false, error: "Promo code has reached its claim limit" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If a phone is provided, check if it has already claimed this code
    if (rawPhone) {
      const { data: existing } = await supabase
        .from("promo_claims")
        .select("id")
        .eq("promo_code_id", promo.id)
        .eq("claimed_by_phone", rawPhone)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ valid: false, error: "You have already claimed this code" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const discountPct = Number(promo.discount_percentage);
    const isFree = discountPct >= 100;

    return new Response(JSON.stringify({
      valid: true,
      promo_id: promo.id,
      code: promo.code,
      discount_percentage: discountPct,
      is_free: isFree,
      uses_remaining: promo.max_uses - promo.current_uses,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("validate-promo error:", err);
    return new Response(JSON.stringify({ valid: false, error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
