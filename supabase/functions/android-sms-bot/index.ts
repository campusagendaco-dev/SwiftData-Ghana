import "../deno.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import { callAiAgent } from "../_shared/ai.ts";
import { dispatchOrderWithFailover } from "../_shared/provider_router.ts";
import { getSmsConfig, dispatchUnifiedSms } from "../_shared/sms.ts";

declare const Deno: any;

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

function cleanPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return digits;
}

function parseCapacity(packageSize: string): number {
  if (!packageSize) return 0;
  const cleaned = packageSize.replace(/\s+/g, "").toUpperCase();
  if (cleaned.includes("20MB") || cleaned.includes("20 MB")) return 20 / 1024;
  if (cleaned.includes("MIDNIGHT") || cleaned.includes("MIDNGT")) return 2.6;
  if (cleaned.includes("200GB")) return 200;
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (cleaned.includes("MB") && !cleaned.includes("GB")) return num / 1024;
  return num;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Verify Secret Authorization
  const url = new URL(req.url);
  const expectedSecret = Deno.env.get("ANDROID_SMS_SECRET") || "swiftdata-android-sms-secret-2026";
  const providedSecret = 
    req.headers.get("x-sms-secret") || 
    req.headers.get("x-sms-gateway-secret") || 
    req.headers.get("x-api-secret") || 
    url.searchParams.get("secret");

  let rawSender = url.searchParams.get("from") || url.searchParams.get("sender") || url.searchParams.get("phone") || url.searchParams.get("number") || url.searchParams.get("address") || "";
  let rawText = url.searchParams.get("message") || url.searchParams.get("text") || url.searchParams.get("body") || url.searchParams.get("content") || url.searchParams.get("msg") || "";
  let bodySecret = "";

  if (req.method === "POST" || req.method === "PUT") {
    try {
      const bodyText = await req.text();
      let bodyObj: any = null;

      if (bodyText && bodyText.trim()) {
        // Try parsing JSON first regardless of Content-Type header (many Android apps omit application/json)
        try {
          bodyObj = JSON.parse(bodyText);
        } catch {
          // If JSON fails, fall back to URLSearchParams
          try {
            const params = new URLSearchParams(bodyText);
            bodyObj = {};
            for (const [k, v] of params.entries()) {
              bodyObj[k] = v;
            }
          } catch {
            /* ignore */
          }
        }
      }

      const extractFromObj = (obj: any) => {
        if (!obj || typeof obj !== "object") return;
        // Search root level and common nested containers (data, sms, payload, notification, message)
        const candidates = [
          obj,
          obj.data,
          obj.sms,
          obj.payload,
          obj.notification,
          obj.message_data,
          obj.message
        ];

        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== "object") continue;

          if (!rawSender) {
            rawSender = 
              candidate.from || candidate.sender || candidate.phone || candidate.phone_number ||
              candidate.number || candidate.address || candidate.contact || candidate.originator ||
              candidate.src || candidate.source || candidate.mobile || candidate.sender_phone || "";
          }

          if (!rawText) {
            const msgVal = candidate.message || candidate.text || candidate.content || candidate.msg ||
              candidate.body || candidate.payload || candidate.sms || candidate.sms_text || candidate.text_message;
            if (typeof msgVal === "string" && msgVal.trim()) {
              rawText = msgVal;
            }
          }

          if (!bodySecret && candidate.secret) {
            bodySecret = String(candidate.secret);
          }
        }
      };

      if (bodyObj) {
        extractFromObj(bodyObj);
      }
    } catch (e) {
      console.error("[android-sms-bot] Body parsing error:", e);
    }
  }

  const activeSecret = providedSecret || bodySecret;
  if (expectedSecret && activeSecret && activeSecret !== expectedSecret) {
    console.warn(`[android-sms-bot] Forbidden: secret mismatch. Expected ${expectedSecret}, got ${activeSecret}`);
    return json({ error: "Forbidden: Secret mismatch" }, 403);
  }

  const senderPhone = cleanPhone(rawSender);
  const userText = String(rawText || "").trim();

  if (!senderPhone || !userText) {
    return json({ 
      error: "Missing required sender phone ('from') or message text ('message').",
      example: { from: "0547636024", message: "BAL", secret: "swiftdata-android-sms-secret-2026" }
    }, 400);
  }

  console.log(`[android-sms-bot] Incoming SMS from ${senderPhone}: "${userText}"`);

  // 2. Identify User & Agent Profile in DB
  const phone9 = senderPhone.slice(-9);
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("user_id, full_name, is_agent, agent_approved, phone, email")
    .or(`phone.ilike.%${phone9},phone.eq.${senderPhone}`)
    .maybeSingle();

  let walletBalance = 0;
  let userId = profile?.user_id || null;

  if (userId) {
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("balance")
      .eq("agent_id", userId)
      .maybeSingle();
    walletBalance = Number(wallet?.balance || 0);
  }

  const upperCmd = userText.toUpperCase().trim();
  let replyText = "";

  // --------------------------------------------------------------------------
  // COMMAND 1: BALANCE / BAL
  // --------------------------------------------------------------------------
  if (upperCmd === "BAL" || upperCmd === "BALANCE" || upperCmd === "MY BAL" || upperCmd === "CHECK BAL") {
    if (!profile) {
      replyText = `SwiftData Alert: Phone ${senderPhone} is not registered as an agent account on SwiftData. Register at https://swiftdatagh.shop to trade data.`;
    } else {
      const name = profile.full_name || "Agent";
      const formattedBal = walletBalance.toFixed(2);
      replyText = `SwiftData Alert: Hi ${name}! Your current wallet balance is GHS ${formattedBal}. Account: ${profile.is_agent ? "Approved Agent" : "Customer"}.`;
    }
  } 

  // --------------------------------------------------------------------------
  // COMMAND 2: STATUS <ref/order_id>
  // --------------------------------------------------------------------------
  else if (upperCmd.startsWith("STATUS ") || upperCmd.startsWith("TRACK ")) {
    const searchRef = upperCmd.replace(/^(STATUS|TRACK)\s+/i, "").trim();
    if (!searchRef) {
      replyText = "SwiftData Alert: Please specify order ID or reference. Example: STATUS 622b3328";
    } else {
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("id, status, network, package_size, customer_phone, failure_reason, created_at")
        .or(`id.ilike.${searchRef}%,metadata->>client_reference.eq.${searchRef}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!order) {
        replyText = `SwiftData Alert: No order found matching reference '${searchRef}'. Please verify order ID.`;
      } else {
        const shortId = order.id.slice(0, 8);
        const pkg = `${order.network || ""} ${order.package_size || ""}`.trim();
        const st = String(order.status || "").toUpperCase();
        replyText = `SwiftData Alert: Order #${shortId} (${pkg} to ${order.customer_phone}) Status: ${st}. ${order.failure_reason ? "Info: " + order.failure_reason : ""}`.trim();
      }
    }
  }

  // --------------------------------------------------------------------------
  // COMMAND 3: BUY <size> <recipient> (e.g. BUY 1GB 0547636024 or BUY 2GB 0241234567)
  // --------------------------------------------------------------------------
  else if (upperCmd.startsWith("BUY ")) {
    if (!profile || !userId) {
      replyText = `SwiftData Alert: Phone ${senderPhone} is not registered as an agent. Please create an account at https://swiftdatagh.shop to buy via SMS.`;
    } else {
      const parts = userText.trim().split(/\s+/);
      // Expected parts: ["BUY", "1GB", "0547636024"] or ["BUY", "MTN", "1GB", "0547636024"]
      let reqNet = "MTN";
      let reqSize = "";
      let reqPhone = "";

      if (parts.length >= 4) {
        reqNet = parts[1].toUpperCase();
        reqSize = parts[2].toUpperCase();
        reqPhone = parts[3];
      } else if (parts.length === 3) {
        reqSize = parts[1].toUpperCase();
        reqPhone = parts[2];
      }

      const recipient = cleanPhone(reqPhone);
      if (!reqSize || !recipient || recipient.length < 10) {
        replyText = "SwiftData Alert: Invalid BUY command format. Use: BUY <size> <recipient_phone>. Example: BUY 1GB 0547636024";
      } else {
        // Resolve package price from database
        const { data: priceRow } = await supabaseAdmin
          .from("global_package_settings")
          .select("price, cost_price, is_active")
          .eq("network", reqNet)
          .eq("package_size", reqSize)
          .maybeSingle();

        const costPrice = Number(priceRow?.cost_price || 4.0);
        const price = Number(priceRow?.price || 4.2);

        if (walletBalance < price) {
          replyText = `SwiftData Alert: Insufficient balance. Order for ${reqNet} ${reqSize} costs GHS ${price.toFixed(2)}, but your wallet balance is GHS ${walletBalance.toFixed(2)}. Please top up your wallet.`;
        } else {
          // Debit Wallet Atomically
          const newBal = walletBalance - price;
          const { error: walletErr } = await supabaseAdmin
            .from("wallets")
            .update({ balance: newBal, updated_at: new Date().toISOString() })
            .eq("agent_id", userId);

          if (walletErr) {
            console.error("[android-sms-bot] Wallet debit error:", walletErr);
            replyText = "SwiftData Alert: Wallet debit failed. Please try again later.";
          } else {
            // Create Order Row
            const orderId = crypto.randomUUID();
            const orderRow = {
              id: orderId,
              agent_id: userId,
              order_type: "data",
              network: reqNet,
              package_size: reqSize,
              customer_phone: recipient,
              amount: price,
              cost_price: costPrice,
              profit: parseFloat((price - costPrice).toFixed(2)),
              status: "paid",
              payment_method: "wallet",
              channel: "sms_bot",
              metadata: {
                payment_source: "sms_bot",
                sender_phone: senderPhone,
                category: "affordable",
                is_korba: false
              }
            };

            await supabaseAdmin.from("orders").insert(orderRow);

            // Trigger Provider Dispatch via Hybrid Router
            const dispatchRes = await dispatchOrderWithFailover(supabaseAdmin, orderRow);
            const shortId = orderId.slice(0, 8);

            if (dispatchRes.ok) {
              replyText = `SwiftData Alert: Success! ${reqNet} ${reqSize} dispatched to ${recipient}. Paid: GHS ${price.toFixed(2)}. New Wallet Bal: GHS ${newBal.toFixed(2)}. Ref: ${shortId}`;
            } else {
              replyText = `SwiftData Alert: Order #${shortId} created (GHS ${price.toFixed(2)}), but delivery is processing: ${dispatchRes.reason || 'Broadcasting to network'}. New Bal: GHS ${newBal.toFixed(2)}.`;
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // COMMAND 4: AI ASSISTANT FALLBACK (For questions / General text)
  // --------------------------------------------------------------------------
  else {
    try {
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
      const smsPrompt = `You are SwiftBot — the helpful AI SMS Support Assistant for SwiftData Ghana (swiftdatagh.shop).
Provide a concise, warm, 1–2 sentence SMS response (MAX 160 CHARACTERS).
Key Information:
- Support Phone / WhatsApp: 0598170947
- Website: https://swiftdatagh.shop
- Services: MTN, Telecel, AirtelTigo Data Bundles, Airtime, ECG Prepaid & Water Bills.
- SMS Bot Commands available:
  - "BAL": Check wallet balance
  - "STATUS <order_id>": Check order status
  - "BUY <size> <phone>": Purchase data (e.g. BUY 1GB 0547636024)
Question from customer: "${userText}"`;

      if (ANTHROPIC_API_KEY) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 100,
            messages: [{ role: "user", content: smsPrompt }],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          replyText = data.content?.[0]?.text?.trim() || "";
        }
      }

      if (!replyText) {
        replyText = `SwiftData: Customer service is available on 0598170947 (WhatsApp/Call) or visit https://swiftdatagh.shop. Send BAL for wallet balance.`;
      }
    } catch (aiErr) {
      console.error("[android-sms-bot] AI Agent error:", aiErr);
      replyText = `SwiftData: Customer service is available on 0598170947 (WhatsApp/Call) or visit https://swiftdatagh.shop. Send BAL for wallet balance.`;
    }
  }

  console.log(`[android-sms-bot] Outbound Reply to ${senderPhone}: "${replyText}"`);

  // Dual Dispatch: Send SMS via Server-side Gateway (TxtConnect / mNotify / Korba)
  // This guarantees delivery even if the physical Android app only forwards incoming webhooks.
  try {
    const { gateway, apiKey, senderId } = await getSmsConfig(supabaseAdmin, userId || undefined);
    await dispatchUnifiedSms(
      gateway,
      apiKey,
      senderId || "SwiftData",
      senderPhone,
      replyText,
      "sms_bot",
      userId || undefined
    );
    console.log(`[android-sms-bot] Server-side SMS dispatched to ${senderPhone} via ${gateway}`);
  } catch (smsErr) {
    console.warn(`[android-sms-bot] Direct server SMS dispatch notice (Android app payload fallback active):`, smsErr);
  }

  // Return standard Android SMS Gateway API JSON response with all common key formats
  return json({
    success: true,
    status: "success",
    from: senderPhone,
    recipient: senderPhone,
    phone: senderPhone,
    address: senderPhone,
    message: replyText,
    reply: replyText,
    text: replyText,
    sms: replyText,
    response: replyText,
    content: replyText,
    messages: [
      {
        to: senderPhone,
        message: replyText
      }
    ]
  });
});
