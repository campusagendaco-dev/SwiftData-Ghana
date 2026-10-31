/// <reference path="../deno-env.d.ts" />
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchViaDb } from "../_shared/db_proxy.ts";
import { autoSubmitBeneficiaryNumber, autoSubmitBeneficiaryNumbers } from "../_shared/beneficiary_auto_submit.ts";

declare const Deno: any;

serve(async (req: Request) => {
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

      const { data: hsSubmitProvider } = await supabaseClient
        .from("providers")
        .select("*")
        .in("handler_type", ["hyspeeddata", "swiftreseller", "hyspeed"])
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const hsSubmitApiKey = Deno.env.get("HYSPEEDDATA_API_KEY") || Deno.env.get("SWIFTRESELLER_API_KEY") || hsSubmitProvider?.api_key || "";
      const hsSubmitBase = (Deno.env.get("HYSPEEDDATA_BASE_URL") || hsSubmitProvider?.base_url || "https://ihrvvniomtoofrjkmalb.supabase.co/functions/v1/api").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");

      if (hsSubmitApiKey) {
        try {
          const mtnOnly = validNumbers.filter(n => /^0(24|25|53|54|55|59)\d{7}$/.test(n));
          if (mtnOnly.length > 0) {
            const hsSubRes = await fetchViaDb(supabaseClient, `${hsSubmitBase}/v1/submit-numbers`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": hsSubmitApiKey.startsWith("Bearer ") ? hsSubmitApiKey : `Bearer ${hsSubmitApiKey}`,
              },
              body: JSON.stringify({ phones: mtnOnly, note: body.note || "SwiftData beneficiary batch" }),
              disableFallback: true,
            }, 12);
            if (hsSubRes.ok) {
              const hsSubJson = await hsSubRes.json().catch(() => ({}));
              if (hsSubJson?.success) {
                return new Response(
                  JSON.stringify({
                    success: true,
                    data: {
                      submitted: hsSubJson.submitted ?? mtnOnly.length,
                      numbers: mtnOnly,
                      invalid: invalidNumbers,
                      message: `${hsSubJson.submitted ?? mtnOnly.length} number(s) submitted for beneficiary approval`
                    }
                  }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
                );
              }
            }
          }
        } catch (hsSubErr) {
          console.warn("[verify-beneficiary/submit-numbers] HySpeedData submit warning:", hsSubErr);
        }
      }

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
        try { parsed = JSON.parse(resText); } catch { /* ignore JSON parse error */ }

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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if beneficiary verification is globally disabled
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

    // Beneficiary verification is ONLY for Affordable MTN SME packages
    const category = String(body.category || body.package_category || body.package_type || body.order_type || "").toLowerCase().trim();
    const net = String(body.network || "").toUpperCase().trim();
    const isMashUp = net.includes("MASH") || net.includes("COMBO") || category === "mashup" || category.includes("mash");
    const isNonMtn = net !== "" && !net.includes("MTN") && !net.includes("YELLO");
    const isExplicitNonSme = category !== "" && category !== "affordable" && category !== "sme" && !category.includes("sme");
    const isKorba = body.is_korba === true || body.is_korba === "true" || category === "korba" || body.provider_type === "korba";
    const isBypass = body.bypass_beneficiary === true || body.bypass_beneficiary === "true";

    if (isKorba || isMashUp || isNonMtn || isExplicitNonSme || isBypass) {
      console.log(`[verify-beneficiary] Beneficiary verification not required (network=${net}, category=${category}, mashup=${isMashUp}, korba=${isKorba}). Only Affordable MTN SME requires beneficiary whitelisting.`);

      // If bulk numbers were supplied, return bulk response format
      if (Array.isArray(body.phone_numbers) && body.phone_numbers.length > 0) {
        const phoneNumbersInput: string[] = body.phone_numbers;
        const normalizedNumbers: string[] = [];
        for (const p of phoneNumbersInput) {
          const clean = String(p).replace(/\D/g, "");
          let norm = clean;
          if (clean.startsWith("233") && clean.length === 12) {
            norm = "0" + clean.slice(3);
          } else if (clean.length === 9) {
            norm = "0" + clean;
          } else if (clean.startsWith("0") && clean.length === 10) {
            norm = clean;
          }
          if (norm.length === 10 && !normalizedNumbers.includes(norm)) {
            normalizedNumbers.push(norm);
          }
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              request_id: `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
              network: net || "Other",
              count: normalizedNumbers.length,
              summary: {
                total: normalizedNumbers.length,
                verified: normalizedNumbers.length,
                not_verified: 0,
                pending: 0,
              },
              results: normalizedNumbers.map((p: string) => ({
                phone_number: p,
                status: "not_required",
                verification_status: "VERIFIED",
                can_order: true,
                message: "Beneficiary verification is only required for Affordable MTN SME packages.",
              })),
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          exists: true,
          status: "not_required",
          verification_status: "NOT_REQUIRED",
          can_order: true,
          message: "Beneficiary verification is only required for Affordable MTN SME packages."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isMtnOrYello = (net.includes("MTN") || net.includes("YELLO")) && !isMashUp;

    // Fetch BundleZone provider config
    const { data: bzProvider } = await supabaseClient
      .from("providers")
      .select("*")
      .eq("handler_type", "bundlezone")
      .eq("is_active", true)
      .maybeSingle();

    const bzExpressEnabled = bzProvider?.settings?.express_mode_enabled !== false;
    const bzTargetNet = bzExpressEnabled ? "MTN_EXPRESS" : "YELLO";
    const bzApiKey = Deno.env.get("BUNDLEZONE_API_KEY") || bzProvider?.api_key || "";
    const rawBzBaseUrl = Deno.env.get("BUNDLEZONE_BASE_URL") || bzProvider?.base_url || "https://bundlezone.shop";
    const bzCheckUrl = `${rawBzBaseUrl.trim().replace(/\/+$/, "")}/api/beneficiary-check.php`;

    // ── Bulk numbers request support (up to 1,000 numbers) ──
    const phoneNumbersInput: string[] = Array.isArray(body.phone_numbers) ? body.phone_numbers : [];
    if (phoneNumbersInput.length > 0) {
      // Clean and normalize all numbers
      const normalizedNumbers: string[] = [];
      for (const p of phoneNumbersInput) {
        const clean = String(p).replace(/\D/g, "");
        let norm = clean;
        if (clean.startsWith("233") && clean.length === 12) {
          norm = "0" + clean.slice(3);
        } else if (clean.length === 9) {
          norm = "0" + clean;
        } else if (clean.startsWith("0") && clean.length === 10) {
          norm = clean;
        }
        if (norm.length === 10 && !normalizedNumbers.includes(norm)) {
          normalizedNumbers.push(norm);
        }
      }

      if (normalizedNumbers.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "No valid 10-digit Ghana phone numbers provided." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      if (!isMtnOrYello) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              request_id: `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
              network: net || "Telecel",
              count: normalizedNumbers.length,
              summary: {
                total: normalizedNumbers.length,
                verified: normalizedNumbers.length,
                not_verified: 0,
                pending: 0,
              },
              results: normalizedNumbers.map((p: string) => ({
                phone_number: p,
                status: "not_required",
                verification_status: "VERIFIED",
                can_order: true,
                message: "Verification is not required for AT or Telecel.",
              })),
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (bzApiKey) {
        try {
          const bzRes = await fetchViaDb(supabaseClient, bzCheckUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": bzApiKey,
              "x-api-key": bzApiKey,
              "Authorization": `Bearer ${bzApiKey}`,
            },
            body: JSON.stringify({
              network: bzTargetNet,
              phone_numbers: bzExpressEnabled ? normalizedNumbers.slice(0, 100) : normalizedNumbers,
            }),
            disableFallback: true,
          }, 20);

          if (bzRes.ok) {
            const bzData = await bzRes.json();
            const results = bzData.data?.results || [];
            let verifiedCount = 0;
            let unverifiedCount = 0;
            let pendingCount = 0;
            for (const r of results) {
              const vs = String(r.verification_status || "").toUpperCase();
              const st = String(r.status || "").toLowerCase();
              if (vs === "VERIFIED" || vs === "NOT_REQUIRED" || st === "not_required" || r.verification_required === false || r.can_order === true) {
                r.can_order = true;
                verifiedCount++;
              } else if (vs === "PENDING") {
                pendingCount++;
              } else {
                unverifiedCount++;
              }
            }
            if (bzData.data) {
              bzData.data.summary = {
                total: results.length,
                verified: verifiedCount,
                not_verified: unverifiedCount,
                pending: pendingCount,
              };

              const unverifiedNumbers = results
                .filter((r: any) => {
                  const vs = String(r.verification_status || "").toUpperCase();
                  const st = String(r.status || "").toLowerCase();
                  return vs !== "VERIFIED" && vs !== "NOT_REQUIRED" && st !== "not_required" && r.verification_required !== false && r.can_order !== true;
                })
                .map((r: any) => r.phone_number)
                .filter(Boolean);

              if (unverifiedNumbers.length > 0) {
                autoSubmitBeneficiaryNumbers(supabaseClient, unverifiedNumbers, "verify_beneficiary_bundlezone_bulk")
                  .then(subRes => console.log(`[verify-beneficiary] Auto-submitted ${subRes.submittedCount} unverified numbers from BundleZone check.`))
                  .catch(e => console.error("[verify-beneficiary] Bulk auto-submit error:", e));
              }
            }
            return new Response(JSON.stringify(bzData), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (bzErr) {
          console.error("[verify-beneficiary] BundleZone bulk check error:", bzErr);
        }
      }

      // ── Check HySpeedData / SwiftData Reseller Bulk Verification (/v1/verify-number/bulk) ──
      const { data: hsBulkProvider } = await supabaseClient
        .from("providers")
        .select("*")
        .in("handler_type", ["hyspeeddata", "swiftreseller", "hyspeed"])
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const hsBulkApiKey = Deno.env.get("HYSPEEDDATA_API_KEY") || Deno.env.get("SWIFTRESELLER_API_KEY") || hsBulkProvider?.api_key || "";
      const hsBulkBase = (Deno.env.get("HYSPEEDDATA_BASE_URL") || hsBulkProvider?.base_url || "https://ihrvvniomtoofrjkmalb.supabase.co/functions/v1/api").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");

      if (hsBulkApiKey && normalizedNumbers.length <= 100) {
        try {
          const hsRes = await fetchViaDb(supabaseClient, `${hsBulkBase}/v1/verify-number/bulk`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": hsBulkApiKey.startsWith("Bearer ") ? hsBulkApiKey : `Bearer ${hsBulkApiKey}`,
            },
            body: JSON.stringify({ phones: normalizedNumbers }),
            disableFallback: true,
          }, 20);

          if (hsRes.ok) {
            const hsData = await hsRes.json().catch(() => ({}));
            if (hsData.success && Array.isArray(hsData.results)) {
              const resMap = new Map<string, any>();
              hsData.results.forEach((r: any) => {
                if (r.phone) resMap.set(String(r.phone), r);
              });

              const hsResults = normalizedNumbers.map((p) => {
                const match = resMap.get(p);
                const isVerified = match?.verified === true || match?.servable === true || match?.recommendation === "sell_any" || match?.status === "verified";
                return {
                  phone_number: p,
                  status: isVerified ? "verified" : "not_verified",
                  verification_status: isVerified ? "VERIFIED" : "NOT_VERIFIED",
                  can_order: isVerified,
                  message: match?.message || (isVerified ? "This number can be served — you may sell any bundle size." : "Not yet approved on MTN beneficiary list."),
                };
              });

              const vCount = hsResults.filter(r => r.can_order).length;
              const unverifiedNumbers = hsResults.filter(r => !r.can_order).map(r => r.phone_number);
              if (unverifiedNumbers.length > 0) {
                autoSubmitBeneficiaryNumbers(supabaseClient, unverifiedNumbers, "verify_beneficiary_hyspeed_bulk")
                  .then(subRes => console.log(`[verify-beneficiary] Auto-submitted ${subRes.submittedCount} unverified numbers from HySpeedData check.`))
                  .catch(e => console.error("[verify-beneficiary] Bulk auto-submit error:", e));
              }

              return new Response(
                JSON.stringify({
                  success: true,
                  data: {
                    request_id: `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
                    network: "YELLO",
                    provider: "hyspeeddata",
                    count: hsResults.length,
                    summary: {
                      total: hsResults.length,
                      verified: vCount,
                      not_verified: hsResults.length - vCount,
                      pending: 0,
                    },
                    results: hsResults,
                  },
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        } catch (hsBulkErr) {
          console.error("[verify-beneficiary] HySpeedData bulk check error:", hsBulkErr);
        }
      }

      // ── Fallback 2: Check DataMart Bulk Verification (/verify-number/bulk) ──
      const { data: dmBulkProvider } = await supabaseClient
        .from("providers")
        .select("*")
        .eq("handler_type", "datamart")
        .eq("is_active", true)
        .maybeSingle();

      const dmBulkApiKey = Deno.env.get("DATAMART_API_KEY") || dmBulkProvider?.api_key || "";
      const rawDmBulkUrl = Deno.env.get("DATAMART_BASE_URL") || dmBulkProvider?.base_url || "https://api.datamartgh.shop/api/developer";
      const dmBulkUrl = `${rawDmBulkUrl.trim().replace(/\/+$/, "")}/verify-number/bulk`;

      if (dmBulkApiKey && normalizedNumbers.length <= 100) {
        try {
          const dmRes = await fetchViaDb(supabaseClient, dmBulkUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": dmBulkApiKey,
            },
            body: JSON.stringify({ numbers: normalizedNumbers }),
            disableFallback: true,
          }, 20);

          if (dmRes.ok) {
            const dmData = await dmRes.json();
            if (dmData.status === "success" && Array.isArray(dmData.results)) {
              const resMap = new Map<string, any>();
              dmData.results.forEach((r: any) => {
                const num = r.normalized || r.number;
                if (num) resMap.set(num, r);
              });

              const dmResults = normalizedNumbers.map((p) => {
                const match = resMap.get(p);
                const isAccepted = match?.accepted === true;
                return {
                  phone_number: p,
                  status: isAccepted ? "verified" : "not_verified",
                  verification_status: isAccepted ? "VERIFIED" : "NOT_VERIFIED",
                  can_order: isAccepted,
                  message: match?.reason || (isAccepted ? "Number verified on carrier delivery network." : "The beneficiary phone number is not allowed on carrier network."),
                };
              });

              const vCount = dmResults.filter(r => r.can_order).length;
              const unverifiedNumbers = dmResults.filter(r => !r.can_order).map(r => r.phone_number);
              if (unverifiedNumbers.length > 0) {
                autoSubmitBeneficiaryNumbers(supabaseClient, unverifiedNumbers, "verify_beneficiary_datamart_bulk")
                  .then(subRes => console.log(`[verify-beneficiary] Auto-submitted ${subRes.submittedCount} unverified numbers from DataMart check.`))
                  .catch(e => console.error("[verify-beneficiary] Bulk auto-submit error:", e));
              }

              return new Response(
                JSON.stringify({
                  success: true,
                  data: {
                    request_id: `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
                    network: "YELLO",
                    provider: "datamart",
                    count: dmResults.length,
                    summary: {
                      total: dmResults.length,
                      verified: vCount,
                      not_verified: dmResults.length - vCount,
                      pending: 0,
                    },
                    results: dmResults,
                  },
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        } catch (dmBulkErr) {
          console.error("[verify-beneficiary] DataMart bulk check error:", dmBulkErr);
        }
      }

      // Fallback if BundleZone and DataMart API failed
      const { data: recentOrders } = await supabaseClient
        .from("orders")
        .select("customer_phone")
        .in("status", ["fulfilled", "completed"])
        .in("customer_phone", normalizedNumbers);

      const verifiedSet = new Set((recentOrders || []).map((o: any) => o.customer_phone));
      const fallbackResults = normalizedNumbers.map((p) => {
        const isV = verifiedSet.has(p);
        return {
          phone_number: p,
          status: isV ? "verified" : "not_verified",
          verification_status: isV ? "VERIFIED" : "NOT_VERIFIED",
          can_order: isV,
          message: isV ? "Verified via order history." : "Not on beneficiary whitelist.",
        };
      });

      const vCount = fallbackResults.filter(r => r.can_order).length;
      const unverifiedNumbers = fallbackResults.filter(r => !r.can_order).map(r => r.phone_number);
      if (unverifiedNumbers.length > 0) {
        autoSubmitBeneficiaryNumbers(supabaseClient, unverifiedNumbers, "verify_beneficiary_fallback_bulk")
          .then(subRes => console.log(`[verify-beneficiary] Auto-submitted ${subRes.submittedCount} unverified numbers from fallback check.`))
          .catch(e => console.error("[verify-beneficiary] Bulk auto-submit error:", e));
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            request_id: `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            network: "YELLO",
            count: fallbackResults.length,
            summary: {
              total: fallbackResults.length,
              verified: vCount,
              not_verified: fallbackResults.length - vCount,
              pending: 0,
            },
            results: fallbackResults,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Single number request ──
    const phone = body.phone || body.phone_number;
    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone number is required." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Only MTN numbers require carrier beneficiary check
    if (!isMtnOrYello) {
      return new Response(
        JSON.stringify({
          success: true,
          exists: true,
          status: "not_required",
          verification_status: "NOT_REQUIRED",
          can_order: true,
          message: "Only Affordable MTN SME numbers require carrier beneficiary validation."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize phone number (0... and 233...)
    const cleanDigits = String(phone).replace(/\D/g, "");
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

    if (localFormat.length !== 10 || !localFormat.startsWith("0")) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid phone number. Must be a valid 10-digit Ghana mobile number (e.g. 024XXXXXXX).",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const formatsToTest = [...new Set([localFormat, intlFormat])];

    // Check if the number has successful order history
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
        JSON.stringify({ success: true, exists: true, verification_status: "VERIFIED", can_order: true, message: "Number verified via order history." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check BundleZone Beneficiary Check API
    if (bzApiKey) {
      try {
        console.log(`[verify-beneficiary] Checking BundleZone for ${localFormat}...`);
        const bzRes = await fetchViaDb(supabaseClient, bzCheckUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": bzApiKey,
            "x-api-key": bzApiKey,
            "Authorization": `Bearer ${bzApiKey}`,
          },
          body: JSON.stringify({
            network: bzTargetNet,
            phone_number: localFormat,
          }),
          disableFallback: true,
        }, 12);

        if (bzRes.ok) {
          const bzJson = await bzRes.json();
          const results = bzJson.data?.results || [];
          const match = results.find((r: any) => r.phone_number === localFormat) || results[0] || bzJson.data;
          if (match) {
            const vStatus = String(match.verification_status || "").toUpperCase();
            const mStatus = String(match.status || "").toLowerCase();
            if (
              vStatus === "VERIFIED" ||
              vStatus === "NOT_REQUIRED" ||
              mStatus === "not_required" ||
              match.verification_required === false ||
              match.can_order === true
            ) {
              console.log(`[verify-beneficiary] Number ${localFormat} ready via BundleZone (${vStatus || mStatus}).`);
              return new Response(
                JSON.stringify({
                  success: true,
                  exists: true,
                  status: mStatus === "not_required" || vStatus === "NOT_REQUIRED" ? "not_required" : "verified",
                  verification_status: vStatus === "NOT_REQUIRED" ? "NOT_REQUIRED" : "VERIFIED",
                  verification_required: match.verification_required === false ? false : undefined,
                  can_order: true,
                  message: match.message || "Number format validated and ready for MTN Express ordering.",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            } else if (vStatus === "NOT_VERIFIED" || match.can_order === false) {
              console.log(`[verify-beneficiary] Number ${localFormat} is NOT_VERIFIED on BundleZone, checking DataHub and DataMart fallback...`);
            }
          }
        }
      } catch (bzErr) {
        console.warn("[verify-beneficiary] BundleZone check failed, falling back to DataHub:", bzErr);
      }
    }

    // Fallback: Check DataHub provider
    const { data: dhProvider } = await supabaseClient
      .from("providers")
      .select("*")
      .eq("handler_type", "datahub")
      .eq("is_active", true)
      .maybeSingle();

    const dhApiKey = Deno.env.get("DATAHUB_API_KEY") || dhProvider?.api_key || "";
    const rawDhBaseUrl = Deno.env.get("DATAHUB_BASE_URL") || dhProvider?.base_url || "https://user.datahubgh.com/api/external";
    const dhCleanUrl = rawDhBaseUrl.trim().replace(/\/+$/, "");
    const dhUrl = `${dhCleanUrl}/purchases/verify-number`;

    let exists = false;
    let text = "";

    if (dhApiKey) {
      for (const testPhone of formatsToTest) {
        try {
          const res = await fetchViaDb(supabaseClient, dhUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": dhApiKey,
              "Authorization": `Bearer ${dhApiKey}`,
            },
            body: JSON.stringify({
              phone: testPhone,
              is_ported_number: true,
            }),
            disableFallback: true,
          }, 10);

          text = await res.text();
          if (res.ok) {
            let parsed: any = {};
            try { parsed = JSON.parse(text); } catch { /* ignore */ }
            if (parsed.success || parsed.data?.exists) {
              exists = true;
              break;
            }
          }
        } catch (err) {
          console.error(`[verify-beneficiary] Error testing DataHub for ${testPhone}:`, err);
        }
      }
    }

    if (exists) {
      return new Response(
        JSON.stringify({ success: true, exists: true, verification_status: "VERIFIED", can_order: true, message: "Number verified successfully." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Check HySpeedData / SwiftData Reseller Provider (/v1/verify-number) ──
    const { data: hsProvider } = await supabaseClient
      .from("providers")
      .select("*")
      .in("handler_type", ["hyspeeddata", "swiftreseller", "hyspeed"])
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const hsApiKey = Deno.env.get("HYSPEEDDATA_API_KEY") || Deno.env.get("SWIFTRESELLER_API_KEY") || hsProvider?.api_key || "";
    const hsBaseUrl = (Deno.env.get("HYSPEEDDATA_BASE_URL") || hsProvider?.base_url || "https://ihrvvniomtoofrjkmalb.supabase.co/functions/v1/api").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");

    if (!exists && hsApiKey && /^0(24|25|53|54|55|59)\d{7}$/.test(localFormat)) {
      try {
        console.log(`[verify-beneficiary] Testing HySpeedData /v1/verify-number for ${localFormat}...`);
        const hsRes = await fetchViaDb(supabaseClient, `${hsBaseUrl}/v1/verify-number`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": hsApiKey.startsWith("Bearer ") ? hsApiKey : `Bearer ${hsApiKey}`,
          },
          body: JSON.stringify({ phone: localFormat }),
          disableFallback: true,
        }, 10);

        if (hsRes.ok) {
          const hsData = await hsRes.json().catch(() => ({}));
          const firstRes = Array.isArray(hsData?.results) ? hsData.results[0] : null;
          if (hsData?.success && firstRes) {
            const isServable = firstRes.verified === true || firstRes.servable === true || firstRes.recommendation === "sell_any" || firstRes.status === "verified";
            if (isServable) {
              return new Response(
                JSON.stringify({
                  success: true,
                  exists: true,
                  status: "verified",
                  verification_status: "VERIFIED",
                  can_order: true,
                  provider: "hyspeeddata",
                  recommendation: "sell_any",
                  message: firstRes.message || "This number can be served — you may sell any bundle size.",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        }
      } catch (hsErr) {
        console.warn("[verify-beneficiary] HySpeedData single check error:", hsErr);
      }
    }

    // ── Fallback 2: Check DataMart Provider (/verify-number) ──
    const { data: dmProvider } = await supabaseClient
      .from("providers")
      .select("*")
      .eq("handler_type", "datamart")
      .eq("is_active", true)
      .maybeSingle();

    const dmApiKey = Deno.env.get("DATAMART_API_KEY") || dmProvider?.api_key || "";
    const rawDmBaseUrl = Deno.env.get("DATAMART_BASE_URL") || dmProvider?.base_url || "https://api.datamartgh.shop/api/developer";
    const dmCheckUrl = `${rawDmBaseUrl.trim().replace(/\/+$/, "")}/verify-number`;

    if (!exists && dmApiKey) {
      try {
        console.log(`[verify-beneficiary] Testing DataMart verify-number for ${localFormat}...`);
        const dmRes = await fetchViaDb(supabaseClient, dmCheckUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": dmApiKey,
          },
          body: JSON.stringify({
            phoneNumber: localFormat,
          }),
          disableFallback: true,
        }, 10);

        if (dmRes.ok) {
          const dmData = await dmRes.json();
          if (dmData.status === "success" && dmData.data) {
            const isServable = dmData.data.servable === true;
            const recommendation = dmData.data.recommendation;
            const dmMsg = dmData.data.message || "";

            if (isServable) {
              return new Response(
                JSON.stringify({
                  success: true,
                  exists: true,
                  status: "verified",
                  verification_status: "VERIFIED",
                  can_order: true,
                  provider: "datamart",
                  recommendation: "sell_any",
                  message: dmMsg || "Number verified on carrier delivery network.",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            } else if (recommendation === "activate_first") {
              return new Response(
                JSON.stringify({
                  success: true,
                  exists: false,
                  status: "activate_first",
                  verification_status: "NOT_VERIFIED",
                  can_order: false,
                  is_non_beneficiary: true,
                  provider: "datamart",
                  recommendation: "activate_first",
                  message: dmMsg || "This number is new to the network (72hr activation freeze). Sell a 1GB bundle first to activate.",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        }
      } catch (dmErr) {
        console.warn("[verify-beneficiary] DataMart check error:", dmErr);
      }
    }

    // Parse the error message if check fails
    let errorMessage = `The recipient number ${phone} has reached its daily MTN data transfer limit, belongs to an unsupported plan (e.g. corporate SIM), or has promotional messages blocked. Please check the recipient or try another number.`;
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

    // Proactively submit the unverified number to the carrier whitelist in background
    autoSubmitBeneficiaryNumber(supabaseClient, localFormat, "verify_beneficiary_single")
      .then(res => console.log(`[verify-beneficiary] Auto-submitted ${localFormat} to carrier whitelist:`, res.success))
      .catch(e => console.error("[verify-beneficiary] Background auto-submit error:", e));

    // If caller specifically requested check_only or strict check
    if (body.check_only === true || body.strict === true) {
      return new Response(
        JSON.stringify({
          success: true,
          exists: false,
          status: "not_verified",
          verification_status: "NOT_VERIFIED",
          can_order: false,
          is_non_beneficiary: true,
          auto_submitted: true,
          message: errorMessage || "Recipient is not on the MTN beneficiary list. Automatically submitted for carrier approval."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Datamart API failover handles non-beneficiary numbers natively
    return new Response(
      JSON.stringify({
        success: true,
        exists: false,
        status: "not_verified",
        verification_status: "NOT_VERIFIED",
        can_order: true,
        is_non_beneficiary: true,
        route_via_datamart: true,
        auto_submitted: true,
        message: "Number is not on beneficiary list, but has been automatically submitted for carrier approval and is eligible for fallback carrier delivery."
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
