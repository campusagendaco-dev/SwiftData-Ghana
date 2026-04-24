import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

export async function getSmsConfig(supabaseAdmin: any) {
  const { data: settings } = await supabaseAdmin
    .from("system_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  return {
    apiKey: settings?.txtconnect_api_key || Deno.env.get("TXTCONNECT_API_KEY"),
    senderId: settings?.txtconnect_sender_id || Deno.env.get("TXTCONNECT_SENDER_ID") || "SwiftDataGh",
    templates: {
      payment_success: settings?.payment_success_sms_message || "Your data bundle is being processed. Thanks for choosing SwiftData GH",
      wallet_topup: settings?.wallet_topup_sms_message || "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.",
      withdrawal_request: settings?.withdrawal_request_sms_message || "Withdrawal request of GHS {amount} received. It will be processed shortly.",
      withdrawal_completed: settings?.withdrawal_completed_sms_message || "Your withdrawal of GHS {amount} has been completed. Thanks for using SwiftData.",
      order_failed: settings?.order_failed_sms_message || "Order for {package} to {phone} failed. GHS {amount} has been refunded to your wallet.",
      manual_credit: settings?.manual_credit_sms_message || "Your account has been manually credited with GHS {amount} by admin.",
    }
  };
}

export async function sendSmsViaTxtConnect(
  apiKey: string,
  from: string,
  to: string,
  body: string,
) {
  const effectiveKey = apiKey || "T5Ca1X9vjBnVexWoyLrfcpQSYdR02NhU46wm7IsE8gMZJOGqlF";
  if (!effectiveKey || !to) return;

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
    return data;
  } catch (error) {
    console.error(`Failed to send SMS to ${to}:`, error);
    throw error;
  }
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
  type: "payment_success" | "order_failed" | "wallet_topup" | "withdrawal_request" | "withdrawal_completed" | "manual_credit" = "payment_success",
  vars: Record<string, string | number> = {}
) {
  try {
    const { apiKey, senderId, templates } = await getSmsConfig(supabaseAdmin);
    const recipient = normalizePhone(customerPhone);
    
    if (!apiKey || !recipient) {
      console.warn(`[SMS] Missing config or recipient: to=${customerPhone}, hasApiKey=${!!apiKey}`);
      return;
    }

    const template = templates[type] || templates.payment_success;
    const message = formatTemplate(template, vars);

    console.log(`[SMS] Sending ${type} to ${recipient}...`);
    return await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
  } catch (error) {
    console.error(`[SMS] Failed to send ${type} SMS to ${customerPhone}:`, error);
  }
}
