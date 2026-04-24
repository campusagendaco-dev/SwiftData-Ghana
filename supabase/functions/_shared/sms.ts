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
  if (!apiKey || !to) return;

  const endpoint = "https://api.txtconnect.net/v1/send";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        API_key: apiKey,
        TO: to,
        FROM: from,
        SMS: body,
        RESPONSE: "json",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TxtConnect HTTP Error (${response.status}): ${text}`);
    }
    
    const data = await response.json();
    if (data && data.status !== "ok" && data.error) {
       throw new Error(`TxtConnect API Error: ${data.error}`);
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
