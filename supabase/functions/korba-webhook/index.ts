import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect, formatTemplate, sendPaymentSms } from "../_shared/sms.ts";
import { notifyWalletCredit, notifyApiClient } from "../_shared/webhooks.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

async function triggerPushNotification(supabaseAdmin: any, payload: { user_id: string; title: string; body: string; url?: string; icon?: string }) {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("[Push Webhook] Trigger failed in korba-webhook:", text);
    }
  } catch (e) {
    console.error("[Push Webhook] Trigger error in korba-webhook:", e);
  }
}

async function sendWalletTopupSms(supabaseAdmin: any, userId: string, amount: number) {
  try {
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle();
    const { data: wallet } = await supabaseAdmin.from("wallets").select("balance").eq("agent_id", userId).maybeSingle();
    
    if (!profile?.phone) return;

    const { apiKey, senderId, templates } = await getSmsConfig(supabaseAdmin);
    const recipient = normalizePhone(profile.phone);
    
    if (!apiKey || !recipient) return;

    const message = formatTemplate(templates.wallet_topup, {
      amount: amount.toFixed(2),
      balance: (wallet?.balance || 0).toFixed(2)
    });

    await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
  } catch (error) {
    console.error("sendWalletTopupSms error in korba-webhook:", error);
  }
}

async function verifyKorbaSignature(
  secretKey: string,
  transactionId: string,
  status: string,
  message: string,
  receivedSignature: string
): Promise<boolean> {
  const messageToSign = `${transactionId}:${status}:${message}`;
  
  const keyData = new TextEncoder().encode(secretKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const messageData = new TextEncoder().encode(messageToSign);
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
    
  return computedSignature.toLowerCase() === receivedSignature.toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify callback token if configured in database
  try {
    const { data: korbaProvider } = await supabaseAdmin
      .from("providers")
      .select("settings")
      .eq("handler_type", "korba")
      .maybeSingle();

    const expectedToken = korbaProvider?.settings?.callback_token;
    if (expectedToken) {
      const receivedToken = req.headers.get("x-callback-token") || req.headers.get("X-Callback-Token");
      if (receivedToken !== expectedToken) {
        console.error(`[korba-webhook] Forbidden callback: expected ${expectedToken}, got ${receivedToken}`);
        return json({ error: "Forbidden" }, 403);
      }
    }
  } catch (err) {
    console.error("[korba-webhook] Callback token verification error:", err);
  }

  // Parse parameters from query string or request body
  const url = new URL(req.url);
  let transactionId = url.searchParams.get("transaction_id") || "";
  let status = (url.searchParams.get("status") || "").toUpperCase();
  let message = url.searchParams.get("message") || "";
  let prepaidToken = url.searchParams.get("prepaid_token") || "";
  let signature = url.searchParams.get("signature") || "";

  if (req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await req.json();
        if (body.transaction_id) transactionId = body.transaction_id;
        if (body.status) status = String(body.status).toUpperCase();
        if (body.message) message = body.message;
        if (body.prepaid_token) prepaidToken = body.prepaid_token;
        if (body.signature) signature = body.signature;
      } else {
        const bodyText = await req.text();
        const params = new URLSearchParams(bodyText);
        if (params.get("transaction_id")) transactionId = params.get("transaction_id") || "";
        if (params.get("status")) status = (params.get("status") || "").toUpperCase();
        if (params.get("message")) message = params.get("message") || "";
        if (params.get("prepaid_token")) prepaidToken = params.get("prepaid_token") || "";
        if (params.get("signature")) signature = params.get("signature") || "";
      }
    } catch (e) {
      console.error("[korba-webhook] Error parsing POST body:", e);
    }
  }

  // Verify HMAC signature to protect from fake callbacks
  const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "";
  if (KORBA_SECRET_KEY) {
    if (!signature) {
      console.error("[korba-webhook] Unauthorized callback: Missing signature parameter.");
      return json({ error: "Unauthorized: Missing signature" }, 401);
    }
    const isSignatureValid = await verifyKorbaSignature(KORBA_SECRET_KEY, transactionId, status, message, signature);
    if (!isSignatureValid) {
      console.error(`[korba-webhook] Unauthorized callback: signature verification failed. Got signature: ${signature}`);
      return json({ error: "Unauthorized: Signature mismatch" }, 401);
    }
    console.log("[korba-webhook] Signature verified successfully.");
  } else {
    console.warn("[korba-webhook] KORBA_SECRET_KEY is not configured in env. Skipping signature verification.");
  }

  console.log(`[korba-webhook] Callback received: tx=${transactionId}, status=${status}, msg=${message}, token=${prepaidToken}`);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!transactionId || !UUID_RE.test(transactionId)) {
    console.warn(`[korba-webhook] Invalid or malformed transaction_id: ${transactionId}`);
    return json({ error: "Invalid transaction_id parameter" }, 400);
  }

  try {
    // 1. Fetch order
    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("id, order_type, agent_id, parent_agent_id, network, package_size, customer_phone, amount, status, profit, parent_profit, metadata, customer_id")
      .eq("id", transactionId)
      .maybeSingle();

    if (!existingOrder) {
      console.error(`[korba-webhook] Order ${transactionId} not found in DB`);
      return json({ error: "Order not found" }, 404);
    }

    if (existingOrder.status === "fulfilled" || existingOrder.status === "completed") {
      console.log(`[korba-webhook] Order ${transactionId} is already completed/fulfilled`);
      return json({ received: true, already_processed: true });
    }

    // Handle fulfillment success callbacks for orders already submitted for processing/failed retry
    if ((existingOrder.status === "processing" || existingOrder.status === "fulfillment_failed") && status === "SUCCESS") {
      console.log(`[korba-webhook] Fulfillment callback success for order ${transactionId}. Marking as fulfilled.`);
      const patch: any = {
        status: "fulfilled",
        failure_reason: prepaidToken ? `Token: ${prepaidToken}` : null,
        updated_at: new Date().toISOString()
      };
      if (prepaidToken) {
        patch.metadata = { ...(existingOrder.metadata || {}), prepaid_token: prepaidToken };
      }
      await supabaseAdmin.from("orders").update(patch).eq("id", transactionId);

      try {
        await supabaseAdmin.rpc("credit_order_profits", { p_order_id: transactionId });
        
        // Trigger Push Notification for Agent
        if (existingOrder.agent_id && existingOrder.agent_id !== '00000000-0000-0000-0000-000000000000') {
          const profit = Number(existingOrder.profit || 0).toFixed(2);
          await triggerPushNotification(supabaseAdmin, {
            user_id: existingOrder.agent_id,
            title: "🎉 New payment for Data selling",
            body: `You just received GHS ${profit} from your recent data sale.`,
            url: "/dashboard/orders",
            icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
          });
        }
      } catch (e) {
        console.error("[korba-webhook] Profit credit or notification failed:", e);
      }

      await notifyApiClient(supabaseAdmin, transactionId, "fulfilled");

      // Trigger SMS for Customer
      if (existingOrder.customer_phone) {
        try {
          const smsType = existingOrder.order_type === "utility" ? "utility_paid" : "payment_success";
          const smsVars = {
            phone: existingOrder.customer_phone,
            package: existingOrder.package_size || "",
            utility_type: existingOrder.network || "",
            account: existingOrder.customer_phone,
            amount: String(existingOrder.amount || 0),
            token: prepaidToken || ""
          };
          if (existingOrder.order_type === "utility" && prepaidToken) {
            const customMsg = `ECG Prepaid Token: ${prepaidToken}\nMeter: ${existingOrder.customer_phone}\nAmount: GHS ${Number(existingOrder.amount).toFixed(2)}\nThank you for using SwiftData!`;
            await sendPaymentSms(supabaseAdmin, existingOrder.customer_phone, "custom" as any, { message: customMsg }, existingOrder.agent_id);
          } else {
            await sendPaymentSms(supabaseAdmin, existingOrder.customer_phone, smsType, smsVars, existingOrder.agent_id);
          }
        } catch (smsErr) {
          console.error("[korba-webhook] Success SMS dispatch failed:", smsErr);
        }
      }

      return json({ received: true, fulfilled: true });
    }

    // Handle payment failures
    if (status !== "SUCCESS") {
      console.warn(`[korba-webhook] Transaction failed on Korba: ${message}`);
      await supabaseAdmin.from("orders").update({
        status: "fulfillment_failed",
        failure_reason: message || "Payment failed via Korba"
      }).eq("id", transactionId);

      return json({ received: true, status: "failed" });
    }

    const orderType = existingOrder.order_type || "data";
    const verifiedAmount = Number(existingOrder.amount);
    
    // Save payment method and verified amount
    await supabaseAdmin.from("orders").update({
      payment_method: "korba",
      paystack_verified_amount: verifiedAmount,
      failure_reason: null
    }).eq("id", transactionId);

    // 2. Fulfill based on order type
    if (orderType === "wallet_topup") {
      const walletType = existingOrder.metadata?.wallet_type === "api" ? "api" : "main";
      if (walletType === "api") {
        await supabaseAdmin.schema("api").rpc("credit_api_wallet", { p_user_id: existingOrder.agent_id, p_amount: verifiedAmount });
      } else {
        await supabaseAdmin.rpc("repay_credit", { p_agent_id: existingOrder.agent_id, p_amount: verifiedAmount });
      }
      
      await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", transactionId);
      
      // Notify API client and SMS
      await notifyWalletCredit(supabaseAdmin, existingOrder.agent_id, verifiedAmount, walletType);
      await sendWalletTopupSms(supabaseAdmin, existingOrder.agent_id, verifiedAmount);

      // Trigger Push Notification for Wallet Top-up
      await triggerPushNotification(supabaseAdmin, {
        user_id: existingOrder.agent_id,
        title: "💰 Wallet Top-up Successful",
        body: `You just received GHS ${verifiedAmount.toFixed(2)} in your ${walletType === 'api' ? 'API' : 'main'} wallet.`,
        url: "/dashboard",
        icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
      });

      return json({ received: true, fulfilled: true });
    }

    if (orderType === "store_wallet_topup") {
      const customerId = existingOrder.customer_id || existingOrder.metadata?.customer_id;
      const agentId = existingOrder.agent_id;
      const creditAmount = Number(existingOrder.amount);

      if (customerId && agentId && creditAmount > 0) {
        const { data: creditRes, error: creditErr } = await supabaseAdmin.rpc("fulfill_store_wallet_topup", {
          p_order_id: transactionId,
          p_customer_id: customerId,
          p_agent_id: agentId,
          p_amount: creditAmount
        });

        if (creditErr || !creditRes?.success) {
          console.error("Store topup automation failed in Korba webhook:", creditErr || creditRes?.error);
          await supabaseAdmin.from("orders").update({
            status: "fulfillment_failed",
            failure_reason: creditRes?.error || "Automatic credit failed."
          }).eq("id", transactionId);
          
          return json({ received: true, fulfilled: false, error: creditRes?.error || "Automatic credit failed" });
        }

        // Trigger Push Notification for Agent (Deposit Received)
        await triggerPushNotification(supabaseAdmin, {
          user_id: agentId,
          title: "💰 Store Customer Deposit",
          body: `Your customer has topped up GHS ${creditAmount.toFixed(2)}. Your agent wallet was credited!`,
          url: "/dashboard",
          icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
        });

        // Trigger Push Notification for Customer
        await triggerPushNotification(supabaseAdmin, {
          user_id: customerId,
          title: "💰 Store Wallet Funded",
          body: `Your store wallet has been credited with GHS ${creditAmount.toFixed(2)}. Start shopping!`,
          url: `/store/${existingOrder.metadata?.slug || 'shop'}/my-orders`,
          icon: "https://lsocdjpflecduumopijn.supabase.co/storage/v1/object/public/assets/notification-icon.png"
        });
      } else {
        console.error("[store_wallet_topup] Missing required fields in Korba webhook:", { customerId, agentId, creditAmount });
        await supabaseAdmin.from("orders").update({
          status: "fulfillment_failed",
          failure_reason: "Missing customer_id or agent_id for store wallet top-up."
        }).eq("id", transactionId);
      }

      return json({ received: true, processed: true });
    }

    if (orderType === "agent_activation") {
      const agentId = existingOrder.agent_id;
      if (agentId) {
        await supabaseAdmin.from("profiles").update({ 
          is_agent: true, 
          agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: false,
          parent_agent_id: null
        }).eq("user_id", agentId);
        
        await supabaseAdmin.from("orders").update({ status: "fulfilled", failure_reason: null }).eq("id", transactionId);
        console.log("Agent activated via Korba webhook:", agentId);
      }
      return json({ received: true, fulfilled: true });
    }

    if (orderType === "sub_agent_activation") {
      const { data: settings } = await supabaseAdmin
        .from("v_system_settings_with_secrets").select("sub_agent_base_fee")
        .eq("id", 1)
        .maybeSingle();
      const SUB_AGENT_MINIMUM = Number(settings?.sub_agent_base_fee || 5);
      
      const subAgentId = existingOrder.agent_id;
      const parentAgentId = existingOrder.metadata?.parent_agent_id;
      const activationAmount = Number(existingOrder.amount);
      const baseFee = SUB_AGENT_MINIMUM;
      const agentProfit = Math.max(0, parseFloat((activationAmount - baseFee).toFixed(2)));

      if (subAgentId) {
        const { data: parentProfile } = await supabaseAdmin
          .from("profiles")
          .select("sub_agent_prices")
          .eq("user_id", parentAgentId)
          .maybeSingle();
        const subAgentPrices = parentProfile?.sub_agent_prices || {};

        await supabaseAdmin.from("profiles").update({
          is_agent: true,
          agent_approved: true,
          sub_agent_approved: true,
          onboarding_complete: true,
          is_sub_agent: true,
          parent_agent_id: parentAgentId || null,
          agent_prices: subAgentPrices,
        }).eq("user_id", subAgentId);

        await supabaseAdmin
          .from("orders")
          .update({
            status: "fulfilled",
            failure_reason: null,
            profit: 0,
            parent_profit: agentProfit,
            parent_agent_id: parentAgentId || null,
          })
          .eq("id", transactionId);

        if (parentAgentId && agentProfit > 0) {
          await supabaseAdmin.rpc("credit_order_profits", { p_order_id: transactionId });
        }
        console.log("Sub agent activated via Korba webhook:", subAgentId, "parent:", parentAgentId);
      }
      return json({ received: true, fulfilled: true });
    }

    // For standard orders: data, airtime, utility, afa
    // Mark the order as paid in the database
    await supabaseAdmin
      .from("orders")
      .update({
        status: "paid"
      })
      .eq("id", transactionId);

    // Send SMS alert that payment was successful (similar to paystack-webhook)
    if (existingOrder.customer_phone) {
      await sendPaymentSms(supabaseAdmin, existingOrder.customer_phone, "payment_success", {}, existingOrder.agent_id);
    }

    // Call verify-payment Edge Function synchronously to perform immediate delivery
    console.log(`[korba-webhook] Triggering verify-payment synchronously for order: ${transactionId}`);
    const verifyUrl = `${SUPABASE_URL}/functions/v1/verify-payment`;
    const verifyRes = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ reference: transactionId }),
    });

    const verifyData = await verifyRes.json();
    console.log(`[korba-webhook] verify-payment response:`, verifyData);

    return json({ received: true, fulfilled: verifyData?.status === "fulfilled" });

  } catch (error) {
    console.error("[korba-webhook] Error processing webhook:", error);
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
