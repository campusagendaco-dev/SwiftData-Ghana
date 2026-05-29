import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-user-access-token, x-supabase-auth-token, x-api-key, api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

// Help extract the TLD from a domain (e.g. "kwame.com" -> ".com")
function getDomainTld(domain: string): string | null {
  const parts = domain.toLowerCase().trim().split(".");
  if (parts.length < 2) return null;
  return "." + parts[parts.length - 1];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let supabaseAdmin: any;
  try {
    console.log(`[REQ] ${req.method} ${req.url}`);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing environment variables");
    }

    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // GoDaddy Registrar Configuration
    const PRIMARY_DOMAIN_PROVIDER = Deno.env.get("PRIMARY_DOMAIN_PROVIDER")?.trim().toLowerCase() || "godaddy";

    const GODADDY_API_KEY = Deno.env.get("GODADDY_API_KEY")?.trim();
    const GODADDY_API_SECRET = Deno.env.get("GODADDY_API_SECRET")?.trim();
    const GODADDY_ENV = Deno.env.get("GODADDY_ENV")?.trim() || "sandbox";
    const FORCE_SIMULATION = Deno.env.get("FORCE_SIMULATION")?.trim() === "true";

    // Namecheap Configuration
    const NAMECHEAP_API_USER = Deno.env.get("NAMECHEAP_API_USER")?.trim();
    const NAMECHEAP_API_KEY = Deno.env.get("NAMECHEAP_API_KEY")?.trim();
    const NAMECHEAP_CLIENT_IP = Deno.env.get("NAMECHEAP_CLIENT_IP")?.trim() || "1.1.1.1";
    const PROXY_URL = Deno.env.get("PROXY_URL")?.trim();
    const NAMECHEAP_ENV = Deno.env.get("NAMECHEAP_ENV")?.trim() || "sandbox";
    const namecheapBase = NAMECHEAP_ENV === "production" ? "https://api.namecheap.com/xml.response" : "https://api.sandbox.namecheap.com/xml.response";

    let isSimulation = FORCE_SIMULATION;
    if (PRIMARY_DOMAIN_PROVIDER === "namecheap") {
      isSimulation = isSimulation || !NAMECHEAP_API_KEY || !NAMECHEAP_API_USER;
    } else {
      isSimulation = isSimulation || !GODADDY_API_KEY || !GODADDY_API_SECRET;
    }
    const godaddyBase = GODADDY_ENV === "production" ? "https://api.godaddy.com" : "https://api.ote-godaddy.com";

    const godaddyHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    if (!isSimulation) {
      godaddyHeaders["Authorization"] = `sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}`;
    }

    // Authentication Checks
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[AUTH] Missing Authorization Header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("[AUTH] Invalid User Session:", userError);
      return new Response(JSON.stringify({ error: "Invalid session" }), { 
        status: 401, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    console.log(`[USER] User authorized: ${user.id} (${user.email})`);

    const urlObj = new URL(req.url);
    const path = urlObj.pathname;

    // Parse payload for POST actions
    let payload: any = {};
    if (req.method === "POST") {
      payload = await req.json().catch(() => ({}));
    }

    const action = payload.action || (path.endsWith("/check") ? "check" : path.endsWith("/purchase") ? "purchase" : null);

    // ────────────────────────────────────────────────────────────────
    // ACTION 1: Domain Availability & Price Checker
    // ────────────────────────────────────────────────────────────────
    if (action === "check" || (req.method === "GET" && path.endsWith("/check"))) {
      const domainInput = urlObj.searchParams.get("domain")?.trim().toLowerCase() || payload.domain?.trim().toLowerCase();
      if (!domainInput) {
        return new Response(JSON.stringify({ error: "Missing domain parameter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const tld = getDomainTld(domainInput);
      if (!tld) {
        return new Response(JSON.stringify({ error: "Invalid domain format. Must include an extension (e.g. .com)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Query database for TLD support and active price
      const { data: pricing, error: pricingError } = await supabaseAdmin
        .from("domain_pricing")
        .select("*")
        .eq("tld", tld)
        .eq("is_active", true)
        .maybeSingle();

      if (pricingError || !pricing) {
        return new Response(JSON.stringify({ error: `Extension '${tld}' is not supported or currently unavailable.` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check if domain is already registered or taken in our system
      const { data: existingStore } = await supabaseAdmin
        .from("reseller_stores")
        .select("id")
        .eq("custom_domain", domainInput)
        .maybeSingle();

      const { data: existingPurchase } = await supabaseAdmin
        .from("domain_purchases")
        .select("id")
        .eq("domain_name", domainInput)
        .eq("status", "active")
        .maybeSingle();

      let available = !existingStore && !existingPurchase;

      // Integrate GoDaddy live availability check
      // BYPASS: GoDaddy now requires 50+ domains to access the Availability API.
      // We will skip this check and attempt to blindly purchase it later. 
      /*
      if (available && !isSimulation) { ... }
      */
      
      if (available && !isSimulation && PRIMARY_DOMAIN_PROVIDER === "namecheap") {
        let client;
        try {
          if (PROXY_URL) {
            client = Deno.createHttpClient({ proxy: { url: PROXY_URL } });
          }
          console.log(`[NAMECHEAP_CHECK] Querying Namecheap for ${domainInput}...`);
          const params = new URLSearchParams({
            ApiUser: NAMECHEAP_API_USER || "",
            ApiKey: NAMECHEAP_API_KEY || "",
            UserName: NAMECHEAP_API_USER || "",
            Command: "namecheap.domains.check",
            ClientIp: NAMECHEAP_CLIENT_IP,
            DomainList: domainInput
          });
          const res = await fetch(`${namecheapBase}?${params.toString()}`, { client });
          const text = await res.text();
          if (res.ok && !text.includes("<Error>")) {
             // Look for Available="true"
             const availableMatch = text.match(/Available="([^"]+)"/);
             if (availableMatch) {
               available = availableMatch[1].toLowerCase() === "true";
             }
          } else {
            console.error(`[NAMECHEAP_CHECK_ERR] Status ${res.status}:`, text);
            return new Response(JSON.stringify({ error: `Domain check failed on registry` }), {
              status: 502,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } catch (err: any) {
          console.error("[NAMECHEAP_CHECK_ERR] Network error querying Namecheap:", err);
          return new Response(JSON.stringify({ error: `Network error querying Registry: ${err.message}` }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } finally {
          if (client) client.close();
        }
      }

      return new Response(JSON.stringify({
        domain: domainInput,
        tld: tld,
        available: available,
        price_ghs: Number(pricing.sale_price_ghs),
        message: available ? "Domain is available for registration" : "Domain is already registered"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ────────────────────────────────────────────────────────────────
    // ACTION 2: Domain Purchase Registration
    // ────────────────────────────────────────────────────────────────
    if (action === "purchase" || (req.method === "POST" && path.endsWith("/purchase"))) {
      const { domain_name, store_id } = payload;

      if (!domain_name || !store_id) {
        return new Response(JSON.stringify({ error: "Missing required params: domain_name, store_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const cleanDomain = domain_name.trim().toLowerCase();
      const tld = getDomainTld(cleanDomain);

      if (!tld) {
        return new Response(JSON.stringify({ error: "Invalid domain format." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 1. Authorise Store ownership
      const { data: store, error: storeError } = await supabaseAdmin
        .from("reseller_stores")
        .select("id, user_id, store_name")
        .eq("id", store_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (storeError || !store) {
        return new Response(JSON.stringify({ error: "Storefront not found or not owned by you." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Fetch Pricing
      const { data: pricing } = await supabaseAdmin
        .from("domain_pricing")
        .select("*")
        .eq("tld", tld)
        .eq("is_active", true)
        .maybeSingle();

      if (!pricing) {
        return new Response(JSON.stringify({ error: `TLD '${tld}' is not currently active.` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const salePrice = Number(pricing.sale_price_ghs);

      // 3. Prevent Duplicates
      const { data: duplicate } = await supabaseAdmin
        .from("reseller_stores")
        .select("id")
        .eq("custom_domain", cleanDomain)
        .maybeSingle();

      if (duplicate) {
        return new Response(JSON.stringify({ error: "This domain is already linked to another active store." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 4. ATOMIC WALLET DEBIT
      console.log(`[DEBIT] Debiting reseller wallet ${user.id} by GHS ${salePrice}...`);
      const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
        p_agent_id: user.id,
        p_amount: salePrice,
      });

      if (debitError || !debitResult?.success) {
        const errorMsg = debitError?.message || debitResult?.message || "Insufficient wallet balance to purchase this domain.";
        console.error(`[DEBIT_FAIL] ${user.id}: ${errorMsg}`);
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      console.log(`[DEBIT_SUCCESS] Wallet debited. New balance: ${debitResult.new_balance}`);

      // 5. DOMAIN PURCHASE LOG (Initialize pending)
      
      // Clean up any previous failed or abandoned attempts for this domain
      await supabaseAdmin
        .from("domain_purchases")
        .delete()
        .eq("domain_name", cleanDomain)
        .neq("status", "active");

      const { data: purchaseRecord, error: insertError } = await supabaseAdmin
        .from("domain_purchases")
        .insert({
          user_id: user.id,
          store_id: store_id,
          domain_name: cleanDomain,
          tld: tld,
          amount_paid: salePrice,
          status: "pending"
        })
        .select()
        .single();

      if (insertError) {
        console.error("[DB_ERR] Failed to log domain purchase:", insertError);
        // Rollback debit
        await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: salePrice });
        return new Response(JSON.stringify({ error: "Failed to record transaction. Wallet refunded." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 6. API CALL TO REGISTRAR (or robust simulation fallback)
      console.log(`[REGISTRAR] Launching registration for ${cleanDomain}...`);
      
      let registerSuccess = false;
      let orderId = "";
      let errMsg = "";

if (isSimulation) {
        console.log(`[REGISTRAR] Simulation Mode Active. Registering ${cleanDomain} programmatically...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        registerSuccess = true;
        orderId = "MOCK-ORD-" + Math.floor(Math.random() * 900000 + 100000);
      } else if (PRIMARY_DOMAIN_PROVIDER === "namecheap") {
        console.log(`[REGISTRAR] Connecting to Namecheap Live API for ${cleanDomain}...`);
        let client;
        try {
          if (PROXY_URL) client = Deno.createHttpClient({ proxy: { url: PROXY_URL } });
          
          const { data: userProfile } = await supabaseAdmin.from("profiles").select("full_name, phone_number").eq("user_id", user.id).maybeSingle();
          const fullName = userProfile?.full_name || "SwiftData Agent";
          const nameParts = fullName.trim().split(" ");
          const firstName = nameParts[0] || "SwiftData";
          const lastName = nameParts.slice(1).join(" ") || "Reseller";
          const email = user.email || "domains@swiftdatagh.com";
          
          let phoneRaw = userProfile?.phone_number || "+233.240000000";
          if (!phoneRaw.includes(".")) { phoneRaw = "+233.240000000"; } // basic fallback format

          const params = new URLSearchParams({
            ApiUser: NAMECHEAP_API_USER || "",
            ApiKey: NAMECHEAP_API_KEY || "",
            UserName: NAMECHEAP_API_USER || "",
            Command: "namecheap.domains.create",
            ClientIp: NAMECHEAP_CLIENT_IP,
            DomainName: cleanDomain,
            Years: "1",
            RegistrantFirstName: firstName,
            RegistrantLastName: lastName,
            RegistrantAddress1: "Plot 12 Spintex Road",
            RegistrantCity: "Accra",
            RegistrantStateProvince: "Greater Accra",
            RegistrantPostalCode: "00233",
            RegistrantCountry: "GH",
            RegistrantPhone: phoneRaw,
            RegistrantEmailAddress: email,
            TechFirstName: firstName,
            TechLastName: lastName,
            TechAddress1: "Plot 12 Spintex Road",
            TechCity: "Accra",
            TechStateProvince: "Greater Accra",
            TechPostalCode: "00233",
            TechCountry: "GH",
            TechPhone: phoneRaw,
            TechEmailAddress: email,
            AdminFirstName: firstName,
            AdminLastName: lastName,
            AdminAddress1: "Plot 12 Spintex Road",
            AdminCity: "Accra",
            AdminStateProvince: "Greater Accra",
            AdminPostalCode: "00233",
            AdminCountry: "GH",
            AdminPhone: phoneRaw,
            AdminEmailAddress: email,
            AuxBillingFirstName: firstName,
            AuxBillingLastName: lastName,
            AuxBillingAddress1: "Plot 12 Spintex Road",
            AuxBillingCity: "Accra",
            AuxBillingStateProvince: "Greater Accra",
            AuxBillingPostalCode: "00233",
            AuxBillingCountry: "GH",
            AuxBillingPhone: phoneRaw,
            AuxBillingEmailAddress: email
          });

          const res = await fetch(`${namecheapBase}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
            client
          });
          
          const text = await res.text();
          if (res.ok && !text.includes("<Error>")) {
            const registeredMatch = text.match(/Registered="([^"]+)"/);
            const orderMatch = text.match(/OrderID="([^"]+)"/);
            if (registeredMatch && registeredMatch[1].toLowerCase() === "true") {
              registerSuccess = true;
              orderId = orderMatch ? orderMatch[1] : "NC-ORD-" + Math.floor(Math.random() * 900000 + 100000);
            } else {
              errMsg = "Namecheap Registration Rejected";
            }
          } else {
             const errMatch = text.match(/<Error[^>]*>([^<]+)<\/Error>/);
             errMsg = errMatch ? errMatch[1] : "Namecheap Registration Failed";
             console.error(`[NAMECHEAP_PURCHASE_FAIL] Error:`, text);
          }
        } catch (err: any) {
          errMsg = err.message || "Network connection failure to Namecheap";
          console.error("[NAMECHEAP_PURCHASE_FAIL] Network/Internal crash:", err);
        } finally {
          if (client) client.close();
        }
      } else {
        console.log(`[REGISTRAR] Connecting to GoDaddy Live API (${godaddyBase}) for ${cleanDomain}...`);
        try {
          // Fetch reseller profile/name/phone if available to comply with registrar constraints
          const { data: userProfile } = await supabaseAdmin
            .from("profiles")
            .select("phone_number, full_name")
            .eq("user_id", user.id)
            .maybeSingle();

          const phoneRaw = userProfile?.phone_number || "";
          let godaddyPhone = "+233.240000000"; // default fallback
          if (phoneRaw) {
            const digits = phoneRaw.replace(/\D/g, "");
            if (digits.startsWith("233") && digits.length === 12) {
              godaddyPhone = `+233.${digits.slice(3)}`;
            } else if (digits.length === 9) {
              godaddyPhone = `+233.${digits}`;
            } else if (digits.length === 10 && digits.startsWith("0")) {
              godaddyPhone = `+233.${digits.slice(1)}`;
            }
          }

          const fullName = userProfile?.full_name || "SwiftData Agent";
          const nameParts = fullName.trim().split(" ");
          const firstName = nameParts[0] || "SwiftData";
          const lastName = nameParts.slice(1).join(" ") || "Reseller";

          const contact = {
            addressMailing: {
              address1: "Plot 12 Spintex Road",
              city: "Accra",
              country: "GH",
              postalCode: "00233",
              state: "Greater Accra"
            },
            email: user.email || "domains@swiftdatagh.com",
            firstName: firstName,
            lastName: lastName,
            phone: godaddyPhone
          };

          const purchasePayload = {
            consent: {
              agreementKeys: ["DNRA"],
              agreements: ["https://www.godaddy.com/agreements/showdoc.aspx?pageid=REG_SA"],
              requestIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "1.1.1.1"
            },
            contactAdmin: contact,
            contactBilling: contact,
            contactRegistrant: contact,
            contactTech: contact,
            domain: cleanDomain,
            period: 1,
            renewAuto: true
          };

          const res = await fetch(`${godaddyBase}/v1/domains/purchase`, {
            method: "POST",
            headers: godaddyHeaders,
            body: JSON.stringify(purchasePayload)
          });

          if (res.ok) {
            const resData = await res.json();
            orderId = String(resData.orderId || resData.id || "GDDY-" + Math.floor(Math.random() * 900000 + 100000));
            registerSuccess = true;
          } else {
            const errText = await res.text();
            let parsedErr: any = {};
            try { parsedErr = JSON.parse(errText); } catch { /* ignore */ }
            errMsg = parsedErr?.message || parsedErr?.fields?.[0]?.message || errText || "GoDaddy Registration Rejected";
            console.error(`[GODADDY_PURCHASE_FAIL] Status: ${res.status}, Error:`, errText);
          }
        } catch (err: any) {
          errMsg = err.message || "Network connection failure to GoDaddy";
          console.error("[GODADDY_PURCHASE_FAIL] Network/Internal crash:", err);
        }
      }

      // 7. HANDLE REGISTRAR RESPONSE
      if (registerSuccess) {
        console.log(`[REGISTRAR_SUCCESS] Order ID: ${orderId}`);

        // Update purchase record
        await supabaseAdmin
          .from("domain_purchases")
          .update({ status: "active", registrar_order_id: orderId })
          .eq("id", purchaseRecord.id);

        // Link custom domain to the Reseller Storefront and Mark as instantly verified!
        const { error: linkError } = await supabaseAdmin
          .from("reseller_stores")
          .update({
            custom_domain: cleanDomain,
            domain_verified: true
          })
          .eq("id", store_id);

        if (linkError) {
          console.error(`[STORE_LINK_ERR] Failed to update reseller_store ${store_id}:`, linkError);
          // Return registered success since domain was purchased but notify about mapping issue
          return new Response(JSON.stringify({
            success: true,
            domain: cleanDomain,
            message: "Domain purchased successfully, but manual storefront mapping is pending. Contact support."
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          domain: cleanDomain,
          message: "🎉 Custom domain registered and activated successfully!"
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } else {
        console.error(`[REGISTRAR_FAIL] ${errMsg}`);

        // Update purchase record to failed
        await supabaseAdmin
          .from("domain_purchases")
          .update({ status: "failed", error_message: errMsg })
          .eq("id", purchaseRecord.id);

        // ATOMIC ROLLBACK / REFUND WALLET
        console.log(`[REFUND] Refunding wallet by GHS ${salePrice}...`);
        await supabaseAdmin.rpc("credit_wallet", {
          p_agent_id: user.id,
          p_amount: salePrice
        });

        return new Response(JSON.stringify({
          error: `Registrar registration failed: ${errMsg || "Unknown service error"}. Your wallet has been refunded.`
        }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("[CRASH] Unhandled edge function crash:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
