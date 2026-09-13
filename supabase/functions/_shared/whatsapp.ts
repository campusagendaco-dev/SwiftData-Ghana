declare const Deno: any;

/**
 * Normalizes a WhatsApp phone number into standard international format (+233...)
 */
export function formatWhatsAppRecipient(to: string): string {
  let clean = to.replace(/\s+/g, "").replace(/-/g, "").replace(/^whatsapp:/i, "");
  if (clean.startsWith("0") && clean.length === 10) {
    clean = "+233" + clean.slice(1);
  } else if (clean.startsWith("233") && !clean.startsWith("+")) {
    clean = "+" + clean;
  } else if (!clean.startsWith("+")) {
    clean = "+" + clean;
  }
  return clean;
}

/**
 * Send a WhatsApp message via Twilio API.
 * Uses official Twilio WhatsApp API:
 * POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 *
 * @param to - Recipient phone number (local 0... or international +233...)
 * @param text - Message text
 * @param config - Optional explicit Twilio config overrides
 */
export async function sendTwilioWhatsAppMessage(
  to: string,
  text: string,
  config?: { accountSid?: string; authToken?: string; apiKeySid?: string; apiSecret?: string; fromNumber?: string }
): Promise<boolean> {
  const accountSid = config?.accountSid || Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  const authToken = config?.authToken || Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  const apiKeySid = config?.apiKeySid || Deno.env.get("TWILIO_API_KEY_SID") || Deno.env.get("TWILIO_API_KEY") || "";
  const apiSecret = config?.apiSecret || Deno.env.get("TWILIO_API_KEY_SECRET") || Deno.env.get("TWILIO_API_SECRET") || "";
  const rawFrom = config?.fromNumber || Deno.env.get("TWILIO_WHATSAPP_NUMBER") || Deno.env.get("TWILIO_FROM_NUMBER") || "";

  if (!accountSid || (!authToken && (!apiKeySid || !apiSecret)) || !rawFrom) {
    return false;
  }

  const cleanRecipient = formatWhatsAppRecipient(to);
  const formattedTo = `whatsapp:${cleanRecipient}`;

  let cleanFrom = rawFrom.replace(/\s+/g, "").replace(/-/g, "").replace(/^whatsapp:/i, "");
  if (!cleanFrom.startsWith("+")) {
    cleanFrom = "+" + cleanFrom;
  }
  const formattedFrom = `whatsapp:${cleanFrom}`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const authUser = apiKeySid || accountSid;
    const authPass = apiSecret || authToken;
    const basicAuth = btoa(`${authUser}:${authPass}`);

    const params = new URLSearchParams();
    params.set("From", formattedFrom);
    params.set("To", formattedTo);
    params.set("Body", text);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log(`[Twilio WhatsApp] Successfully sent to ${formattedTo} (SID: ${data.sid || "ok"})`);
      return true;
    }

    const errBody = await res.text();
    console.error(`[Twilio WhatsApp] Send failed (${res.status}):`, errBody);
    return false;
  } catch (err: any) {
    console.error("[Twilio WhatsApp] Network/fetch error:", err?.message || err);
    return false;
  }
}

/**
 * Send a WhatsApp message via WaSender API.
 *
 * @param to - Recipient phone number
 * @param text - Message text
 * @param apiKey - Optional per-agent API key. Falls back to WHATSAPP_API_KEY secret.
 */
export async function sendWaSenderMessage(to: string, text: string, apiKey?: string): Promise<boolean> {
  const WHATSAPP_API_URL = Deno.env.get("WHATSAPP_API_URL") || "https://www.wasenderapi.com/api/send-message";
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";

  if (!resolvedKey) {
    console.warn("[WaSender] No API key available. Message not sent:", text.slice(0, 80));
    return false;
  }

  const formattedTo = formatWhatsAppRecipient(to);

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await fetch(WHATSAPP_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resolvedKey}`,
        },
        body: JSON.stringify({ to: formattedTo, text }),
      });

      if (res.ok) {
        console.log("[WaSender] Sent to", formattedTo);
        return true;
      }

      const errBody = await res.text();
      console.error(`[WaSender] Send failed (attempt ${attempts}/${maxAttempts}):`, res.status, errBody);

      if (res.status === 429 && attempts < maxAttempts) {
        let retryAfter = 3;
        try {
          const parsedErr = JSON.parse(errBody);
          if (typeof parsedErr.retry_after === "number") {
            retryAfter = parsedErr.retry_after;
          }
        } catch { /* ignore */ }

        console.log(`[WaSender] Rate limited (429). Retrying after ${retryAfter} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      break;
    } catch (error) {
      console.error(`[WaSender] Error on attempt ${attempts}:`, error);
      if (attempts >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return false;
}

/**
 * Unified WhatsApp Dispatcher.
 * Prioritizes Twilio WhatsApp API first (checking Deno.env secrets, then system_settings table).
 * Falls back to WaSender API if Twilio is unconfigured or encounters an error.
 *
 * @param to - Recipient phone number
 * @param text - Message body
 * @param apiKey - Optional WaSender API key override
 */
export async function sendWhatsAppMessage(to: string, text: string, apiKey?: string) {
  // 1. Primary: Twilio WhatsApp API
  let twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  let twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  let twilioFrom = Deno.env.get("TWILIO_WHATSAPP_NUMBER") || Deno.env.get("TWILIO_FROM_NUMBER");

  // Fallback to database system_settings if environment variables are not set
  if (!twilioSid || !twilioToken || !twilioFrom) {
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: settings } = await supabase
          .from("system_settings")
          .select("twilio_account_sid, twilio_auth_token, twilio_from_number")
          .eq("id", 1)
          .maybeSingle();

        if (settings) {
          twilioSid = twilioSid || settings.twilio_account_sid;
          twilioToken = twilioToken || settings.twilio_auth_token;
          twilioFrom = twilioFrom || settings.twilio_from_number;
        }
      }
    } catch (dbErr) {
      console.warn("[WhatsApp] Could not resolve Twilio config from system_settings:", dbErr);
    }
  }

  if (twilioSid && twilioToken && twilioFrom) {
    const twilioSuccess = await sendTwilioWhatsAppMessage(to, text, {
      accountSid: twilioSid,
      authToken: twilioToken,
      fromNumber: twilioFrom,
    });
    if (twilioSuccess) return;
    console.warn("[WhatsApp] Twilio dispatch unsuccessful; attempting fallback to WaSender API...");
  }

  // 2. Secondary / Fallback: WaSender API
  await sendWaSenderMessage(to, text, apiKey);
}
