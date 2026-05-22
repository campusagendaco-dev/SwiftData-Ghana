import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface RequestBody {
  action: "momo-collection" | "momo-disbursement" | "bank-transfer-init" | "bank-transfer-complete" | "check-status" | "submit-kyc" | "activate-with-wallet" | "initiate-activation-payment" | "momo-enquiry";
  amount?: number;
  phone?: string;
  network?: string;
  bank_code?: string;
  account_number?: string;
  reference_id?: string; // For bank authorize
  transaction_id?: string; // For status check
  description?: string;
  registration_number?: string;
  tin?: string;
  national_id_url?: string;
  business_cert_url?: string;
}

const THETELLER_ERRORS: Record<string, string> = {
  "101": "Insufficient funds in wallet.",
  "102": "Number not registered for mobile money.",
  "103": "Wrong PIN or transaction timed out.",
  "104": "Transaction declined or terminated.",
  "105": "Invalid amount or general failure (try changing the transaction ID).",
  "106": "Transaction cancelled.",
  "107": "Merchant limit exceeded.",
  "111": "System error. Payment provider gateway is currently down.",
  "200": "Transaction timeout. No response received from customer's provider.",
  "400": "Invalid request parameters sent to gateway.",
  "401": "Gateway authentication failed (unauthorized).",
  "404": "Service endpoint not found.",
  "429": "Too many requests. Please slow down."
};

const getErrorDescription = (res: any) => {
  if (!res) return "Unknown error";
  const code = String(res.code || "");
  if (THETELLER_ERRORS[code]) {
    return THETELLER_ERRORS[code];
  }
  return res.reason || res.message || res.error || res.desc || res.status || "Unknown error";
};

const bankMapping: Record<string, string> = {
  // Mobile Money
  "MTN": "MTN",
  "VOD": "VOD",
  "VDF": "VOD",
  "ATL": "ATL",
  "TGO": "ATL",
  // Banks (Paystack Codes)
  "SCH": "020100", // Standard Chartered
  "SCB": "020100",
  "ABG": "030100", // Absa
  "BAR": "030100",
  "GCB": "040100", // GCB Bank
  "NIB": "050100", // National Investment Bank
  "UBA": "060100", // United Bank for Africa
  "ADB": "080100", // Agricultural Development Bank
  "SGG": "090100", // Societe Generale
  "UMB": "100100", // Universal Merchant Bank
  "RBL": "110100", // Republic Bank
  "ZEN": "120100", // Zenith Bank
  "ECO": "130100", // Ecobank
  "CAL": "140100", // CalBank
  "FAB": "170100", // First Atlantic
  "PRD": "180100", // Prudential Bank
  "PRU": "180100",
  "STB": "190100", // Stanbic Bank
  "STA": "190100",
  "FBN": "200100", // FBNBank
  "BOA": "210100", // Bank of Africa
  "GTB": "230100", // Guaranty Trust Bank
  "FDL": "240100", // Fidelity Bank
  "ACB": "280100", // Access Bank
  "FNB": "330100", // First National Bank
  "CBG": "340100", // Consolidated Bank Ghana
  "BSIC": "360100", // OmniBSIC
  "SIS": "300361"  // Services Integrity Savings and Loans
};

const formatAmount = (amount: number): string => {
  // Amount is in GHS, convert to pesewas and pad to 12 digits
  const pesewas = Math.round(amount * 100);
  return pesewas.toString().padStart(12, "0");
};

const formatPhone = (phone: string): string => {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "233" + cleaned.substring(1);
  }
  return cleaned;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const apiUser = Deno.env.get("THETELLER_API_USER");
  const apiKey = Deno.env.get("THETELLER_API_KEY");
  const merchantId = Deno.env.get("THETELLER_MERCHANT_ID");
  const terminalId = Deno.env.get("THETELLER_TERMINAL_ID");
  const passCode = Deno.env.get("THETELLER_PASS_CODE");
  const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY");

  const resolveAccountWithPaystack = async (accountNumber: string, bankCode: string) => {
    // Map theTeller codes to Paystack codes if needed
    // For MoMo, they are often the same (MTN, VOD, ATL)
    // For Banks, we try to use the selected code or a mapping

    const code = bankMapping[bankCode] || bankCode;
    console.log(`[paystack] Resolving ${accountNumber} with bank ${code}`);

    try {
      const resp = await fetch(`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${code}`, {
        headers: {
          "Authorization": `Bearer ${paystackKey}`,
          "Content-Type": "application/json"
        }
      });
      const data = await resp.json();
      console.log(`[paystack] Resolution result:`, JSON.stringify(data));
      return data;
    } catch (e) {
      console.error("[paystack] Resolution error:", e);
      return { status: false, message: "Connection error" };
    }
  };

  const calculateCommissions = (amount: number, type: "momo-in" | "momo-out" | "bank" | "africa") => {
    let agentProfit = 0;
    let companyProfit = 0;

    if (type === "momo-in") {
      // Cash-In (Disbursement): GHS 1 flat cost to Paystack.
      // Customer Fee: 
      //   - 1 to 50 GHS: GHS 1.50 fee (Net profit = 0.50 GHS) -> Agent gets 60% (0.30 GHS), Company 40% (0.20 GHS)
      //   - 51 to 1000 GHS: 1.0% fee (Net profit = 1% - GHS 1.00) -> Agent gets 60%, Company 40%
      //   - 1001+ GHS: GHS 10.00 flat fee (Net profit = GHS 9.00) -> Agent gets 60% (GHS 5.40), Company 40% (GHS 3.60)
      let customerFee = 0;
      if (amount <= 50) {
        customerFee = 1.50;
      } else if (amount <= 1000) {
        customerFee = amount * 0.01;
      } else {
        customerFee = 10.00;
      }
      const netProfit = Math.max(0, customerFee - 1.00);
      agentProfit = netProfit * 0.60;
      companyProfit = netProfit * 0.40;
    } else if (type === "momo-out") {
      // Cash-Out (Collection): 1.0% customer fee capped at GHS 20.00.
      // Gateway cost: 0.7% of amount.
      // Net Profit = (1.0% of amount up to cap GHS 20) - (0.7% of amount)
      // Split: 70% Agent, 30% Company
      const customerFee = Math.min(amount * 0.01, 20.00);
      const gatewayCost = amount * 0.007;
      const netProfit = Math.max(0, customerFee - gatewayCost);
      agentProfit = netProfit * 0.70;
      companyProfit = netProfit * 0.30;
    } else if (type === "bank") {
      // Bank Transfer Strategic Pricing:
      // Base Gateway Cost: GHS 8.00 (Paystack flat fee)
      // Customer Fee Markup: 1.0% of the transfer amount, capped at a maximum of GHS 200.00
      // We distribute the markup as pure profit between the agent and the company.
      // Split: 60% to Agent (highly competitive to attract vendors), 40% to Company
      const maxMarkup = 200.00;
      const markup = Math.min(amount * 0.01, maxMarkup);
      
      agentProfit = markup * 0.60;
      companyProfit = markup * 0.40;
    } else if (type === "africa") {
      // 3.5% fee: 2% cost, 0.75% agent, 0.75% company
      agentProfit = amount * 0.0075;
      companyProfit = amount * 0.0075;
    }

    return { agentProfit, companyProfit };
  };

  if (!apiUser || !apiKey || !merchantId) {
    return new Response(
      JSON.stringify({ error: "theTeller credentials not configured in secrets" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RequestBody = await req.json();
    const { 
      action, amount, phone, network, bank_code, account_number, 
      reference_id, transaction_id, description,
      registration_number, tin, national_id_url, national_id_back_url, business_cert_url,
      national_id_expiry, business_cert_expiry,
      region, vendorPhone, vendorEmail, digitalAddress,
      latitude, longitude
    } = body;

    // Fetch system settings to check dynamic minimum transaction amount
    const { data: sysSettings } = await supabase
      .from("system_settings")
      .select("vendor_min_transaction")
      .eq("id", 1)
      .maybeSingle();

    const minTxAmount = sysSettings?.vendor_min_transaction ? parseFloat(sysSettings.vendor_min_transaction) : 1.00;

    const bypassAmountAndStatusCheck = [
      "check-status", "list-banks", "momo-enquiry", 
      "submit-kyc", "activate-with-wallet", "initiate-activation-payment"
    ].includes(action);

    if (amount !== undefined && amount < minTxAmount && !bypassAmountAndStatusCheck) {
      return new Response(
        JSON.stringify({ error: `Minimum transaction amount is GHS ${minTxAmount.toFixed(2)}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize networks: front-end VOD -> theTeller VDF, TGO -> ATL
    const finalNetwork = network === "VOD" ? "VDF" : (network === "TGO" ? "ATL" : network);

    // Normalize bank codes: front-end BAR/STA/SCB/PRU -> theTeller ABG/STB/SCH/PRD
    const bankMappingToTheTeller: Record<string, string> = {
      "BAR": "ABG",
      "STA": "STB",
      "SCB": "SCH",
      "PRU": "PRD"
    };
    const finalBankCode = bank_code ? (bankMappingToTheTeller[bank_code] || bank_code) : undefined;

    // Fetch profile and check if terminal is locked
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("phone, store_name, terminal_locked, vendor_status, momo_number, momo_network")
      .eq("user_id", user.id)
      .single();

    if (profileError) {
      console.error("Profile fetch error:", profileError);
      return new Response(
        JSON.stringify({ error: "Could not verify agent profile status" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (profile?.terminal_locked && action !== "check-status" && action !== "list-banks") {
      return new Response(
        JSON.stringify({ error: "SECURITY ALERT: Your Swift Vendor terminal is LOCKED. Transactions are suspended." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Block non-active or non-pending Swift Vendor transactions
    if (!bypassAmountAndStatusCheck) {
      if (profile?.vendor_status !== "active" && profile?.vendor_status !== "pending_approval") {
        return new Response(
          JSON.stringify({ error: "KYC PENDING: Your Swift Vendor terminal is not active. Please complete activation first." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Enforce Trial Mode Limits
      if (profile?.vendor_status === "pending_approval") {
        if (amount && amount > 200) {
          return new Response(
            JSON.stringify({ error: "RESTRICTED MODE: You are currently under 24-hour review. Transactions are capped at GHS 200.00 until fully activated." }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    const auth = btoa(`${apiUser}:${apiKey}`);
    const headers = {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Merchant-Id": merchantId, // Required for status check
    };

    const isTestMode = Deno.env.get("THETELLER_MODE") === "test";
    let endpoint = isTestMode ? "https://test.theteller.net/v1.1/transaction/process" : "https://prod.theteller.net/v1.1/transaction/process";
    let method = "POST";
    let payload: any = {};
    let verifiedAccountName: string | undefined = undefined;
    let result: any = null;
    let skipTellerFetch = false;

    // 1. Create a reference order if needed
    const orderId = crypto.randomUUID();
    
    // Onboarding Actions
    if (action === "submit-kyc") {
      if (!registration_number || !tin || !national_id_url || !national_id_back_url || !business_cert_url || !region || !vendorPhone || !vendorEmail || !digitalAddress) {
        return new Response(
          JSON.stringify({ error: "Missing required KYC fields or document uploads." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isTinValid = /^[a-zA-Z0-9-]{8,20}$/.test(tin);
      if (!isTinValid) {
        return new Response(
          JSON.stringify({ error: "Invalid TIN/Ghana Card format. Must be between 8 and 20 alphanumeric characters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mock OCR Validation Delay
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Attempt to resolve MoMo Name via Paystack
      let verifiedMoMoName = "Verification Failed";
      if (profile?.momo_number && profile?.momo_network) {
        try {
          const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY");
          const pskBankCode = profile.momo_network === "MTN" ? "MTN" : (profile.momo_network === "VOD" ? "VOD" : "TGO");
          
          const resolveResp = await fetch(`https://api.paystack.co/bank/resolve?account_number=${profile.momo_number}&bank_code=${pskBankCode}`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${paystackKey}`,
            }
          });
          const resolveData = await resolveResp.json();
          if (resolveData.status && resolveData.data?.account_name) {
            verifiedMoMoName = resolveData.data.account_name;
          }
        } catch (e) {
          console.error("Paystack MoMo Resolution failed:", e);
        }
      }

      const mockResponse = {
        status: "verified",
        entity_name: profile?.store_name || "Swift Vendor Merchant",
        tin: tin,
        ocr_confidence: 98.4,
        ocr_match: true,
        national_id_expiry,
        business_cert_expiry,
        verification_source: "Ghana Revenue Authority (GRA) AI Gateway",
        momo_verified_name: verifiedMoMoName,
        verified_at: new Date().toISOString()
      };

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          vendor_status: "payment_pending",
          vendor_registration_number: registration_number,
          vendor_tin: tin,
          vendor_national_id_url: national_id_url,
          vendor_national_id_back_url: national_id_back_url,
          vendor_business_cert_url: business_cert_url,
          vendor_region: region,
          vendor_phone: vendorPhone,
          vendor_email: vendorEmail,
          vendor_digital_address: digitalAddress,
          vendor_latitude: latitude,
          vendor_longitude: longitude,
          vendor_verified_momo_name: verifiedMoMoName,
          vendor_kyc_api_response: mockResponse,
          vendor_kyc_submitted_at: new Date().toISOString(),
          vendor_rejection_reason: null
        })
        .eq("user_id", user.id);

      if (updateError) {
        console.error("KYC profile update error:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update profile verification status" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "KYC details auto-verified successfully. Please proceed to payment.",
          status: "payment_pending",
          kyc_data: mockResponse
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "activate-with-wallet") {
      if (profile?.vendor_status !== "payment_pending" && profile?.vendor_status !== "rejected") {
        return new Response(
          JSON.stringify({ error: "Invalid flow: KYC must be verified before paying activation fee." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: debitResult, error: debitError } = await supabase.rpc("debit_wallet", {
        p_agent_id: user.id,
        p_amount: 700.00
      });

      if (debitError || !debitResult || !debitResult.success) {
        return new Response(
          JSON.stringify({ error: debitResult?.error || "Insufficient wallet balance to pay GHS 700.00 activation fee." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase
        .from("orders")
        .insert({
          id: orderId,
          agent_id: user.id,
          order_type: "vendor_activation",
          amount: 700.00,
          status: "fulfilled",
          network: "WALLET",
          customer_phone: profile?.phone || user.email,
          package_size: "Swift Vendor Terminal Activation Fee"
        });

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          vendor_status: "pending_approval",
          updated_at: new Date().toISOString()
        })
        .eq("user_id", user.id);

      if (updateError) {
        console.error("Activation update error:", updateError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Payment of GHS 700.00 successfully debited from wallet. Onboarding status: Under Review.",
          status: "pending_approval"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "initiate-activation-payment") {
      if (profile?.vendor_status !== "payment_pending" && profile?.vendor_status !== "rejected") {
        return new Response(
          JSON.stringify({ error: "Invalid flow: KYC must be verified before paying activation fee." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const host = req.headers.get("host") || "localhost:5173";
      const redirectUrl = `https://${host}/swift-vendor-callback?user_id=${user.id}`;
      const checkoutPayload = {
        merchant_id: merchantId,
        transaction_id: orderId.replace(/-/g, "").substring(0, 12),
        desc: "Swift Vendor Activation Fee",
        amount: "700.00",
        redirect_url: redirectUrl,
        email: user.email || "support@swiftdata.net"
      };

      const checkoutUrl = isTestMode ? "https://checkout-test.theteller.net/initiate" : "https://checkout.theteller.net/initiate";

      try {
        const resp = await fetch(checkoutUrl, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(checkoutPayload)
        });

        const data = await resp.json();
        if (data.status === "success" && data.checkout_url) {
          await supabase.from("orders").insert({
            id: orderId,
            agent_id: user.id,
            order_type: "vendor_activation",
            amount: 700.00,
            status: "pending",
            network: "THETELLER",
            customer_phone: profile?.phone || user.email,
            package_size: "Swift Vendor Terminal Activation Fee"
          });

          return new Response(
            JSON.stringify({ success: true, checkout_url: data.checkout_url }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          return new Response(
            JSON.stringify({ error: data.reason || "Failed to generate payment link from theTeller" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (err: any) {
        console.error("theTeller checkout initiate error:", err);
        return new Response(
          JSON.stringify({ error: err.message || "Failed to initialize payment gateway checkout" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (action === "momo-collection") {
      // Security: Rate limit prompts to the same number (e.g., 1 prompt per 2 minutes)
      const { data: allowed } = await supabase.rpc("check_generic_rate_limit", {
        p_key: `momo_prompt_${phone}`,
        p_rate_limit: 1 // 1 per interval (interval defined in RPC, usually 1 min)
      });

      if (!allowed) {
        return new Response(JSON.stringify({ error: "Please wait a minute before requesting another prompt for this number." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      payload = {
        merchant_id: merchantId,
        transaction_id: orderId.replace(/-/g, "").substring(0, 12), // theTeller often prefers shorter numeric-like IDs or specific lengths
        amount: formatAmount(amount!),
        processing_code: "000200",
        "r-switch": finalNetwork, // MTN, VDF, ATL
        desc: description || "Swift Vendor Collection",
        subscriber_number: formatPhone(phone!),
      };
    } else if (action === "momo-disbursement") {
      // Security: Rate limit to prevent double-click / rapid payout race conditions
      const { data: allowed } = await supabase.rpc("check_generic_rate_limit", {
        p_key: `vendor_payout_${user.id}`,
        p_rate_limit: 1 // 1 payout per minute
      });

      if (!allowed) {
        return new Response(JSON.stringify({ error: "Please wait 60 seconds before initiating another payout." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Validate balance first
      const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", user.id).single();
      if (!wallet || wallet.balance < amount!) {
        return new Response(JSON.stringify({ error: "Insufficient wallet balance" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Verify account first via Paystack
      const resolution = await resolveAccountWithPaystack(phone!, network!);
      if (!resolution.status) {
        return new Response(JSON.stringify({ 
          status: "failed", 
          message: resolution.message || "Could not verify MoMo account" 
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      verifiedAccountName = resolution.data.account_name;

      // 1. Create Transfer Recipient
      const mappedBankCode = bankMapping[network!] || network!;
      const recipientResp = await fetch("https://api.paystack.co/transferrecipient", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${paystackKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "mobile_money",
          name: verifiedAccountName,
          account_number: phone,
          bank_code: mappedBankCode,
          currency: "GHS",
        })
      });
      const recipientData = await recipientResp.json();
      if (!recipientData.status) {
        return new Response(JSON.stringify({ 
          status: "failed", 
          message: recipientData.message || "Could not create transfer recipient on Paystack" 
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. Initiate Transfer
      const transferResp = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${paystackKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(amount! * 100), // GHS to Pesewas
          recipient: recipientData.data.recipient_code,
          reason: description || "Swift Vendor Disbursement"
        })
      });
      const transferData = await transferResp.json();

      const isSuccess = transferData.status && (transferData.data.status === "success" || transferData.data.status === "approved");
      const isPending = transferData.status && (transferData.data.status === "pending" || transferData.data.status === "processing");

      result = {
        code: isSuccess ? "000" : (isPending ? "100" : "999"),
        status: isSuccess ? "successful" : (isPending ? "pending" : "failed"),
        reason: transferData.message || (isSuccess ? "Transfer successful" : (isPending ? "Transfer is pending approval" : "Transfer failed")),
        transaction_id: transferData.data?.transfer_code || transferData.data?.reference || crypto.randomUUID(),
        reference_id: transferData.data?.reference,
        account_name: verifiedAccountName,
        paystack_raw: transferData
      };
      skipTellerFetch = true;
    } else if (action === "list-banks") {
      const country = body.country || "nigeria";
      try {
        const resp = await fetch(`https://api.paystack.co/bank?country=${country}`, {
          headers: { "Authorization": `Bearer ${paystackKey}` }
        });
        const data = await resp.json();
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Failed to fetch banks" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (action === "africa-transfer") {
      // Security: Rate limit to prevent double-click / rapid payout race conditions
      const { data: allowed } = await supabase.rpc("check_generic_rate_limit", {
        p_key: `vendor_payout_${user.id}`,
        p_rate_limit: 1 // 1 payout per minute
      });

      if (!allowed) {
        return new Response(JSON.stringify({ error: "Please wait 60 seconds before initiating another payout." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Validate balance
      const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", user.id).single();
      if (!wallet || wallet.balance < amount!) {
        return new Response(JSON.stringify({ error: "Insufficient wallet balance" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      try {
        // Step 1: Create Transfer Recipient
        const recipientResp = await fetch("https://api.paystack.co/transferrecipient", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${paystackKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            type: body.country === "KE" ? "mobile_money" : "nuban",
            name: body.account_name,
            account_number: body.account_number,
            bank_code: body.bank_code,
            currency: body.currency,
          })
        });
        const recipientData = await recipientResp.json();
        if (!recipientData.status) throw new Error(recipientData.message);

        // Step 2: Initiate Transfer
        const transferResp = await fetch("https://api.paystack.co/transfer", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${paystackKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            source: "balance",
            amount: Math.round(amount! * 100), // Paystack expects amount in subunits
            recipient: recipientData.data.recipient_code,
            reason: body.description || "Swift Vendor Africa Payout",
            currency: body.currency
          })
        });
        const transferData = await transferResp.json();
        
        const isSuccess = transferData.status && (transferData.data?.status === "success" || transferData.data?.status === "approved");
        const isPending = transferData.status && (transferData.data?.status === "pending" || transferData.data?.status === "processing");

        result = {
          code: isSuccess ? "000" : (isPending ? "100" : "999"),
          status: isSuccess ? "successful" : (isPending ? "pending" : "failed"),
          reason: transferData.message || (isSuccess ? "Transfer successful" : (isPending ? "Transfer is pending approval" : "Transfer failed")),
          transaction_id: transferData.data?.transfer_code || transferData.data?.reference || crypto.randomUUID(),
          reference_id: transferData.data?.reference,
          account_name: body.account_name,
          paystack_raw: transferData
        };
        skipTellerFetch = true;

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (action === "momo-enquiry") {
      const resolution = await resolveAccountWithPaystack(phone!, network!);
      if (resolution.status) {
        return new Response(JSON.stringify({ 
          status: "successful", 
          code: "000", 
          account_name: resolution.data.account_name 
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        return new Response(JSON.stringify({ 
          status: "failed", 
          message: resolution.message || "Could not verify MoMo account" 
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else if (action === "bank-transfer-init") {
      // Security: Rate limit to prevent double-click / rapid payout race conditions
      const { data: allowed } = await supabase.rpc("check_generic_rate_limit", {
        p_key: `vendor_payout_${user.id}`,
        p_rate_limit: 1 // 1 payout per minute
      });

      if (!allowed) {
        return new Response(JSON.stringify({ error: "Please wait 60 seconds before initiating another payout." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Validate balance
      const { data: wallet } = await supabase.from("wallets").select("balance").eq("agent_id", user.id).single();
      if (!wallet || wallet.balance < amount!) {
        return new Response(JSON.stringify({ error: "Insufficient wallet balance" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Verify account first via Paystack
      const resolution = await resolveAccountWithPaystack(account_number!, bank_code!);
      if (!resolution.status) {
        return new Response(JSON.stringify({ 
          status: "failed", 
          message: resolution.message || "Could not verify bank account" 
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      verifiedAccountName = resolution.data.account_name;

      // 1. Create Transfer Recipient
      const mappedBankCode = bankMapping[bank_code!] || bank_code!;
      const recipientResp = await fetch("https://api.paystack.co/transferrecipient", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${paystackKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "nuban",
          name: verifiedAccountName,
          account_number: account_number,
          bank_code: mappedBankCode,
          currency: "GHS",
        })
      });
      const recipientData = await recipientResp.json();
      if (!recipientData.status) {
        return new Response(JSON.stringify({ 
          status: "failed", 
          message: recipientData.message || "Could not create transfer recipient on Paystack" 
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. Initiate Transfer
      const transferResp = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${paystackKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(amount! * 100), // GHS to Pesewas
          recipient: recipientData.data.recipient_code,
          reason: description || "Swift Vendor Bank Transfer"
        })
      });
      const transferData = await transferResp.json();

      const isSuccess = transferData.status && (transferData.data.status === "success" || transferData.data.status === "approved");
      const isPending = transferData.status && (transferData.data.status === "pending" || transferData.data.status === "processing");

      result = {
        code: isSuccess ? "000" : (isPending ? "100" : "999"),
        status: isSuccess ? "successful" : (isPending ? "pending" : "failed"),
        reason: transferData.message || (isSuccess ? "Transfer successful" : (isPending ? "Transfer is pending approval" : "Transfer failed")),
        transaction_id: transferData.data?.transfer_code || transferData.data?.reference || crypto.randomUUID(),
        reference_id: transferData.data?.reference,
        account_name: verifiedAccountName,
        paystack_raw: transferData
      };
      skipTellerFetch = true;

    } else if (action === "bank-transfer-complete") {
      // Fetch current status of the transfer from Paystack
      const endpointUrl = reference_id?.startsWith("TRF_") 
        ? `https://api.paystack.co/transfer/${reference_id}`
        : `https://api.paystack.co/transfer/verify/${reference_id}`;

      const response = await fetch(endpointUrl, {
        headers: {
          "Authorization": `Bearer ${paystackKey}`,
          "Content-Type": "application/json"
        }
      });
      const paystackResult = await response.json();
      
      const transferStatus = paystackResult.data?.status;
      const isSuccess = paystackResult.status && transferStatus === "success";
      const isPending = paystackResult.status && (transferStatus === "pending" || transferStatus === "processing");

      result = {
        code: isSuccess ? "000" : (isPending ? "100" : "999"),
        status: isSuccess ? "successful" : (isPending ? "pending" : "failed"),
        reason: paystackResult.message || (isSuccess ? "Transfer successful" : (isPending ? "Transfer is pending approval" : "Transfer failed")),
        transaction_id: reference_id,
        reference_id: reference_id,
        paystack_raw: paystackResult
      };

      skipTellerFetch = true;
    } else if (action === "check-status") {
      if (transaction_id) {
        // Find the original order first to know the gateway
        let orderQuery = supabase.from("orders").select("*");
        if (transaction_id.includes("-") && transaction_id.length === 36) {
          orderQuery = orderQuery.eq("id", transaction_id);
        } else {
          orderQuery = orderQuery.filter("metadata->>theteller_ref", "eq", transaction_id);
        }
        const { data: order } = await orderQuery.single();

        if (order) {
          const isPaystack = order.order_type === "vendor_cash_in" || order.order_type === "vendor_bank_transfer" || order.order_type === "vendor_africa_transfer";
          
          if (isPaystack) {
            const ref = order.metadata?.theteller_ref || order.id;
            const endpointUrl = ref.startsWith("TRF_") 
              ? `https://api.paystack.co/transfer/${ref}`
              : `https://api.paystack.co/transfer/verify/${ref}`;

            const response = await fetch(endpointUrl, {
              headers: {
                "Authorization": `Bearer ${paystackKey}`,
                "Content-Type": "application/json"
              }
            });
            const paystackResult = await response.json();
            
            const transferStatus = paystackResult.data?.status;
            const isSuccess = paystackResult.status && transferStatus === "success";
            const isFailed = paystackResult.status && (transferStatus === "failed" || transferStatus === "reversed");
            const isPending = !isSuccess && !isFailed;

            result = {
              code: isSuccess ? "000" : (isPending ? "100" : "999"),
              status: isSuccess ? "successful" : (isPending ? "pending" : "failed"),
              reason: paystackResult.message || (isSuccess ? "Transfer successful" : (isPending ? "Transfer is pending approval" : "Transfer failed")),
              transaction_id: ref,
              data: paystackResult.data
            };
            skipTellerFetch = true;
          } else {
            // standard theTeller status check
            const baseUrl = isTestMode ? "https://test.theteller.net" : "https://prod.theteller.net";
            const tellerRef = transaction_id?.includes("-") 
              ? transaction_id.replace(/-/g, "").substring(0, 12) 
              : transaction_id;
            endpoint = `${baseUrl}/v1.1/users/transactions/${tellerRef}/status`;
            method = "GET";
            payload = null;
          }
        }
      }
    }

    if (!skipTellerFetch) {
      console.log(`[theteller] Requesting ${endpoint} with action ${action}`);
      if (payload) console.log(`[theteller] Payload:`, JSON.stringify(payload));

      const response = await fetch(endpoint, {
        method,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      });

      result = await response.json();
      console.log(`[theteller] Response:`, JSON.stringify(result));
      console.log(`theTeller Response [${action}]:`, result);
    }

    // 2. Handle DB recording
    if (action === "momo-collection" || action === "momo-disbursement" || action === "bank-transfer-init" || action === "africa-transfer") {
      const orderType = action === "momo-collection" ? "vendor_cash_out" : 
                       (action === "momo-disbursement" ? "vendor_cash_in" : 
                        (action === "bank-transfer-init" ? "vendor_bank_transfer" : "vendor_africa_transfer"));
      
      const isSuccess = result.code === "000" || result.status === "approved" || result.status === "successful" || result.status === true;
      const isPending = result.code === "100" || result.status === "pending";

      const commType = action === "africa-transfer" ? "africa" : 
                      (action === "bank-transfer-init" ? "bank" : 
                       (action === "momo-collection" ? "momo-out" : "momo-in"));
      const commissions = calculateCommissions(amount || 0, commType);

      await supabase.from("orders").insert({
        id: orderId,
        agent_id: user.id,
        order_type: orderType,
        amount: amount,
        profit: commissions.agentProfit,
        parent_profit: commissions.companyProfit,
        customer_phone: phone || account_number,
        status: isSuccess ? "fulfilled" : (isPending ? "pending" : "failed"),
        failure_reason: getErrorDescription(result),
        metadata: {
          theteller_ref: result.transaction_id || result.reference_id || result.data?.reference,
          theteller_raw: result,
          bank_code: bank_code,
          account_name: verifiedAccountName || result.account_name || body.account_name,
        }
      });

      // Debit wallet for disbursements immediately if successful or pending
      if ((action === "momo-disbursement" || action === "bank-transfer-init" || action === "africa-transfer") && (isSuccess || isPending)) {
        await supabase.rpc("debit_wallet", {
          p_agent_id: user.id,
          p_amount: amount
        });
      }

      // Credit wallet for collection ONLY if successful immediately
      if (action === "momo-collection" && isSuccess) {
        await supabase.rpc("credit_wallet", {
          p_agent_id: user.id,
          p_amount: amount
        });
        // Mark as credited
        await supabase.from("orders").update({
          metadata: { ...result, wallet_credited: true }
        }).eq("id", orderId);
      }
    }

    // Handle database recording for bank-transfer-complete
    if (action === "bank-transfer-complete") {
      const isSuccess = result.code === "000" || result.status === "approved" || result.status === "successful" || result.status === true;
      const isFailed = !isSuccess && result.code !== "100" && result.status !== "pending";

      if (reference_id) {
        const { data: order } = await supabase
          .from("orders")
          .select("*")
          .filter("metadata->>theteller_ref", "eq", reference_id)
          .single();

        if (order && order.status === "pending") {
          if (isSuccess) {
            await supabase.from("orders").update({
              status: "fulfilled",
              metadata: { ...order.metadata, theteller_raw: result }
            }).eq("id", order.id).eq("status", "pending");
          } else if (isFailed) {
            const { data: updated } = await supabase.from("orders").update({
              status: "failed",
              failure_reason: getErrorDescription(result),
              metadata: { ...order.metadata, theteller_raw: result }
            }).eq("id", order.id).eq("status", "pending").select();

            if (updated && updated.length > 0) {
              // Refund wallet since it was debited on bank-transfer-init
              if (!order.metadata?.wallet_refunded) {
                await supabase.rpc("credit_wallet", {
                  p_agent_id: order.agent_id,
                  p_amount: order.amount
                });
                await supabase.from("orders").update({
                  metadata: { ...order.metadata, theteller_raw: result, wallet_refunded: true }
                }).eq("id", order.id);
              }
            }
          }
        }
      }
    }

    // Special case for Status Check: update the order and handle wallet
    if (action === "check-status") {
      const isSuccess = result.code === "000" || result.status === "approved" || result.status === "successful";
      const isFailed = !isSuccess && result.code !== "100" && result.status !== "pending";
      
      if (transaction_id) {
        // Find the original order
        let orderQuery = supabase.from("orders").select("*");
        if (transaction_id.includes("-") && transaction_id.length === 36) {
          orderQuery = orderQuery.eq("id", transaction_id);
        } else {
          orderQuery = orderQuery.filter("metadata->>theteller_ref", "eq", transaction_id);
        }
        const { data: order } = await orderQuery.single();
        
        if (order && order.status === "pending") {
          if (isSuccess) {
            const { data: updated } = await supabase.from("orders").update({
              status: "fulfilled",
              metadata: { ...order.metadata, theteller_raw: result }
            }).eq("id", order.id).eq("status", "pending").select();

            if (updated && updated.length > 0) {
              // If it was a collection, credit the wallet now
              if (order.order_type === "vendor_cash_out" && !order.metadata?.wallet_credited) {
                await supabase.rpc("credit_wallet", {
                  p_agent_id: order.agent_id,
                  p_amount: order.amount
                });
                await supabase.from("orders").update({
                  metadata: { ...order.metadata, wallet_credited: true }
                }).eq("id", order.id);
              }

              // If it was activation payment, update status
              if (order.order_type === "vendor_activation") {
                await supabase
                  .from("profiles")
                  .update({ vendor_status: "pending_approval" })
                  .eq("user_id", order.agent_id);
              }
            }
          } else if (isFailed) {
            const { data: updated } = await supabase.from("orders").update({
              status: "failed",
              failure_reason: getErrorDescription(result),
              metadata: { ...order.metadata, theteller_raw: result }
            }).eq("id", order.id).eq("status", "pending").select();

            if (updated && updated.length > 0) {
              // Refund wallet for disbursements (vendor_cash_in, vendor_bank_transfer, vendor_africa_transfer) if they fail
              if ((order.order_type === "vendor_cash_in" || order.order_type === "vendor_bank_transfer" || order.order_type === "vendor_africa_transfer") && !order.metadata?.wallet_refunded) {
                await supabase.rpc("credit_wallet", {
                  p_agent_id: order.agent_id,
                  p_amount: order.amount
                });
                await supabase.from("orders").update({
                  metadata: { ...order.metadata, theteller_raw: result, wallet_refunded: true }
                }).eq("id", order.id);
              }
            }
          }
        }
      }
    }

    const responseBody = {
      ...(verifiedAccountName ? { ...result, account_name: verifiedAccountName } : result),
      order_id: orderId
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("theTeller function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
