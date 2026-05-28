import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

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

  const defaultSenderId = settings?.txtconnect_sender_id || Deno.env.get("TXTCONNECT_SENDER_ID") || "SwiftDataGh";
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
    apiKey: settings?.txtconnect_api_key || Deno.env.get("TXTCONNECT_API_KEY"),
    senderId: finalSenderId,
    templates: {
      payment_success: settings?.payment_success_sms_message || "Success! Your order for {phone} has been processed. Join for more giveaways & updates: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
      utility_paid: settings?.utility_paid_sms_message || "Payment received! Your {utility_type} bill for {account} is being processed. Join: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
      wallet_topup: settings?.wallet_topup_sms_message || "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}. Join: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
      withdrawal_request: settings?.withdrawal_request_sms_message || "Withdrawal request of GHS {amount} received. It will be processed shortly.",
      withdrawal_completed: settings?.withdrawal_completed_sms_message || "Your withdrawal of GHS {amount} has been completed. Join: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
      order_failed: settings?.order_failed_sms_message || "Order for {package} to {phone} failed. GHS {amount} has been refunded to your wallet.",
      manual_credit: settings?.manual_credit_sms_message || "Your account has been manually credited with GHS {amount}. Join: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
    }
  };
}

export async function sendSmsViaTxtConnect(
  apiKey: string,
  from: string,
  to: string,
  body: string,
) {
  if (!apiKey || !to) return;
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
    return data;
  } catch (error) {
    console.error(`Failed to send SMS to ${to}:`, error);
    throw error;
  }
}

// Sends one message to multiple recipients in a single API call (max 100 per batch)
export async function sendBulkSmsViaTxtConnect(
  apiKey: string,
  from: string,
  recipients: string[],
  body: string,
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  const effectiveKey = apiKey;
  const endpoint = "https://api.txtconnect.net/dev/api/sms/send";
  const BULK_BATCH = 100;
  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];

  for (let i = 0; i < recipients.length; i += BULK_BATCH) {
    const batch = recipients.slice(i, i + BULK_BATCH);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({
          to: batch,
          from,
          sms: body,
          unicode: "0",
        }),
      });
      if (!response.ok) {
        for (const p of batch) failures.push({ phone: p, reason: `HTTP ${response.status}` });
      } else {
        sent += batch.length;
      }
    } catch (err: any) {
      for (const p of batch) failures.push({ phone: p, reason: err?.message || "Network error" });
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
  type: "payment_success" | "order_failed" | "wallet_topup" | "withdrawal_request" | "withdrawal_completed" | "manual_credit" | "utility_paid" = "payment_success",
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

    const template = templates[type] || templates.payment_success;
    const message = formatTemplate(template, vars);

    console.log(`[SMS] Sending ${type} to ${recipient}...`);
    return await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
  } catch (error) {
    console.error(`[SMS] Failed to send ${type} SMS to ${customerPhone}:`, error);
  }
}
