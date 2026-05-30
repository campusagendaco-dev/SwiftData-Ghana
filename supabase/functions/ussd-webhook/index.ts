import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Map network inputs to normalized names
function normalizeNetwork(net: string): string {
  const normalized = net.trim().toUpperCase();
  if (normalized === "1" || normalized.includes("MTN")) return "MTN";
  if (normalized === "2" || normalized.includes("TELECEL") || normalized.includes("VODA")) return "Telecel";
  if (normalized === "3" || normalized.includes("AT") || normalized.includes("AIRTEL")) return "AirtelTigo";
  return "MTN";
}

// Map user selected number to MoMo provider code for Paystack
function getMomoProviderCode(phone: string, inputProvider: string): string {
  const p = inputProvider.trim().toUpperCase();
  if (p === "MTN" || p === "1") return "mtn";
  if (p === "TELECEL" || p === "2") return "vod";
  if (p === "AT" || p === "3") return "atl";
  
  // Auto-detect based on Ghanaian phone prefix
  const mtnPrefixes = ["024", "025", "053", "054", "055", "059", "23324", "23325", "23353", "23354", "23355", "23359"];
  const telecelPrefixes = ["020", "050", "23320", "23350"];
  const atPrefixes = ["026", "027", "056", "057", "23326", "23327", "23356", "23357"];
  
  if (mtnPrefixes.some(pre => phone.startsWith(pre))) return "mtn";
  if (telecelPrefixes.some(pre => phone.startsWith(pre))) return "vod";
  if (atPrefixes.some(pre => phone.startsWith(pre))) return "atl";
  
  return "mtn"; // Default
}

// Map user selections to package size names (matches database keys)
function getPackageSizeBySelection(network: string, selection: string): string {
  const sel = selection.trim();
  if (network === "MTN") {
    const pkgs: Record<string, string> = { "1": "1GB", "2": "2GB", "3": "5GB", "4": "10GB" };
    return pkgs[sel] || "1GB";
  } else if (network === "Telecel") {
    const pkgs: Record<string, string> = { "1": "1.5GB", "2": "3GB", "3": "8GB" };
    return pkgs[sel] || "1.5GB";
  } else {
    const pkgs: Record<string, string> = { "1": "2GB", "2": "5GB" };
    return pkgs[sel] || "2GB";
  }
}

// Format phone number to standard Ghana format (0XXXXXXXXX)
function formatLocalPhone(phone: string): string {
  const clean = phone.replace(/\D+/g, "");
  if (clean.startsWith("233") && clean.length === 12) {
    return `0${clean.slice(3)}`;
  }
  if (clean.length === 9) {
    return `0${clean}`;
  }
  return clean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let PAYSTACK_SECRET_KEY = "";
  try {
    const { data: settings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("paystack_secret_key")
      .eq("id", 1)
      .maybeSingle();
    PAYSTACK_SECRET_KEY = settings?.paystack_secret_key || "";
  } catch (dbErr) {
    console.error("Failed to fetch paystack_secret_key from DB in ussd-webhook:", dbErr);
  }

  if (!PAYSTACK_SECRET_KEY) {
    PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  }

  // Security: Limit USSD function execution to verified callers if secret is active
  const USSD_WEBHOOK_SECRET = Deno.env.get("USSD_WEBHOOK_SECRET");
  if (USSD_WEBHOOK_SECRET) {
    const providedKey = new URL(req.url).searchParams.get("key") || req.headers.get("X-Webhook-Secret");
    if (providedKey !== USSD_WEBHOOK_SECRET) {
      console.warn("[USSD Webhook] Intrusion attempt blocked — missing or invalid key.");
      return new Response(JSON.stringify({ message: "Service authentication required", continueSession: false }), { 
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  try {
    const payload = await req.json();
    const { sessionID, userID, newSession, msisdn, userData } = payload;
    const callerPhone = formatLocalPhone(msisdn);

    let message = "";
    let continueSession = true;

    if (newSession === true) {
      // 1. FIRST REQUEST: SESSION INITIATION
      // Extract agent storefront code from dial string (e.g. *384*100*123456# -> 123456)
      let agentCode = "";
      const dialCode = String(userData || "");
      const suffixMatch = dialCode.match(/\*384\*\d+\*(\d+)#/);
      
      if (suffixMatch) {
        agentCode = suffixMatch[1];
      }

      if (agentCode) {
        // Direct Dial Storefront (e.g., *384*100*123456#)
        const { data: agent } = await supabaseAdmin
          .from("profiles")
          .select("store_name, is_agent, agent_approved")
          .eq("topup_reference", agentCode)
          .maybeSingle();

        if (agent && agent.is_agent && agent.agent_approved) {
          // Store found & active. Save USSD session.
          await supabaseAdmin.from("ussd_sessions").upsert({
            session_id: sessionID,
            phone_number: callerPhone,
            agent_code: agentCode,
            current_step: "MAIN_MENU",
            order_data: {},
          });

          message = `Welcome to ${agent.store_name || "SwiftData Store"}\n1. Buy Mobile Data\n2. Store Info`;
        } else {
          message = "Invalid or unapproved store code. Please verify and try again.";
          continueSession = false;
        }
      } else {
        // Generic Dial (e.g., *384*100#). Ask for Store Code.
        await supabaseAdmin.from("ussd_sessions").upsert({
          session_id: sessionID,
          phone_number: callerPhone,
          current_step: "ENTER_STORE_CODE",
          order_data: {},
        });

        message = "Welcome to SwiftData Ghana\nPlease enter the 6-digit Store Code:";
      }

    } else {
      // 2. RECURRING REQUESTS: SESSION CONTINUATION
      const input = String(userData || "").trim();

      // Retrieve existing USSD session state
      const { data: session } = await supabaseAdmin
        .from("ussd_sessions")
        .select("*")
        .eq("session_id", sessionID)
        .maybeSingle();

      if (!session) {
        message = "Session expired or invalid. Please dial again.";
        continueSession = false;
      } else {
        const currentStep = session.current_step;
        const orderData = session.order_data as Record<string, any>;
        const agentCode = session.agent_code;

        if (currentStep === "ENTER_STORE_CODE") {
          // Validate input store code
          const { data: agent } = await supabaseAdmin
            .from("profiles")
            .select("store_name, is_agent, agent_approved")
            .eq("topup_reference", input)
            .maybeSingle();

          if (agent && agent.is_agent && agent.agent_approved) {
            await supabaseAdmin.from("ussd_sessions").update({
              agent_code: input,
              current_step: "MAIN_MENU",
            }).eq("session_id", sessionID);

            message = `Welcome to ${agent.store_name || "SwiftData Store"}\n1. Buy Mobile Data\n2. Store Info`;
          } else {
            message = "Invalid Store Code. Please enter your 6-digit Store Code:";
          }

        } else if (currentStep === "MAIN_MENU") {
          if (input === "1") {
            await supabaseAdmin.from("ussd_sessions").update({
              current_step: "SELECT_NETWORK",
            }).eq("session_id", sessionID);

            message = "Select Network:\n1. MTN\n2. Telecel (Vodafone)\n3. AT (AirtelTigo)";
          } else if (input === "2") {
            const { data: agent } = await supabaseAdmin
              .from("profiles")
              .select("store_name")
              .eq("topup_reference", agentCode)
              .maybeSingle();

            message = `Store: ${agent?.store_name || "SwiftData Store"}\nCode: ${agentCode}\nPowered by SwiftData Ghana.`;
            continueSession = false;
            await supabaseAdmin.from("ussd_sessions").delete().eq("session_id", sessionID);
          } else {
            message = "Invalid option.\n\n1. Buy Mobile Data\n2. Store Info";
          }

        } else if (currentStep === "SELECT_NETWORK") {
          const network = normalizeNetwork(input);
          const updatedOrder = { ...orderData, network };

          await supabaseAdmin.from("ussd_sessions").update({
            current_step: "SELECT_PACKAGE",
            order_data: updatedOrder,
          }).eq("session_id", sessionID);

          if (network === "MTN") {
            message = "Select MTN Package:\n1. 1GB (GHS 4.50)\n2. 2GB (GHS 9.00)\n3. 5GB (GHS 22.50)\n4. 10GB (GHS 44.50)";
          } else if (network === "Telecel") {
            message = "Select Telecel Package:\n1. 1.5GB (GHS 6.00)\n2. 3GB (GHS 11.50)\n3. 8GB (GHS 28.00)";
          } else {
            message = "Select AT Package:\n1. 2GB (GHS 5.00)\n2. 5GB (GHS 12.00)";
          }

        } else if (currentStep === "SELECT_PACKAGE") {
          const network = orderData.network;
          const packageSize = getPackageSizeBySelection(network, input);
          const updatedOrder = { ...orderData, package_size: packageSize };

          await supabaseAdmin.from("ussd_sessions").update({
            current_step: "ENTER_RECIPIENT",
            order_data: updatedOrder,
          }).eq("session_id", sessionID);

          message = "Enter Recipient Phone Number:";

        } else if (currentStep === "ENTER_RECIPIENT") {
          const recipient = formatLocalPhone(input);
          const updatedOrder = { ...orderData, recipient };

          await supabaseAdmin.from("ussd_sessions").update({
            current_step: "ENTER_PAY_PHONE",
            order_data: updatedOrder,
          }).eq("session_id", sessionID);

          message = `Enter Mobile Money Number to Pay From:\n(Enter 0 to pay with your current phone: ${callerPhone})`;

        } else if (currentStep === "ENTER_PAY_PHONE") {
          const payPhone = input === "0" ? callerPhone : formatLocalPhone(input);
          const updatedOrder: Record<string, any> = { ...orderData, pay_phone: payPhone };

          await supabaseAdmin.from("ussd_sessions").update({
            current_step: "CONFIRM_ORDER",
            order_data: updatedOrder,
          }).eq("session_id", sessionID);

          const { network, package_size, recipient } = updatedOrder;

          // Fetch dynamic pricing
          const { data: pkgSetting } = await supabaseAdmin
            .from("global_package_settings")
            .select("cost_price, agent_price, public_price")
            .eq("network", network)
            .eq("package_size", package_size)
            .maybeSingle();

          const wholesalePrice = Number(pkgSetting?.agent_price || 0);
          const retailPrice = Number(pkgSetting?.public_price || wholesalePrice * 1.15);
          const paystackFee = parseFloat((retailPrice * 0.03).toFixed(2));
          const finalChargedAmount = parseFloat((retailPrice + paystackFee).toFixed(2));

          message = `Confirm Order:\nSend ${network} ${package_size} to ${recipient}?\n` +
                    `Pay GHS ${finalChargedAmount.toFixed(2)} (inc. fee) from MoMo: ${payPhone}\n\n` +
                    `1. Confirm and Trigger PIN Prompt\n` +
                    `2. Cancel`;

        } else if (currentStep === "CONFIRM_ORDER") {
          if (input === "1") {
            const { network, package_size, recipient, pay_phone } = orderData;

            // Resolve dynamic pricing
            const { data: pkgSetting } = await supabaseAdmin
              .from("global_package_settings")
              .select("cost_price, agent_price, public_price")
              .eq("network", network)
              .eq("package_size", package_size)
              .maybeSingle();

            const costPrice = Number(pkgSetting?.cost_price || pkgSetting?.agent_price || 0);
            const wholesalePrice = Number(pkgSetting?.agent_price || 0);
            const retailPrice = Number(pkgSetting?.public_price || wholesalePrice * 1.15);
            const profit = Math.max(0, parseFloat((retailPrice - wholesalePrice).toFixed(2)));
            const paystackFee = parseFloat((retailPrice * 0.03).toFixed(2));
            const finalChargedAmount = parseFloat((retailPrice + paystackFee).toFixed(2));

            // Generate unique reference
            const orderReference = `ussd_${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

            // Fetch agent profile details
            const { data: agent } = await supabaseAdmin
              .from("profiles")
              .select("user_id")
              .eq("topup_reference", agentCode)
              .maybeSingle();

            if (!agent) {
              message = "An error occurred fetching store info. Please try again.";
              continueSession = false;
              await supabaseAdmin.from("ussd_sessions").delete().eq("session_id", sessionID);
            } else {
              // Create pending order
              const orderRow = {
                id: orderReference,
                agent_id: agent.user_id,
                order_type: "data",
                amount: finalChargedAmount,
                paystack_fee: paystackFee,
                cost_price: costPrice,
                profit: profit,
                status: "pending",
                customer_phone: recipient,
                network: network,
                package_size: package_size,
              };

              const { error: orderErr } = await supabaseAdmin.from("orders").insert(orderRow);
              if (orderErr) {
                console.error("USSD Order Insert Failure:", orderErr);
                message = "Failed to register order. Please try again.";
                continueSession = false;
              } else {
                // Call Paystack Charge API to trigger prompt
                const chargeProvider = getMomoProviderCode(pay_phone, network);
                const paystackRes = await fetch("https://api.paystack.co/charge", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify({
                    email: `ussd-agent-${agentCode}@swiftdata.com`,
                    amount: Math.round(finalChargedAmount * 100),
                    currency: "GHS",
                    reference: orderReference,
                    mobile_money: {
                      phone: pay_phone,
                      provider: chargeProvider
                    },
                    metadata: {
                      order_id: orderReference,
                      order_type: "data",
                      agent_id: agent.user_id,
                      network: network,
                      package_size: package_size,
                      customer_phone: recipient,
                      base_price: retailPrice,
                      cost_price: costPrice,
                      profit: profit,
                      channel: "ussd"
                    }
                  })
                });

                const chargeData = await paystackRes.json();
                if (paystackRes.ok && chargeData.status) {
                  message = `A Mobile Money PIN prompt has been sent to ${pay_phone}.\n\n` +
                            `Please enter your PIN on your phone to complete payment and receive your data!`;
                } else {
                  console.error("Paystack Charge Error:", chargeData);
                  await supabaseAdmin.from("orders").update({
                    status: "failed",
                    failure_reason: chargeData.message || "Paystack charge initiation failed."
                  }).eq("id", orderReference);

                  message = `Payment prompt failed: ${chargeData.message || "Failed to trigger prompt"}.\n` +
                            `Please check your wallet connection and try again.`;
                }
                continueSession = false;
                await supabaseAdmin.from("ussd_sessions").delete().eq("session_id", sessionID);
              }
            }
          } else {
            message = "Order cancelled. Thank you.";
            continueSession = false;
            await supabaseAdmin.from("ussd_sessions").delete().eq("session_id", sessionID);
          }
        }
      }
    }

    // Return exact Arkesel JSON response format
    const responseJson = {
      sessionID: sessionID,
      userID: userID || "USSD_ENDPOINT",
      msisdn: msisdn,
      message: message,
      continueSession: continueSession
    };

    return new Response(JSON.stringify(responseJson), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      }
    });

  } catch (err) {
    console.error("USSD Critical Error:", err);
    
    // Fallback response inside catch block to avoid unhandled errors
    try {
      const payload = await req.json();
      return new Response(JSON.stringify({
        sessionID: payload?.sessionID || "",
        userID: payload?.userID || "USSD_ENDPOINT",
        msisdn: payload?.msisdn || "",
        message: "A critical system error occurred. Please try again shortly.",
        continueSession: false
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch {
      return new Response(JSON.stringify({
        message: "A critical system error occurred. Please try again shortly.",
        continueSession: false
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
});
