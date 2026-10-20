import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const DEFAULT_MAX_FREE_DATA_GB = 2;

function parsePackageSizeGb(rawSize: string): number | null {
  const cleaned = String(rawSize || "").trim().toUpperCase();
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB)?/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const unit = (match[2] || "GB").toUpperCase();
  if (unit === "MB") return val / 1024;
  if (unit === "TB") return val * 1024;
  return val;
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
    const { data: sysSettings } = await supabase
      .from("v_system_settings_with_secrets").select("disable_ordering, holiday_message").eq("id", 1).maybeSingle();
    if (sysSettings?.disable_ordering) {
      return new Response(JSON.stringify({
        error: sysSettings.holiday_message || "Ordering is currently disabled.",
        success: false
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payload = await req.json().catch(() => null);
    const promoCode = typeof payload?.promo_code === "string" ? payload.promo_code.trim().toUpperCase() : "";
    const phone = typeof payload?.phone === "string" ? payload.phone.replace(/\D+/g, "") : "";
    const network = typeof payload?.network === "string" ? payload.network.trim() : "";
    const packageSize = typeof payload?.package_size === "string" ? payload.package_size.trim() : "";

    if (!promoCode || !phone || !network || !packageSize) {
      return new Response(JSON.stringify({ error: "Missing required fields", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let cleanPhone = phone;
    if (phone.startsWith("233") && phone.length === 12) {
      cleanPhone = `0${phone.slice(3)}`;
    } else if (phone.length === 9) {
      cleanPhone = `0${phone}`;
    }

    const validPhone = cleanPhone.length >= 9 && cleanPhone.length <= 12;
    if (!validPhone) {
      return new Response(JSON.stringify({ error: "Invalid phone number", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-validate promo code and enforce server-side maximum package size cap BEFORE burning the claim
    const { data: promoRow } = await supabase
      .from("promo_codes")
      .select("*")
      .eq("code", promoCode)
      .maybeSingle();

    if (!promoRow || promoRow.is_active === false) {
      return new Response(JSON.stringify({ error: "Invalid or inactive promo code", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!promoRow.is_free) {
      return new Response(JSON.stringify({ error: "This code is for discounts, not free data", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanPkgSizeStr = packageSize.replace(/\s+/g, "").toUpperCase();
    const requestedGb = parsePackageSizeGb(packageSize);

    // Determine server-side package size limit from promo_codes row or default 2GB cap
    const explicitPromoPkg = typeof promoRow.package_size === "string" && promoRow.package_size.trim()
      ? promoRow.package_size.trim()
      : null;
    const explicitMaxPkg = promoRow.max_package_size !== undefined && promoRow.max_package_size !== null && String(promoRow.max_package_size).trim() !== ""
      ? String(promoRow.max_package_size).trim()
      : null;

    if (explicitPromoPkg) {
      const normalizedAllowedPkg = explicitPromoPkg.replace(/\s+/g, "").toUpperCase();
      const allowedGb = parsePackageSizeGb(explicitPromoPkg);
      const matchesExact = cleanPkgSizeStr === normalizedAllowedPkg;
      const withinGb = allowedGb !== null && requestedGb !== null && requestedGb <= allowedGb;
      if (!matchesExact && !withinGb) {
        return new Response(JSON.stringify({
          error: `This promo code is only valid for packages up to ${explicitPromoPkg}.`,
          success: false,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const maxAllowedGb = (explicitMaxPkg ? parsePackageSizeGb(explicitMaxPkg) : null) ?? DEFAULT_MAX_FREE_DATA_GB;
      if (requestedGb === null || requestedGb > maxAllowedGb) {
        return new Response(JSON.stringify({
          error: `Free data promo claims cannot exceed ${maxAllowedGb}GB.`,
          success: false,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Verify package exists in global_package_settings for the requested network
    const { data: pkgRows } = await supabase
      .from("global_package_settings")
      .select("public_price, agent_price, package_size, is_enabled")
      .eq("network", network);

    const pkgRow = (pkgRows || []).find((r: any) => String(r.package_size).replace(/\s+/g, "").toUpperCase() === cleanPkgSizeStr);
    if (!pkgRow || pkgRow.is_enabled === false) {
      return new Response(JSON.stringify({ error: "Selected package is not available for this network", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const originalPrice = Number(pkgRow?.public_price) || Number(pkgRow?.agent_price) || 0;

    const orderId = crypto.randomUUID();

    // Atomically claim the promo code and associate with orderId
    const { data: claimRows, error: claimError } = await supabase.rpc("claim_promo_code", {
      p_code: promoCode,
      p_phone: cleanPhone,
      p_order_id: orderId,
    });

    if (claimError || !claimRows || claimRows.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid or already claimed promo code", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimResult = claimRows[0] as { promo_id: string; discount_percentage: number; is_free: boolean };

    if (!claimResult.is_free) {
      return new Response(JSON.stringify({ error: "This code is for discounts, not free data", success: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create order record
    await supabase.from("orders").insert({
      id: orderId,
      order_type: "free_data_claim",
      payment_method: "promo",
      network,
      package_size: pkgRow.package_size || packageSize,
      customer_phone: cleanPhone,
      amount: 0,
      profit: 0,
      status: "paid",
      promo_code_id: claimResult.promo_id,
      discount_amount: originalPrice,
    });

    // Update claim with order_id as additional fallback
    await supabase.from("promo_claims").update({ order_id: orderId }).eq("promo_code_id", claimResult.promo_id).eq("claimed_by_phone", cleanPhone);

    // DELEGATE fulfillment to verify-payment for standard provider logic
    try {
      const fulfillRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY || Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({ reference: orderId }),
      });
      const fulfillData = await fulfillRes.json().catch(() => null) || {};

      const isSuccess = fulfillData.success === true || fulfillData.status === "fulfilled" || fulfillData.status === "processing" || fulfillData.status === "success";

      if (isSuccess) {
        return new Response(JSON.stringify({ success: true, order_id: orderId, status: fulfillData.status || "processing" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: false,
        order_id: orderId,
        error: fulfillData.reason || fulfillData.error || "Fulfillment failed. Contact support."
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (e) {
      console.error("Fulfillment trigger error:", e);
      return new Response(JSON.stringify({
        success: false,
        order_id: orderId,
        error: "Claim recorded but fulfillment failed to start. Contact support."
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

  } catch (err) {
    console.error("claim-free-data error:", err);
    return new Response(JSON.stringify({ error: "Internal server error", success: false }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
