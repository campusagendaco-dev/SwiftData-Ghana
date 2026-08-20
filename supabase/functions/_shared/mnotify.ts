import { fetchViaDb } from "./db_proxy.ts";

export interface MnotifyVoicePayload {
  campaign: string;
  recipients: string[];
  voiceId?: string;
  audioBase64?: string;
  audioFileName?: string;
  audioMimeType?: string;
  isSchedule?: boolean;
  scheduleDate?: string;
}

export interface MnotifyVoiceResponse {
  success: boolean;
  status?: string;
  code?: string;
  message?: string;
  summary?: {
    _id: string;
    voice_id: string;
    type: string;
    total_sent: number;
    contacts: number;
    total_rejected: number;
    numbers_sent: string[];
    credit_used: number;
  };
  error?: string;
  raw?: any;
}

export async function getMnotifyApiKey(supabaseAdmin: any): Promise<string> {
  const envKey = Deno.env.get("MNOTIFY_API_KEY") || Deno.env.get("MNOTIFY_KEY");
  if (envKey) return envKey;

  try {
    const { data: provider } = await supabaseAdmin
      .from("providers")
      .select("api_key, settings")
      .ilike("name", "%mnotify%")
      .maybeSingle();

    if (provider?.api_key) return provider.api_key;
    if (provider?.settings?.api_key) return provider.settings.api_key;

    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("mnotify_api_key")
      .eq("id", 1)
      .maybeSingle();

    if (settings?.mnotify_api_key) return settings.mnotify_api_key;
  } catch (err) {
    console.error("[mNotify] Error resolving API key from database:", err);
  }

  return "";
}

/**
 * Fetch Message Templates from mNotify
 * GET https://api.mnotify.com/api/template?key=YOUR_API_KEY
 */
export async function fetchMnotifyTemplates(supabaseAdmin: any, apiKey?: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
  const key = apiKey || await getMnotifyApiKey(supabaseAdmin);
  if (!key) {
    return { success: false, error: "mNotify API key is not configured." };
  }

  try {
    const url = `https://api.mnotify.com/api/template?key=${encodeURIComponent(key)}`;
    const response = await fetchViaDb(supabaseAdmin, url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    const responseText = await response.text();
    let json;
    try {
      json = JSON.parse(responseText);
    } catch {
      return { success: false, error: `Invalid response from mNotify: ${responseText.slice(0, 150)}` };
    }

    if (json.status === "success" || Array.isArray(json.data) || Array.isArray(json)) {
      const list = json.data || (Array.isArray(json) ? json : []);
      return { success: true, data: list };
    }

    return { success: false, error: json.message || "Failed to fetch templates." };
  } catch (err: any) {
    console.error("[mNotify] fetchMnotifyTemplates error:", err);
    return { success: false, error: err.message || "Network error fetching templates." };
  }
}

/**
 * Fetch IVR Scenarios from mNotify
 * GET https://api.mnotify.com/api/ivr-scenarios?key=YOUR_API_KEY
 */
export async function fetchMnotifyIvrScenarios(supabaseAdmin: any, apiKey?: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
  const key = apiKey || await getMnotifyApiKey(supabaseAdmin);
  if (!key) {
    return { success: false, error: "mNotify API key is not configured." };
  }

  try {
    const url = `https://api.mnotify.com/api/ivr-scenarios?key=${encodeURIComponent(key)}`;
    const response = await fetchViaDb(supabaseAdmin, url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    const json = await response.json();
    if (json.status === "success" || Array.isArray(json.data)) {
      return { success: true, data: json.data || [] };
    }
    return { success: false, error: json.message || "Failed to fetch IVR scenarios." };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error fetching IVR scenarios." };
  }
}

/**
 * Send Quick Voice Call / Voice SMS via mNotify
 * POST https://api.mnotify.com/api/voice/quick?key=YOUR_API_KEY
 */
export async function sendMnotifyVoiceCall(
  supabaseAdmin: any,
  payload: MnotifyVoicePayload,
  apiKey?: string
): Promise<MnotifyVoiceResponse> {
  const key = apiKey || await getMnotifyApiKey(supabaseAdmin);
  if (!key) {
    return { success: false, error: "mNotify API key is not configured. Please add MNOTIFY_API_KEY in settings." };
  }

  if (!payload.campaign || !payload.campaign.trim()) {
    return { success: false, error: "Campaign title is required." };
  }

  if (!payload.recipients || payload.recipients.length === 0) {
    return { success: false, error: "At least one recipient phone number is required." };
  }

  if (!payload.voiceId && !payload.audioBase64) {
    return { success: false, error: "Please provide either a voice file or an existing voice_id." };
  }

  try {
    const formData = new FormData();
    formData.append("campaign", payload.campaign.trim());

    // Append recipients
    for (const r of payload.recipients) {
      const cleanPhone = r.trim().replace(/[^\d+]/g, "");
      if (cleanPhone) {
        formData.append("recipient[]", cleanPhone);
      }
    }

    if (payload.voiceId) {
      formData.append("voice_id", payload.voiceId.trim());
    } else if (payload.audioBase64) {
      // Decode Base64 audio to Uint8Array
      const binaryString = atob(payload.audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const mimeType = payload.audioMimeType || "audio/mpeg";
      const fileName = payload.audioFileName || "voice_message.mp3";
      const blob = new Blob([bytes], { type: mimeType });
      formData.append("file", blob, fileName);
      formData.append("voice_id", "");
    }

    formData.append("is_schedule", payload.isSchedule ? "true" : "false");
    formData.append("schedule_date", payload.isSchedule && payload.scheduleDate ? payload.scheduleDate : "");

    const url = `https://api.mnotify.com/api/voice/quick?key=${encodeURIComponent(key)}`;
    
    // Direct fetch with FormData
    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    const responseText = await response.text();
    let json: any;
    try {
      json = JSON.parse(responseText);
    } catch {
      return {
        success: false,
        error: `Invalid response from mNotify: ${responseText.slice(0, 200)}`,
        raw: responseText,
      };
    }

    if (json.status === "success" || json.code === "2000") {
      return {
        success: true,
        status: json.status,
        code: json.code,
        message: json.message || "Voice call sent successfully.",
        summary: json.summary,
        raw: json,
      };
    }

    return {
      success: false,
      status: json.status,
      code: json.code,
      error: json.message || json.error || "Failed to dispatch voice call.",
      raw: json,
    };
  } catch (err: any) {
    console.error("[mNotify] sendMnotifyVoiceCall error:", err);
    return {
      success: false,
      error: err.message || "Network error while connecting to mNotify API.",
    };
  }
}

/**
 * Check Account Balance
 */
export async function getMnotifyBalance(supabaseAdmin: any, apiKey?: string): Promise<{ success: boolean; voice_balance?: number; sms_balance?: number; error?: string }> {
  const key = apiKey || await getMnotifyApiKey(supabaseAdmin);
  if (!key) return { success: false, error: "mNotify API key missing" };

  try {
    const [smsRes, voiceRes] = await Promise.all([
      fetchViaDb(supabaseAdmin, `https://api.mnotify.com/api/balance/sms?key=${encodeURIComponent(key)}`, { method: "GET" }).then(r => r.json()).catch(() => null),
      fetchViaDb(supabaseAdmin, `https://api.mnotify.com/api/balance/voice?key=${encodeURIComponent(key)}`, { method: "GET" }).then(r => r.json()).catch(() => null)
    ]);

    return {
      success: true,
      sms_balance: smsRes?.balance ?? smsRes?.data?.balance ?? 0,
      voice_balance: voiceRes?.balance ?? voiceRes?.data?.balance ?? 0
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Send Quick Bulk SMS via mNotify
 * POST https://api.mnotify.com/api/sms/quick?key=YOUR_API_KEY
 */
export async function sendMnotifyQuickSms(
  supabaseAdmin: any,
  payload: {
    recipients: string[];
    sender: string;
    message: string;
    isSchedule?: boolean;
    scheduleDate?: string;
    smsType?: "otp" | string;
  },
  apiKey?: string
): Promise<{ success: boolean; message?: string; summary?: any; error?: string }> {
  const key = apiKey || await getMnotifyApiKey(supabaseAdmin);
  if (!key) {
    return { success: false, error: "mNotify API key is not configured." };
  }

  if (!payload.recipients || payload.recipients.length === 0) {
    return { success: false, error: "Recipient phone numbers are required." };
  }

  if (!payload.message || !payload.message.trim()) {
    return { success: false, error: "Message content cannot be empty." };
  }

  const cleanRecipients = payload.recipients
    .map(p => p.trim().replace(/[^\d+]/g, ""))
    .filter(p => p.length >= 9);

  if (cleanRecipients.length === 0) {
    return { success: false, error: "No valid recipient numbers provided." };
  }

  const bodyPayload: any = {
    recipient: cleanRecipients,
    sender: (payload.sender || "SwiftData").slice(0, 11),
    message: payload.message,
    is_schedule: payload.isSchedule ? true : false,
    schedule_date: payload.isSchedule && payload.scheduleDate ? payload.scheduleDate : ""
  };

  if (payload.smsType === "otp") {
    bodyPayload.sms_type = "otp";
  }

  try {
    const url = `https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(key)}`;
    const response = await fetchViaDb(supabaseAdmin, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload)
    });

    const responseText = await response.text();
    let json: any;
    try {
      json = JSON.parse(responseText);
    } catch {
      return { success: false, error: `Invalid response from mNotify: ${responseText.slice(0, 150)}` };
    }

    if (json.status === "success" || json.code === "2000") {
      return {
        success: true,
        message: json.message || "SMS sent successfully.",
        summary: json.summary
      };
    }

    return {
      success: false,
      error: json.message || json.error || "Failed to send SMS via mNotify."
    };
  } catch (err: any) {
    console.error("[mNotify] sendMnotifyQuickSms error:", err);
    return { success: false, error: err.message || "Network error sending SMS." };
  }
}

/**
 * Register Sender ID with mNotify
 * POST https://api.mnotify.com/api/senderid/register?key=YOUR_API_KEY
 */
export async function registerMnotifySenderId(
  supabaseAdmin: any,
  senderName: string,
  purpose: string,
  apiKey?: string
): Promise<{ success: boolean; message?: string; summary?: any; error?: string }> {
  const key = apiKey || await getMnotifyApiKey(supabaseAdmin);
  if (!key) return { success: false, error: "mNotify API key is not configured." };

  try {
    const url = `https://api.mnotify.com/api/senderid/register?key=${encodeURIComponent(key)}`;
    const response = await fetchViaDb(supabaseAdmin, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender_name: senderName.slice(0, 11),
        purpose: purpose || "For Transactional and Order Notification SMS"
      })
    });

    const json = await response.json();
    if (json.status === "success" || json.code === "2000") {
      return { success: true, message: json.message, summary: json.summary };
    }
    return { success: false, error: json.message || "Failed to register Sender ID." };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error registering Sender ID." };
  }
}

/**
 * Check Sender ID Status on mNotify
 * POST https://api.mnotify.com/api/senderid/status/?key=YOUR_API_KEY
 */
export async function checkMnotifySenderIdStatus(
  supabaseAdmin: any,
  senderName: string,
  apiKey?: string
): Promise<{ success: boolean; status?: string; summary?: any; error?: string }> {
  const key = apiKey || await getMnotifyApiKey(supabaseAdmin);
  if (!key) return { success: false, error: "mNotify API key is not configured." };

  try {
    const url = `https://api.mnotify.com/api/senderid/status/?key=${encodeURIComponent(key)}`;
    const response = await fetchViaDb(supabaseAdmin, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender_name: senderName })
    });

    const json = await response.json();
    if (json.status === "success" || json.code === "2000") {
      return {
        success: true,
        status: json.summary?.status || json.summary?.["sender name status"] || "Approved",
        summary: json.summary
      };
    }
    return { success: false, error: json.message || "Could not retrieve status." };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
