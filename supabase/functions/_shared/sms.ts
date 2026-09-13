import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { fetchViaDb } from "./db_proxy.ts";

declare const Deno: any;

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/[^\d+]/g, "");
  if (!clean) return null;

  let digits = clean.replace(/\D/g, "");
  if (!digits) return null;

  // Handle leading 00 (e.g. 00233... or 0024...)
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Handle 02X, 05X, 03X (Ghana local 10 digits -> 233...)
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `233${digits.slice(1)}`;
  }

  // If 9 digits starting with 2, 3, 5 (missing leading zero or 233)
  if (digits.length === 9 && /^[235]/.test(digits)) {
    digits = `233${digits}`;
  }

  // Valid Ghana phone: 233 followed by 9 digits starting with 2, 3, 5 (12 digits total)
  if (digits.startsWith("233") && digits.length === 12 && /^[235]/.test(digits.slice(3))) {
    return digits;
  }

  // Valid international numbers (10 to 15 digits, non-repeating zeroes)
  if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith("00000")) {
    return digits;
  }

  return null;
}

export function formatPhoneForKorba(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/[^\d+]/g, "");
  if (!clean) return null;

  const digits = clean.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("233") && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    return `+233${digits.slice(1)}`;
  }
  return `+233${digits}`;
}

export type SmsGatewayType = "txtconnect" | "mnotify" | "korba" | "arkesel" | "hubtel";

export interface SmsConfig {
  gateway: SmsGatewayType;
  apiKey: string | null;
  senderId: string;
  gatewayConfig: {
    txtconnect: { apiKey: string; senderId: string };
    mnotify: { apiKey: string; senderId: string };
    korba: { clientId: string; clientKey: string; secretKey: string; senderId: string };
    arkesel: { apiKey: string; senderId: string };
    hubtel: { clientId: string; clientSecret: string; senderId: string };
  };
  templates: Record<string, string>;
}

export async function getSmsConfig(supabaseAdmin: any, agentId?: string): Promise<SmsConfig> {
  const [{ data: settings }, { data: dbTemplates }, { data: mnotifyProvider }, { data: korbaProvider }] = await Promise.all([
    Promise.resolve(
      supabaseAdmin
        .from("v_system_settings_with_secrets")
        .select("*")
        .eq("id", 1)
        .maybeSingle()
    ).catch(async () => {
      const { data } = await supabaseAdmin.from("system_settings").select("*").eq("id", 1).maybeSingle();
      return { data };
    }),
    Promise.resolve(
      supabaseAdmin
        .from("sms_templates")
        .select("key, body, is_active")
        .eq("is_active", true)
    ).catch(() => ({ data: null })),
    Promise.resolve(
      supabaseAdmin
        .from("providers")
        .select("api_key, is_active, balance")
        .eq("handler_type", "mnotify")
        .maybeSingle()
    ).catch(() => ({ data: null })),
    Promise.resolve(
      supabaseAdmin
        .from("providers")
        .select("api_key, api_secret, settings, is_active, balance")
        .eq("handler_type", "korba")
        .maybeSingle()
    ).catch(() => ({ data: null }))
  ]);

  // 1. Resolve Active Gateway (Env takes precedence over DB)
  const envGateway = (Deno.env.get("ACTIVE_SMS_GATEWAY") || Deno.env.get("SMS_GATEWAY") || "").toLowerCase().trim();
  const dbGateway = (settings?.active_sms_gateway || "").toLowerCase().trim();
  const activeGateway: SmsGatewayType = (
    ["txtconnect", "mnotify", "korba", "arkesel", "hubtel"].includes(envGateway)
      ? envGateway
      : ["txtconnect", "mnotify", "korba", "arkesel", "hubtel"].includes(dbGateway)
      ? dbGateway
      : "txtconnect"
  ) as SmsGatewayType;

  // 2. Gateway Credentials Resolution (Env first, DB second per workspace rule)
  // TxtConnect
  const txtconnectKey = (Deno.env.get("TXTCONNECT_API_KEY") || settings?.txtconnect_api_key || "").trim();
  const txtconnectSender = (Deno.env.get("TXTCONNECT_SENDER_ID") || settings?.txtconnect_sender_id || "Orderinfo").trim();

  // mNotify (Env first, DB settings second, providers table third)
  const mnotifyKey = (
    Deno.env.get("MNOTIFY_API_KEY") || 
    Deno.env.get("MNOTIFY_KEY") || 
    settings?.mnotify_api_key || 
    mnotifyProvider?.api_key || 
    ""
  ).trim();
  const mnotifySender = (Deno.env.get("MNOTIFY_SENDER_ID") || settings?.mnotify_sender_id || txtconnectSender || "SwiftData").trim();

  // Korba (Env first, DB settings second, providers table third per workspace rule)
  const korbaClientId = (
    Deno.env.get("KORBA_CLIENT_ID") || 
    settings?.korba_client_id || 
    korbaProvider?.settings?.client_id || 
    "2419"
  ).trim();
  const korbaClientKey = (
    Deno.env.get("KORBA_CLIENT_KEY") || 
    settings?.korba_client_key || 
    korbaProvider?.api_key || 
    korbaProvider?.settings?.client_key || 
    ""
  ).trim();
  const korbaSecretKey = (
    Deno.env.get("KORBA_SECRET_KEY") || 
    settings?.korba_secret_key || 
    korbaProvider?.api_secret || 
    korbaProvider?.settings?.secret_key || 
    ""
  ).trim();
  const korbaSender = (Deno.env.get("KORBA_SENDER_ID") || settings?.korba_sender_id || "SwiftData").trim();
  const hasKorba = !!(korbaClientKey && korbaSecretKey);
  const korbaCombinedKey = `korba:${korbaClientId}:${korbaClientKey}:${korbaSecretKey}`;

  // Arkesel
  const arkeselKey = (Deno.env.get("ARKESEL_API_KEY") || settings?.arkesel_api_key || "").trim();
  const arkeselSender = (Deno.env.get("ARKESEL_SENDER_ID") || settings?.arkesel_sender_id || txtconnectSender || "SwiftData").trim();

  // Hubtel
  const hubtelClientId = (Deno.env.get("HUBTEL_CLIENT_ID") || settings?.hubtel_client_id || "").trim();
  const hubtelClientSecret = (Deno.env.get("HUBTEL_CLIENT_SECRET") || settings?.hubtel_client_secret || "").trim();
  const hubtelSender = (Deno.env.get("HUBTEL_SMS_SENDER_ID") || settings?.hubtel_sms_sender_id || txtconnectSender || "SwiftData").trim();
  const hasHubtel = !!(hubtelClientId && hubtelClientSecret);

  // 3. Resolve Effective API Key and Sender ID for Selected Gateway
  let resolvedApiKey: string | null = null;
  let resolvedSenderId = txtconnectSender || "Orderinfo";
  let effectiveGateway: SmsGatewayType = activeGateway;

  // Rate-Limit Circuit Breaker Check for TxtConnect
  const cooldownUntil = settings?.txtconnect_cooldown_until ? new Date(settings.txtconnect_cooldown_until).getTime() : 0;
  const isTxtConnectCooling = cooldownUntil > Date.now();

  if (activeGateway === "txtconnect" && isTxtConnectCooling) {
    const remainingSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
    console.warn(`[SMS Circuit Breaker] TxtConnect is cooling down (${remainingSec}s remaining). Autonomous failover to secondary gateway active.`);
    if (mnotifyKey) {
      resolvedApiKey = mnotifyKey;
      resolvedSenderId = mnotifySender;
      effectiveGateway = "mnotify";
    } else if (hasKorba) {
      resolvedApiKey = korbaCombinedKey;
      resolvedSenderId = korbaSender;
      effectiveGateway = "korba";
    } else {
      resolvedApiKey = txtconnectKey;
      resolvedSenderId = txtconnectSender;
    }
  } else if (activeGateway === "mnotify" && mnotifyKey) {
    resolvedApiKey = mnotifyKey;
    resolvedSenderId = mnotifySender;
  } else if (activeGateway === "korba" && hasKorba) {
    resolvedApiKey = korbaCombinedKey;
    resolvedSenderId = korbaSender;
  } else if (activeGateway === "arkesel" && arkeselKey) {
    resolvedApiKey = arkeselKey;
    resolvedSenderId = arkeselSender;
  } else if (activeGateway === "hubtel" && hasHubtel) {
    resolvedApiKey = `${hubtelClientId}:${hubtelClientSecret}`;
    resolvedSenderId = hubtelSender;
  } else if (activeGateway === "txtconnect" && txtconnectKey) {
    resolvedApiKey = txtconnectKey;
    resolvedSenderId = txtconnectSender;
  } else {
    // Fallback: Pick first configured gateway to prevent complete SMS outages
    if (txtconnectKey && !isTxtConnectCooling) {
      resolvedApiKey = txtconnectKey;
      resolvedSenderId = txtconnectSender;
      effectiveGateway = "txtconnect";
    } else if (mnotifyKey) {
      resolvedApiKey = mnotifyKey;
      resolvedSenderId = mnotifySender;
      effectiveGateway = "mnotify";
    } else if (hasKorba) {
      resolvedApiKey = korbaCombinedKey;
      resolvedSenderId = korbaSender;
      effectiveGateway = "korba";
    } else if (arkeselKey) {
      resolvedApiKey = arkeselKey;
      resolvedSenderId = arkeselSender;
      effectiveGateway = "arkesel";
    } else if (hasHubtel) {
      resolvedApiKey = `${hubtelClientId}:${hubtelClientSecret}`;
      resolvedSenderId = hubtelSender;
      effectiveGateway = "hubtel";
    }
  }

  let finalSenderId = resolvedSenderId;

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

  const tMap: Record<string, string> = {};
  if (Array.isArray(dbTemplates)) {
    for (const t of dbTemplates) {
      if (t?.key && t?.body) tMap[t.key] = t.body;
    }
  }

  return {
    gateway: effectiveGateway,
    apiKey: resolvedApiKey,
    senderId: finalSenderId,
    gatewayConfig: {
      txtconnect: { apiKey: txtconnectKey, senderId: txtconnectSender },
      mnotify: { apiKey: mnotifyKey, senderId: mnotifySender },
      korba: { clientId: korbaClientId, clientKey: korbaClientKey, secretKey: korbaSecretKey, senderId: korbaSender },
      arkesel: { apiKey: arkeselKey, senderId: arkeselSender },
      hubtel: { clientId: hubtelClientId, clientSecret: hubtelClientSecret, senderId: hubtelSender }
    },
    templates: {
      payment_success: tMap.payment_success || settings?.payment_success_sms_message || "Success! Your order for {phone} ({package}) has been processed. ⚡ Est. Delivery: {est_delivery}.",
      utility_paid: tMap.utility_paid || settings?.utility_paid_sms_message || "Payment received! Your {utility_type} bill for {account} is being processed.",
      wallet_topup: tMap.wallet_topup || settings?.wallet_topup_sms_message || "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.",
      withdrawal_request: tMap.withdrawal_request || settings?.withdrawal_request_sms_message || "Withdrawal request of GHS {amount} received. It will be processed shortly.",
      withdrawal_completed: tMap.withdrawal_completed || settings?.withdrawal_completed_sms_message || "Your withdrawal of GHS {amount} has been completed.",
      order_failed: tMap.order_failed || settings?.order_failed_sms_message || "Order for {package} to {phone} failed.{reason} GHS {amount} has been refunded to your wallet. No panic, your refund is completed.",
      manual_credit: tMap.manual_credit || settings?.manual_credit_sms_message || "Your account has been manually credited with GHS {amount}.",
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
  const formattedPhone = formatPhoneForKorba(to);
  if (!formattedPhone) {
    throw new Error(`Invalid recipient phone number for Korba SMS: ${to}`);
  }

  const payload = {
    client_id: String(clientId).trim(),
    phone_number: formattedPhone,
    sms_message: body,
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    // Generate Signature per Korba documentation:
    // message = "&".join(f"{k}={v}" for k, v in sorted(payload.items()))
    // signature = hmac.new(secret_key.encode(), message.encode(), hashlib.sha256).hexdigest()
    const pMap = payload as Record<string, string>;
    const sortedKeys = Object.keys(pMap).sort();
    const messageParts = [];
    for (const key of sortedKeys) {
      if (pMap[key] !== undefined) {
        messageParts.push(`${key}=${pMap[key]}`);
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

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `HMAC ${clientKey}:${signatureHex}`,
    };

    let response: any;
    let responseText = "";

    // 1. Try routing through static IP proxy bridge (fetchViaDb)
    try {
      response = await fetchViaDb(supabaseAdmin, endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      responseText = await response.text();
    } catch (proxyErr) {
      console.warn(`[Korba SMS] DB proxy attempt failed for ${formattedPhone}:`, proxyErr);
    }

    // 2. Fallback to direct fetch if proxy route fails (e.g. 502 / network glitch)
    if (!response || !response.ok || response.status >= 500) {
      try {
        console.log(`[Korba SMS] Attempting direct fetch fallback to Korba for ${formattedPhone}...`);
        const directRes = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (directRes) {
          response = directRes;
          responseText = await directRes.text();
        }
      } catch (directErr) {
        console.warn(`[Korba SMS] Direct fetch fallback failed for ${formattedPhone}:`, directErr);
      }
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`Korba SMS returned non-JSON: ${responseText.substring(0, 200)}`);
    }

    if (!response || !response.ok || (data && data.response_code !== "00")) {
      const errMsg = data?.message || data?.error || `HTTP ${response?.status || 'Unknown'}`;
      throw new Error(`Korba SMS Error: ${errMsg}`);
    }

    await logSmsToDb(to, "KorbaSMS", body, type, "success", undefined, agentId).catch(console.error);
    return data;
  } catch (error: any) {
    console.error(`Failed to send SMS via Korba to ${to}:`, error);
    await logSmsToDb(to, "KorbaSMS", body, type, "failed", error instanceof Error ? error.message : String(error), agentId).catch(console.error);
    throw error;
  }
}

export async function sendBulkSmsViaKorba(
  clientId: string,
  clientKey: string,
  secretKey: string,
  recipients: string[],
  body: string,
  type = "broadcast",
  agentId?: string
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  const uniqueRecipients = Array.from(new Set(recipients.map((r) => r.trim()).filter(Boolean)));
  if (uniqueRecipients.length === 0) return { sent: 0, failures: [] };

  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];
  const CONCURRENCY = 8;

  for (let i = 0; i < uniqueRecipients.length; i += CONCURRENCY) {
    const chunk = uniqueRecipients.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (phone) => {
        try {
          await sendSmsViaKorba(clientId, clientKey, secretKey, phone, body, type, agentId);
          sent++;
        } catch (err: any) {
          failures.push({ phone, reason: err?.message || "Korba failed" });
        }
      })
    );

    if (i + CONCURRENCY < uniqueRecipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return { sent, failures };
}

export async function sendSmsViaMnotify(
  apiKey: string,
  from: string,
  to: string,
  body: string,
  type = "broadcast",
  agentId?: string
) {
  if (!apiKey || !to) return;
  const endpoint = `https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`;
  const cleanPhone = to.trim().replace(/[^\d+]/g, "");
  const payload = {
    recipient: [cleanPhone],
    sender: from.slice(0, 11),
    message: body,
    is_schedule: false,
    schedule_date: ""
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.status !== "success" && data.code !== "2000" && data.code !== 2000)) {
      throw new Error(`mNotify Error: ${data?.message || data?.error || res.statusText}`);
    }
    await logSmsToDb(to, from, body, type, "success", undefined, agentId).catch(console.error);
    return data;
  } catch (error: any) {
    console.error(`Failed to send SMS via mNotify to ${to}:`, error);
    await logSmsToDb(to, from, body, type, "failed", error instanceof Error ? error.message : String(error), agentId).catch(console.error);
    throw error;
  }
}

export async function sendBulkSmsViaMnotify(
  apiKey: string,
  from: string,
  recipients: string[],
  body: string,
  type = "broadcast",
  agentId?: string
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];
  const BATCH_SIZE = 100;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    try {
      const endpoint = `https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: chunk,
          sender: from.slice(0, 11),
          message: body,
          is_schedule: false,
          schedule_date: ""
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || (data && data.status !== "success" && data.code !== "2000" && data.code !== 2000)) {
        throw new Error(`mNotify Bulk Error: ${data?.message || data?.error || res.statusText}`);
      }
      sent += chunk.length;
      const successLogs = chunk.map((p) => ({
        recipient: p,
        sender_id: from,
        body,
        type,
        status: "success" as const,
        error_message: null,
        agent_id: agentId || null
      }));
      logBulkSmsToDb(successLogs).catch(console.error);
    } catch (err: any) {
      const msg = err?.message || "Failed";
      chunk.forEach((p) => failures.push({ phone: p, reason: msg }));
      const failedLogs = chunk.map((p) => ({
        recipient: p,
        sender_id: from,
        body,
        type,
        status: "failed" as const,
        error_message: msg,
        agent_id: agentId || null
      }));
      logBulkSmsToDb(failedLogs).catch(console.error);
    }
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return { sent, failures };
}

export async function sendSmsViaArkesel(
  apiKey: string,
  from: string,
  to: string,
  body: string,
  type = "broadcast",
  agentId?: string
) {
  if (!apiKey || !to) return;
  const endpoint = "https://sms.arkesel.com/api/v2/sms/send";
  const cleanPhone = to.trim().replace(/[^\d+]/g, "");
  const payload = {
    sender: from.slice(0, 11),
    message: body,
    recipients: [cleanPhone]
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.status !== "success" && data.code !== 1000 && data.code !== "1000")) {
      throw new Error(`Arkesel Error: ${data?.message || res.statusText}`);
    }
    await logSmsToDb(to, from, body, type, "success", undefined, agentId).catch(console.error);
    return data;
  } catch (error: any) {
    console.error(`Failed to send SMS via Arkesel to ${to}:`, error);
    await logSmsToDb(to, from, body, type, "failed", error instanceof Error ? error.message : String(error), agentId).catch(console.error);
    throw error;
  }
}

export async function sendBulkSmsViaArkesel(
  apiKey: string,
  from: string,
  recipients: string[],
  body: string,
  type = "broadcast",
  agentId?: string
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];
  const BATCH_SIZE = 100;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    try {
      const endpoint = "https://sms.arkesel.com/api/v2/sms/send";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sender: from.slice(0, 11),
          message: body,
          recipients: chunk
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || (data && data.status !== "success" && data.code !== 1000 && data.code !== "1000")) {
        throw new Error(`Arkesel Error: ${data?.message || res.statusText}`);
      }
      sent += chunk.length;
      const successLogs = chunk.map((p) => ({
        recipient: p,
        sender_id: from,
        body,
        type,
        status: "success" as const,
        error_message: null,
        agent_id: agentId || null
      }));
      logBulkSmsToDb(successLogs).catch(console.error);
    } catch (err: any) {
      const msg = err?.message || "Failed";
      chunk.forEach((p) => failures.push({ phone: p, reason: msg }));
      const failedLogs = chunk.map((p) => ({
        recipient: p,
        sender_id: from,
        body,
        type,
        status: "failed" as const,
        error_message: msg,
        agent_id: agentId || null
      }));
      logBulkSmsToDb(failedLogs).catch(console.error);
    }
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return { sent, failures };
}

export async function sendSmsViaHubtel(
  clientId: string,
  clientSecret: string,
  from: string,
  to: string,
  body: string,
  type = "broadcast",
  agentId?: string
) {
  if (!clientId || !clientSecret || !to) return;
  const endpoint = "https://sms.hubtel.com/v1/messages/send";
  const authHeader = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  const payload = {
    From: from.slice(0, 11),
    To: to.trim().replace(/[^\d+]/g, ""),
    Content: body
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.status !== 0 && data.status !== "0" && data.Status !== 0)) {
      throw new Error(`Hubtel Error: ${data?.message || data?.status || res.statusText}`);
    }
    await logSmsToDb(to, from, body, type, "success", undefined, agentId).catch(console.error);
    return data;
  } catch (error: any) {
    console.error(`Failed to send SMS via Hubtel to ${to}:`, error);
    await logSmsToDb(to, from, body, type, "failed", error instanceof Error ? error.message : String(error), agentId).catch(console.error);
    throw error;
  }
}

export async function sendBulkSmsViaHubtel(
  clientId: string,
  clientSecret: string,
  from: string,
  recipients: string[],
  body: string,
  type = "broadcast",
  agentId?: string
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];
  for (const r of recipients) {
    try {
      await sendSmsViaHubtel(clientId, clientSecret, from, r, body, type, agentId);
      sent++;
    } catch (err: any) {
      failures.push({ phone: r, reason: err.message || "Failed" });
    }
  }
  return { sent, failures };
}

export async function dispatchUnifiedSms(
  gateway: string,
  apiKey: string | null,
  from: string,
  to: string,
  body: string,
  type = "broadcast",
  agentId?: string
): Promise<any> {
  const g = (gateway || "txtconnect").toLowerCase().trim();
  const key = apiKey || "";

  if (g === "mnotify" || key.startsWith("mnotify:")) {
    const actualKey = key.startsWith("mnotify:") ? key.slice(8) : key;
    return await sendSmsViaMnotify(actualKey, from, to, body, type, agentId);
  }
  if (g === "korba" || key === "korba" || key.startsWith("korba:")) {
    let cId = Deno.env.get("KORBA_CLIENT_ID") || "2419";
    let cKey = Deno.env.get("KORBA_CLIENT_KEY") || "";
    let sKey = Deno.env.get("KORBA_SECRET_KEY") || "";

    if (key.startsWith("korba:")) {
      const parts = key.slice(6).split(":");
      if (parts.length >= 3) {
        cId = parts[0] || cId;
        cKey = parts[1] || cKey;
        sKey = parts.slice(2).join(":") || sKey;
      }
    }
    return await sendSmsViaKorba(cId, cKey, sKey, to, body, type, agentId);
  }
  if (g === "arkesel" || key.startsWith("arkesel:")) {
    const actualKey = key.startsWith("arkesel:") ? key.slice(8) : key;
    return await sendSmsViaArkesel(actualKey, from, to, body, type, agentId);
  }
  if (g === "hubtel" || key.startsWith("hubtel:") || key.includes(":")) {
    const raw = key.startsWith("hubtel:") ? key.slice(7) : key;
    const [cId, cSec] = raw.split(":");
    const finalId = cId || Deno.env.get("HUBTEL_CLIENT_ID") || "";
    const finalSec = cSec || Deno.env.get("HUBTEL_CLIENT_SECRET") || "";
    return await sendSmsViaHubtel(finalId, finalSec, from, to, body, type, agentId);
  }
  return await sendSmsViaTxtConnect(key, from, to, body, type, agentId);
}

export async function dispatchUnifiedBulkSms(
  gateway: string,
  apiKey: string | null,
  from: string,
  recipients: string[],
  body: string,
  type = "broadcast",
  agentId?: string
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  const g = (gateway || "txtconnect").toLowerCase().trim();
  const key = apiKey || "";

  if (g === "mnotify" || key.startsWith("mnotify:")) {
    const actualKey = key.startsWith("mnotify:") ? key.slice(8) : key;
    return await sendBulkSmsViaMnotify(actualKey, from, recipients, body, type, agentId);
  }
  if (g === "korba" || key === "korba" || key.startsWith("korba:")) {
    let cId = Deno.env.get("KORBA_CLIENT_ID") || "2419";
    let cKey = Deno.env.get("KORBA_CLIENT_KEY") || "";
    let sKey = Deno.env.get("KORBA_SECRET_KEY") || "";

    if (key.startsWith("korba:")) {
      const parts = key.slice(6).split(":");
      if (parts.length >= 3) {
        cId = parts[0] || cId;
        cKey = parts[1] || cKey;
        sKey = parts.slice(2).join(":") || sKey;
      }
    }
    return await sendBulkSmsViaKorba(cId, cKey, sKey, recipients, body, type, agentId);
  }
  if (g === "arkesel" || key.startsWith("arkesel:")) {
    const actualKey = key.startsWith("arkesel:") ? key.slice(8) : key;
    return await sendBulkSmsViaArkesel(actualKey, from, recipients, body, type, agentId);
  }
  if (g === "hubtel" || key.startsWith("hubtel:") || key.includes(":")) {
    const raw = key.startsWith("hubtel:") ? key.slice(7) : key;
    const [cId, cSec] = raw.split(":");
    const finalId = cId || Deno.env.get("HUBTEL_CLIENT_ID") || "";
    const finalSec = cSec || Deno.env.get("HUBTEL_CLIENT_SECRET") || "";
    return await sendBulkSmsViaHubtel(finalId, finalSec, from, recipients, body, type, agentId);
  }
  return await sendBulkSmsViaTxtConnect(key, from, recipients, body, type, agentId);
}

export async function sendSmsViaTxtConnect(
  apiKey: string,
  from: string,
  to: string,
  body: string,
  type = "broadcast",
  agentId?: string,
  gateway?: string
): Promise<any> {
  if (!apiKey || !to) return;

  let effectiveGateway = (gateway || "").toLowerCase().trim();
  if (!effectiveGateway) {
    if (apiKey === "korba") effectiveGateway = "korba";
    else if (apiKey.startsWith("mnotify:") || (Deno.env.get("MNOTIFY_API_KEY") && apiKey === Deno.env.get("MNOTIFY_API_KEY"))) effectiveGateway = "mnotify";
    else if (apiKey.startsWith("arkesel:") || (Deno.env.get("ARKESEL_API_KEY") && apiKey === Deno.env.get("ARKESEL_API_KEY"))) effectiveGateway = "arkesel";
    else if (apiKey.startsWith("hubtel:") || apiKey.includes(":")) effectiveGateway = "hubtel";
    else {
      const activeEnv = (Deno.env.get("ACTIVE_SMS_GATEWAY") || Deno.env.get("SMS_GATEWAY") || "").toLowerCase().trim();
      if (["mnotify", "korba", "arkesel", "hubtel"].includes(activeEnv)) {
        effectiveGateway = activeEnv;
      }
    }
  }

  if (effectiveGateway && effectiveGateway !== "txtconnect") {
    return await dispatchUnifiedSms(effectiveGateway, apiKey, from, to, body, type, agentId);
  }

  if (apiKey === "korba") {
    const korbaClientId = Deno.env.get("KORBA_CLIENT_ID") || "2419";
    const korbaClientKey = Deno.env.get("KORBA_CLIENT_KEY") || "";
    const korbaSecretKey = Deno.env.get("KORBA_SECRET_KEY") || "";
    return await sendSmsViaKorba(korbaClientId, korbaClientKey, korbaSecretKey, to, body, type, agentId);
  }
  if (apiKey.startsWith("mnotify:")) {
    return await sendSmsViaMnotify(apiKey.slice(8), from, to, body, type, agentId);
  }
  if (apiKey.startsWith("arkesel:")) {
    return await sendSmsViaArkesel(apiKey.slice(8), from, to, body, type, agentId);
  }
  if (apiKey.startsWith("hubtel:")) {
    const [cId, cSec] = apiKey.slice(7).split(":");
    return await sendSmsViaHubtel(cId, cSec, from, to, body, type, agentId);
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

    const data = await response.json().catch(() => ({}));
    const isRateLimited = response.status === 429 || 
      data?.data?.status_code === "999" || 
      data?.status_code === "999" ||
      String(data?.data?.reason || "").toLowerCase().includes("too many request") ||
      String(data?.reason || "").toLowerCase().includes("too many request");

    if (!response.ok || isRateLimited) {
      const errReason = data?.data?.reason || data?.reason || data?.msg || `HTTP ${response.status}`;
      console.warn(`[SMS Failover] TxtConnect failed (${errReason}). Engaging autonomous secondary gateway failover...`);

      // Attempt immediate failover to secondary gateway (mNotify or Korba)
      const url = Deno.env.get("SUPABASE_URL") || "";
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (url && key) {
        try {
          const supabaseAdmin = createClient(url, key);
          if (isRateLimited) {
            const cooldownExpiry = new Date(Date.now() + 65 * 1000).toISOString();
            supabaseAdmin.from("system_settings").update({ txtconnect_cooldown_until: cooldownExpiry }).eq("id", 1).then(() => {}).catch(() => {});
          }
          const config = await getSmsConfig(supabaseAdmin, agentId);

          if (config.gatewayConfig.mnotify.apiKey) {
            console.log(`[SMS Failover] Rerouting single SMS to ${to} via mNotify...`);
            return await sendSmsViaMnotify(
              config.gatewayConfig.mnotify.apiKey,
              config.gatewayConfig.mnotify.senderId || from,
              to,
              body,
              type,
              agentId
            );
          }

          const korba = config.gatewayConfig.korba;
          if (korba.clientKey && korba.secretKey) {
            console.log(`[SMS Failover] Rerouting single SMS to ${to} via Korba...`);
            return await sendSmsViaKorba(
              korba.clientId,
              korba.clientKey,
              korba.secretKey,
              to,
              body,
              type,
              agentId
            );
          }
        } catch (failoverErr) {
          console.error("[SMS Failover] Secondary gateway attempt failed:", failoverErr);
        }
      }

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

async function logBulkSmsToDb(logs: Array<{
  recipient: string;
  sender_id: string;
  body: string;
  type: string;
  status: string;
  error_message?: string | null;
  agent_id?: string | null;
}>) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key || logs.length === 0) return;
  try {
    const supabase = createClient(url, key);
    await supabase.from("sms_logs").insert(logs);
  } catch (err: any) {
    console.error("[SMS Bulk Log] Error logging SMS batch:", err?.message || String(err));
  }
}

// Sends one message to multiple recipients in a single API call (max 100 per batch)
export async function sendBulkSmsViaTxtConnect(
  apiKey: string,
  from: string,
  recipients: string[],
  body: string,
  type = "broadcast",
  agentId?: string,
  gateway?: string
): Promise<{ sent: number; failures: Array<{ phone: string; reason: string }> }> {
  let effectiveGateway = (gateway || "").toLowerCase().trim();
  if (!effectiveGateway) {
    if (apiKey === "korba") effectiveGateway = "korba";
    else if (apiKey.startsWith("mnotify:") || (Deno.env.get("MNOTIFY_API_KEY") && apiKey === Deno.env.get("MNOTIFY_API_KEY"))) effectiveGateway = "mnotify";
    else if (apiKey.startsWith("arkesel:") || (Deno.env.get("ARKESEL_API_KEY") && apiKey === Deno.env.get("ARKESEL_API_KEY"))) effectiveGateway = "arkesel";
    else if (apiKey.startsWith("hubtel:") || apiKey.includes(":")) effectiveGateway = "hubtel";
    else {
      const activeEnv = (Deno.env.get("ACTIVE_SMS_GATEWAY") || Deno.env.get("SMS_GATEWAY") || "").toLowerCase().trim();
      if (["mnotify", "korba", "arkesel", "hubtel"].includes(activeEnv)) {
        effectiveGateway = activeEnv;
      }
    }
  }

  if (effectiveGateway && effectiveGateway !== "txtconnect") {
    return await dispatchUnifiedBulkSms(effectiveGateway, apiKey, from, recipients, body, type, agentId);
  }

  if (apiKey === "korba" || apiKey.startsWith("korba:")) {
    let cId = Deno.env.get("KORBA_CLIENT_ID") || "2419";
    let cKey = Deno.env.get("KORBA_CLIENT_KEY") || "";
    let sKey = Deno.env.get("KORBA_SECRET_KEY") || "";

    if (apiKey.startsWith("korba:")) {
      const parts = apiKey.slice(6).split(":");
      if (parts.length >= 3) {
        cId = parts[0] || cId;
        cKey = parts[1] || cKey;
        sKey = parts.slice(2).join(":") || sKey;
      }
    }
    return await sendBulkSmsViaKorba(cId, cKey, sKey, recipients, body, type, agentId);
  }

  if (apiKey.startsWith("mnotify:")) {
    return await sendBulkSmsViaMnotify(apiKey.slice(8), from, recipients, body, type, agentId);
  }
  if (apiKey.startsWith("arkesel:")) {
    return await sendBulkSmsViaArkesel(apiKey.slice(8), from, recipients, body, type, agentId);
  }
  if (apiKey.startsWith("hubtel:")) {
    const [cId, cSec] = apiKey.slice(7).split(":");
    return await sendBulkSmsViaHubtel(cId, cSec, from, recipients, body, type, agentId);
  }

  // Deduplicate and clean recipient phone numbers
  const uniqueRecipients = Array.from(new Set(recipients.map((r) => r.trim()).filter(Boolean)));
  if (uniqueRecipients.length === 0) return { sent: 0, failures: [] };

  const effectiveKey = apiKey;
  let sent = 0;
  const failures: Array<{ phone: string; reason: string }> = [];

  const BATCH_SIZE = 100;
  for (let i = 0; i < uniqueRecipients.length; i += BATCH_SIZE) {
    const chunk = uniqueRecipients.slice(i, i + BATCH_SIZE);
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
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`TxtConnect returned non-JSON: ${responseText.substring(0, 200)}`);
      }

      const isRateLimited = response.status === 429 || 
        data?.data?.status_code === "999" || 
        data?.status_code === "999" ||
        String(data?.data?.reason || "").toLowerCase().includes("too many request") ||
        String(data?.reason || "").toLowerCase().includes("too many request");

      if (!response.ok || isRateLimited) {
        const errReason = data?.data?.reason || data?.reason || data?.msg || `HTTP ${response.status}`;
        console.warn(`[Bulk SMS Failover] TxtConnect batch failed (${errReason}). Engaging secondary gateway failover...`);

        // Failover all remaining recipients to secondary gateway (mNotify or Korba)
        const url = Deno.env.get("SUPABASE_URL") || "";
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        let failedOver = false;

        if (url && key) {
          try {
            const supabaseAdmin = createClient(url, key);
            if (isRateLimited) {
              const cooldownExpiry = new Date(Date.now() + 65 * 1000).toISOString();
              supabaseAdmin.from("system_settings").update({ txtconnect_cooldown_until: cooldownExpiry }).eq("id", 1).then(() => {}).catch(() => {});
            }
            const config = await getSmsConfig(supabaseAdmin, agentId);

            if (config.gatewayConfig.mnotify.apiKey) {
              const remaining = uniqueRecipients.slice(i);
              console.log(`[Bulk SMS Failover] TxtConnect rate limited. Rerouting all remaining ${remaining.length} recipients to mNotify...`);
              const mnotifyRes = await sendBulkSmsViaMnotify(
                config.gatewayConfig.mnotify.apiKey,
                config.gatewayConfig.mnotify.senderId || from,
                remaining,
                body,
                type,
                agentId
              );
              sent += mnotifyRes.sent;
              failures.push(...mnotifyRes.failures);
              failedOver = true;
              break; // All remaining recipients successfully routed via mNotify
            } else if (config.gatewayConfig.korba.clientKey && config.gatewayConfig.korba.secretKey) {
              const remaining = uniqueRecipients.slice(i);
              console.log(`[Bulk SMS Failover] TxtConnect rate limited. Rerouting all remaining ${remaining.length} recipients to Korba...`);
              const korba = config.gatewayConfig.korba;
              const korbaRes = await sendBulkSmsViaKorba(
                korba.clientId,
                korba.clientKey,
                korba.secretKey,
                remaining,
                body,
                type,
                agentId
              );
              sent += korbaRes.sent;
              failures.push(...korbaRes.failures);
              failedOver = true;
              break; // All remaining recipients successfully routed via Korba
            }
          } catch (failoverErr) {
            console.error("[Bulk SMS Failover] Secondary gateway attempt failed:", failoverErr);
          }
        }

        if (failedOver) {
          continue;
        }

        throw new Error(`TxtConnect Error (${response.status}): ${JSON.stringify(data)}`);
      }
      
      if (data && data.msg !== "Sms send Successful" && !data.messageId) {
         throw new Error(`TxtConnect API failure: ${data.msg || "Unknown error"}`);
      }

      sent += chunk.length;
      
      // Bulk log successes asynchronously to avoid blocking the HTTP thread
      const successLogs = chunk.map((phone) => ({
        recipient: phone,
        sender_id: from,
        body,
        type,
        status: "success" as const,
        error_message: null,
        agent_id: agentId || null
      }));
      logBulkSmsToDb(successLogs).catch(console.error);
    } catch (err: any) {
      const errMessage = err?.message || "Failed";
      console.error(`Failed to send bulk SMS batch to chunk starting with ${chunk[0]}:`, err);
      const failedLogs = chunk.map((phone) => {
        failures.push({ phone, reason: errMessage });
        return {
          recipient: phone,
          sender_id: from,
          body,
          type,
          status: "failed" as const,
          error_message: errMessage,
          agent_id: agentId || null
        };
      });
      logBulkSmsToDb(failedLogs).catch(console.error);
    }

    if (i + BATCH_SIZE < uniqueRecipients.length) {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5s pacing prevents tripping TxtConnect's token bucket
    }
  }

  return { sent, failures };
}

export function formatTemplate(template: string, vars: Record<string, string | number>) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{${key}}`, 'gi'), String(value ?? ""));
  }
  // Clean up any unreplaced template variables cleanly
  result = result.replace(/\{[a-z0-9_]+\}/gi, "").replace(/\s+/g, " ").trim();
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
    const { apiKey, senderId, templates, gateway, gatewayConfig } = await getSmsConfig(supabaseAdmin, agentId);
    const recipient = normalizePhone(customerPhone);
    
    // Support per-call gateway override (e.g. { gateway: "korba" } for Korba packages)
    const requestedGateway = vars.gateway ? String(vars.gateway).toLowerCase().trim() : "";
    const effectiveGateway = requestedGateway || gateway;

    let effectiveApiKey = apiKey;
    let activeSenderId = vars.senderId ? String(vars.senderId) : senderId;

    if (requestedGateway === "korba" && gatewayConfig?.korba?.clientKey) {
      const k = gatewayConfig.korba;
      effectiveApiKey = `korba:${k.clientId}:${k.clientKey}:${k.secretKey}`;
      activeSenderId = k.senderId || "SwiftData";
    }

    if (!effectiveApiKey || !recipient) {
      console.warn(`[SMS] Missing config or recipient: to=${customerPhone}, hasApiKey=${!!effectiveApiKey}, gateway=${effectiveGateway}`);
      return;
    }

    if (!vars.est_delivery) {
      const net = String(vars.network || "").toUpperCase();
      if (net.includes("TELECEL") || net.includes("VODAFONE") || net.includes("AIRTEL") || net.includes("AT")) {
        vars.est_delivery = "Instant - 5 mins";
      } else {
        vars.est_delivery = "1 - 15 mins";
      }
    }

    const rLower = String(vars.reason || "").toLowerCase();
    const netUpper = String(vars.network || "").toUpperCase();
    const isMtn = !vars.network || netUpper.includes("MTN");
    const isBenReason = isMtn && (rLower.includes("beneficiary") || rLower.includes("whitelist") || rLower.includes("not added") || rLower.includes("not on") || rLower.includes("unregistered"));

    let message = "";
    if (type === "custom" && vars.message) {
      message = String(vars.message);
    } else if (type === "order_failed" && isBenReason) {
      message = `SwiftData Notice: Your number (${recipient}) is not verified on the MTN beneficiary list.\n\n` +
        `Please submit your number for verification at:\n` +
        `https://swiftdatagh.shop/submit-numbers\n\n` +
        `After verification (which takes 1 to 4 days), your order will be delivered automatically! No panic!`;
    } else {
      const tMap = templates as Record<string, string>;
      message = formatTemplate(tMap[type] || templates.payment_success, vars);
    }

    console.log(`[SMS] Sending ${type} via ${effectiveGateway} to ${recipient} (Sender: ${activeSenderId})...`);
    
    try {
      return await dispatchUnifiedSms(effectiveGateway, effectiveApiKey, activeSenderId, recipient, message, type, agentId);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const defaultSenderId = Deno.env.get("TXTCONNECT_SENDER_ID") || "Orderinfo";
      
      if (activeSenderId !== defaultSenderId) {
        console.warn(`[SMS Fallback] Custom Sender ID "${activeSenderId}" failed (${errorMsg}). Retrying with default: "${defaultSenderId}"...`);
        if (agentId) {
          await Promise.resolve(supabaseAdmin.rpc("refund_sms_credit", { p_user_id: agentId })).catch(console.error);
        }
        return await dispatchUnifiedSms(effectiveGateway, effectiveApiKey, defaultSenderId, recipient, message, type, agentId);
      }
      
      throw error;
    }
  } catch (error) {
    console.error(`[SMS] Failed to send ${type} SMS to ${customerPhone}:`, error);
  }
}

// Aliases for modern unified usage
export const sendSms = dispatchUnifiedSms;
export const sendBulkSms = dispatchUnifiedBulkSms;
