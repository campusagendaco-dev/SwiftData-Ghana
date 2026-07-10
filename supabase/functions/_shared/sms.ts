import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { fetchViaDb } from "./db_proxy.ts";

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/[^\d+]/g, "");
  if (!clean) return null;

  const digits = clean.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("233") && digits.length >= 12) {
    return digits;
  }

  if (digits.startsWith("0") && digits.length >= 10) {
    return `233${digits.slice(1)}`;
  }

  if (digits.startsWith("00") && digits.length > 2) {
    return digits.slice(2);
  }

  return digits.length >= 10 ? digits : null;
}

export async function getSmsConfig(supabaseAdmin: any, agentId?: string) {
  const { data: settings } = await supabaseAdmin
    .from("system_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const korbaClientKey = Deno.env.get("KORBA_CLIENT_KEY");
  const korbaSecretKey = Deno.env.get("KORBA_SECRET_KEY");
  const hasKorba = !!(korbaClientKey && korbaSecretKey);

  const defaultSenderId = settings?.txtconnect_sender_id || Deno.env.get("TXTCONNECT_SENDER_ID") || "Orderinfo";
  let finalSenderId = defaultSenderId;

  if (agentId) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("sms_sender_id, sms_sender_status")
      .eq("user_id", agentId)
      .maybeSingle();
      
    if (profile && profile.sms_sender_status === 'approved' && profile.sms_sender_id) {
      // Attempt to charge an SMS credit
      const { data: charged } = await supabaseAdmin.rpc("charge_sms_credit", { p_user_id: agentId });
      if (charged) {
        finalSenderId = profile.sms_sender_id;
      } else {
        console.log(`[SMS] Agent ${agentId} has no SMS credits. Falling back to default Sender ID.`);
      }
    }
  }

  return {
    apiKey: settings?.txtconnect_api_key || Deno.env.get("TXTCONNECT_API_KEY") || (hasKorba ? "korba" : null),
    senderId: finalSenderId,
    templates: {
      payment_success: settings?.payment_success_sms_message || "Success! Your order for {phone} has been processed.",
      utility_paid: settings?.utility_paid_sms_message || "Payment received! Your {utility_type} bill for {account} is being processed.",
      wallet_topup: settings?.wallet_topup_sms_message || "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.",
      withdrawal_request: settings?.withdrawal_request_sms_message || "Withdrawal request of GHS {amount} received. It will be processed shortly.",
      withdrawal_completed: settings?.withdrawal_completed_sms_message || "Your withdrawal of GHS {amount} has been completed.",
      order_failed: settings?.order_failed_sms_message || "Order for {package} to {phone} failed.{reason} GHS {amount} has been refunded to your wallet. No panic, your refund is completed.",
      manual_credit: settings?.manual_credit_sms_message || "Your account has been manually credited with GHS {amount}.",
    }
  };
}

async function logSmsToDb(
  recipient: string,
  senderId: string,
  body: string,
  type: string,
  status: "success" | "failed",
  errorMessage?: string,
  agentId?: string
) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  
  if (!url || !key) {
    console.warn("[SMS Log] Supabase credentials missing from environment. Skipping DB log.");
    return;
  }

  try {
    const supabase = createClient(url, key);
    const { error } = await supabase.from("sms_logs").insert({
      recipient,
      sender_id: senderId,
      body,
      type,
      status,
      error_message: errorMessage || null,
      agent_id: agentId || null
    });
    if (error) console.error("[SMS Log] Failed to insert log row:", error.message);
  } catch (err: any) {
    console.error("[SMS Log] Exception during database insertion:", err.message);
  }
}

export async function sendSmsViaKorba(
  clientId: string,
  clientKey: string,
  secretKey: string,
  to: string,
  body: string,
  type = "broadcast",
  agentId?: string
) {
  if (!clientId || !clientKey || !secretKey || !to) return;

  const endpoint = "https://xchange.korba365.com/api/v1.0/send_sms/";

  // Ensure to starts with country code (e.g. +233...)
  let formattedPhone = to;
  if (!formattedPhone.startsWith("+")) {
    if (formattedPhone.startsWith("233")) {
      formattedPhone = "+" + formattedPhone;
    } else if (formattedPhone.startsWith("0")) {
      formattedPhone = "+233" + formattedPhone.slice(1);
    } else {
      formattedPhone = "+233" + formattedPhone;
    }
  }

  const payload = {
    client_id: clientId,
    phone_number: formattedPhone,
    sms_message: body,
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    // Generate Signature
    const sortedKeys = Object.keys(payload).sort();
    const messageParts = [];
    for (const key of sortedKeys) {
      if (payload[key] !== undefined) {
        messageParts.push(`${key}=${payload[key]}`);
      }
    }
    const message = messageParts.join("&");

    const keyData = new TextEncoder().encode(secretKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const messageData = new TextEncoder().encode(message);
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const signatureHex = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const response = await fetchViaDb(supabaseAdmin, endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `HMAC ${clientKey}:${signatureHex}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`Korba SMS returned non-JSON: ${responseText.substring(0, 200)}`);
    }

    if (!response.ok || data.response_code !== "00") {
      throw new Error(`Korba SMS Error: ${data.message || "Failed to send SMS"}`);
    }

    await logSmsToDb(to, "KorbaSMS", body, type, "success", undefined, agentId).catch(console.error);
    return data;
  } catch (error: any) {
    console.error(`Failed to send SMS via Korba to ${to}:`, error);
    await logSmsToDb(to, "KorbaSMS", body, type, "failed", error instanceof Error ? error.message : String(error), agentId).catch(console.error);
    throw error;
  }
}

export async function sendSmsViaTxtConnect(
  apiKey: string,
  from: string,
  to: string,
  body: string,
  type = "broadcast",
  agentId?: string
) {
  if (!apiKey || !to) return;

  if (apiKey === "korba") {
    const korbaClientId = Deno.env.get("KORBA_CLIENT_ID") || "2419";
    const korbaClientKey = Deno.env.get("KORBA_CLIENT_KEY") || "";
    const korbaSecretKey = Deno.env.get("KORBA_SECRET_KEY") || "";
    return await sendSmsViaKorba(korbaClientId, korbaClientKey, korbaSecretKey, to, body, type, agentId);
  }

  const effectiveKey = apiKey;

  const endpoint = "https://api.txtconnect.net/dev/api/sms/send";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${effectiveKey}`,
      },
      body: JSON.stringify({
        to: to,
        from: from,
        sms: body,
        unicode: "0", // 0 for regular, 1 for unicode
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`TxtConnect Error (${response.status}): ${JSON.stringify(data)}`);
    }
    
    // TxtConnect dev API returns msg/messageId
    if (data && data.msg !== "Sms send Successful" && !data.messageId) {
       throw new Error(`TxtConnect API failure: ${data.msg || "Unknown error"}`);
    }
    
    // Log success
    await logSmsToDb(to, from, body, type, "success", undefined, agentId).catch(console.error);
    
    return data;
  } catch (error: any) {
    console.error(`Failed to send SMS to ${to}:`, error);
    
    // Log failure
    await logSmsToDb(to, from, body, type, "failed", error instanceof Error ? error.message : String(error), agentId).catch(console.error);
    
    throw error;
  }
}

// Sends one message to multiple recipients in a single API call (max 100 per batch)
export async function sendBulkSmsViaTxtConnect(
  apiKey: string,
  from: string,
  recipients: string[],
  body: string,
  type = "broadcast",
  agentId?: string
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  if (apiKey === "korba") {
    const korbaClientId = Deno.env.get("KORBA_CLIENT_ID") || "2419";
    const korbaClientKey = Deno.env.get("KORBA_CLIENT_KEY") || "";
    const korbaSecretKey = Deno.env.get("KORBA_SECRET_KEY") || "";
    let sent = 0;
    const failures: Array<{ phone: string; reason: string }> = [];
    for (const r of recipients) {
      try {
        await sendSmsViaKorba(korbaClientId, korbaClientKey, korbaSecretKey, r, body, type, agentId);
        sent++;
      } catch (err: any) {
        failures.push({ phone: r, reason: err.message || "Failed" });
      }
    }
    return { sent, failures };
  }

  const effectiveKey = apiKey;
  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];

  const BATCH_SIZE = 100;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    try {
      const endpoint = "https://api.txtconnect.net/dev/api/sms/send";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({
          to: chunk.join(","), // TxtConnect accepts comma-separated string of phone numbers
          from: from,
          sms: body,
          unicode: "0",
        }),
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`TxtConnect returned non-JSON: ${responseText.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(`TxtConnect Error (${response.status}): ${JSON.stringify(data)}`);
      }
      
      if (data && data.msg !== "Sms send Successful" && !data.messageId) {
         throw new Error(`TxtConnect API failure: ${data.msg || "Unknown error"}`);
      }

      sent += chunk.length;
      
      // Log success for each recipient in database
      for (const phone of chunk) {
        await logSmsToDb(phone, from, body, type, "success", undefined, agentId).catch(console.error);
      }
    } catch (err: any) {
      const errMessage = err?.message || "Failed";
      console.error(`Failed to send bulk SMS batch to chunk starting with ${chunk[0]}:`, err);
      for (const phone of chunk) {
        failures.push({ phone, reason: errMessage });
        await logSmsToDb(phone, from, body, type, "failed", errMessage, agentId).catch(console.error);
      }
    }

    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay between batches to respect rate limits
    }
  }

  return { sent, failures };
}

export function formatTemplate(template: string, vars: Record<string, string | number>) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{${key}}`, 'g'), String(value));
  }
  return result;
}

export async function sendPaymentSms(
  supabaseAdmin: any,
  customerPhone: string,
  type: "payment_success" | "order_failed" | "wallet_topup" | "withdrawal_request" | "withdrawal_completed" | "manual_credit" | "utility_paid" | "custom" = "payment_success",
  vars: Record<string, string | number> = {},
  agentId?: string
) {
  try {
    const { apiKey, senderId, templates } = await getSmsConfig(supabaseAdmin, agentId);
    const recipient = normalizePhone(customerPhone);
    
    if (!apiKey || !recipient) {
      console.warn(`[SMS] Missing config or recipient: to=${customerPhone}, hasApiKey=${!!apiKey}`);
      return;
    }

    const message = type === "custom" && vars.message
      ? String(vars.message)
      : formatTemplate(templates[type as any] || templates.payment_success, vars);

    const activeSenderId = vars.senderId ? String(vars.senderId) : senderId;
    console.log(`[SMS] Sending ${type} to ${recipient} (Sender: ${activeSenderId})...`);
    
    try {
      return await sendSmsViaTxtConnect(apiKey, activeSenderId, recipient, message, type, agentId);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const defaultSenderId = Deno.env.get("TXTCONNECT_SENDER_ID") || "Orderinfo";
      
      if (activeSenderId !== defaultSenderId) {
        console.warn(`[SMS Fallback] Custom Sender ID "${activeSenderId}" failed (${errorMsg}). Retrying with default: "${defaultSenderId}"...`);
        if (agentId) {
          await supabaseAdmin.rpc("refund_sms_credit", { p_user_id: agentId }).catch(console.error);
        }
        return await sendSmsViaTxtConnect(apiKey, defaultSenderId, recipient, message, type, agentId);
      }
      
      throw error;
    }
  } catch (error) {
    console.error(`[SMS] Failed to send ${type} SMS to ${customerPhone}:`, error);
  }
}
