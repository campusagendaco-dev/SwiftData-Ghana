declare const Deno: any;

/**
 * Normalizes a WhatsApp phone number into standard international format (+233...)
 */
export function formatWhatsAppRecipient(to: string): string {
  let clean = to.replace(/\s+/g, "").replace(/-/g, "").replace(/^whatsapp:/i, "");
  if (clean.endsWith("@lid") || clean.endsWith("@newsletter") || clean.endsWith("@g.us")) {
    return clean;
  }
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 14 && !digits.startsWith("233")) {
    return `${digits}@lid`;
  }
  if (clean.startsWith("0") && clean.length === 10) {
    clean = "+233" + clean.slice(1);
  } else if (clean.startsWith("233") && !clean.startsWith("+")) {
    clean = "+" + clean;
  } else if (!clean.startsWith("+")) {
    clean = "+" + clean;
  }
  return clean;
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.endsWith("@lid")) return null;
  const clean = raw.replace(/\D/g, "");
  if (clean.length >= 14 && !clean.startsWith("233")) return null;
  if (clean.startsWith("0") && clean.length === 10) {
    return "233" + clean.slice(1);
  }
  if (clean.startsWith("233") && clean.length === 12) {
    return clean;
  }
  if (clean.length === 9) {
    return "233" + clean;
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
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") || config?.accountSid || "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") || config?.authToken || "";
  const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID") || Deno.env.get("TWILIO_API_KEY") || config?.apiKeySid || "";
  const apiSecret = Deno.env.get("TWILIO_API_KEY_SECRET") || Deno.env.get("TWILIO_API_SECRET") || config?.apiSecret || "";
  const rawFrom = Deno.env.get("TWILIO_WHATSAPP_NUMBER") || Deno.env.get("TWILIO_FROM_NUMBER") || config?.fromNumber || "";

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

export interface WaSenderMessageOptions {
  imageUrl?: string;
  videoUrl?: string;
  documentUrl?: string;
  audioUrl?: string;
  stickerUrl?: string;
  fileName?: string;
  contact?: Record<string, any>;
  location?: Record<string, any>;
}

/**
 * Send a WhatsApp message (text, image, video, document, audio/voice note, sticker, contact card, location)
 * or broadcast to a channel/group via WaSender API.
 * Endpoint: POST https://www.wasenderapi.com/api/send-message
 *
 * @param to - Recipient phone number (E.164), @handle, Group JID, Community Channel JID (@newsletter), or LID (@lid)
 * @param text - Optional message text / caption
 * @param optionsOrKey - Optional WaSenderMessageOptions object or string API key
 * @param apiKeyOverride - Optional API key if options object is passed
 */
export async function sendWaSenderMessage(
  to: string,
  text?: string,
  optionsOrKey?: string | WaSenderMessageOptions,
  apiKeyOverride?: string
): Promise<boolean> {
  const WHATSAPP_API_URL = Deno.env.get("WHATSAPP_API_URL") || "https://www.wasenderapi.com/api/send-message";

  let options: WaSenderMessageOptions | undefined;
  let explicitKey: string | undefined;

  if (typeof optionsOrKey === "string") {
    explicitKey = optionsOrKey;
  } else if (typeof optionsOrKey === "object" && optionsOrKey !== null) {
    options = optionsOrKey;
    explicitKey = apiKeyOverride;
  }

  const resolvedKey = explicitKey || Deno.env.get("WHATSAPP_API_KEY") || "";

  if (!resolvedKey) {
    console.warn("[WaSender] No API key available. Message not sent:", text ? text.slice(0, 80) : "media message");
    return false;
  }

  // Format destination: if channel, group, lid, or username, keep as is. Otherwise format international.
  let formattedTo = to.trim();
  const digits = formattedTo.replace(/\D/g, "");
  if (!formattedTo.includes("@") && digits.length >= 14 && !digits.startsWith("233")) {
    formattedTo = `${digits}@lid`;
  }

  if (
    !formattedTo.endsWith("@newsletter") &&
    !formattedTo.endsWith("@g.us") &&
    !formattedTo.endsWith("@lid") &&
    !formattedTo.startsWith("@")
  ) {
    formattedTo = formatWhatsAppRecipient(to);
  }

  const payload: Record<string, any> = { to: formattedTo };
  if (text) payload.text = text;
  if (options?.imageUrl) payload.imageUrl = options.imageUrl;
  if (options?.videoUrl) payload.videoUrl = options.videoUrl;
  if (options?.documentUrl) payload.documentUrl = options.documentUrl;
  if (options?.audioUrl) payload.audioUrl = options.audioUrl;
  if (options?.stickerUrl) payload.stickerUrl = options.stickerUrl;
  if (options?.fileName) payload.fileName = options.fileName;
  if (options?.contact) payload.contact = options.contact;
  if (options?.location) payload.location = options.location;

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
        body: JSON.stringify(payload),
      });

      const limitRemaining = res.headers.get("X-RateLimit-Remaining");
      const dailyRemaining = res.headers.get("X-RateLimit-Daily-Remaining");
      if (limitRemaining !== null && Number(limitRemaining) <= 5) {
        console.warn(`[WaSender RateLimit] Warning: Only ${limitRemaining} requests remaining in window (reset in ${res.headers.get("X-RateLimit-Reset")}s).`);
      }
      if (dailyRemaining !== null && Number(dailyRemaining) <= 20) {
        console.warn(`[WaSender RateLimit] Warning: Only ${dailyRemaining} requests remaining in daily cap.`);
      }

      const resJson = await res.json().catch(() => null);

      if (res.ok && resJson?.success !== false) {
        console.log("[WaSender] Sent message to", formattedTo);
        return true;
      }

      const errMessage = resJson?.message || (typeof resJson === "string" ? resJson : "Unknown error");
      console.error(`[WaSender] Send failed (attempt ${attempts}/${maxAttempts}):`, res.status, errMessage);

      // If the session is disconnected in Wasender, retrying immediately is useless and worsens flood
      if (typeof errMessage === "string" && errMessage.toLowerCase().includes("session is not connected")) {
        console.warn(`[WaSender] Session disconnected detected for ${formattedTo}. Aborting retries.`);
        return false;
      }

      if (res.status === 429 && attempts < maxAttempts) {
        let retryAfter = 5; // Default safe buffer for Account Protection (1 req / 5s)
        const headerRetry = res.headers.get("Retry-After") || res.headers.get("X-RateLimit-Reset");
        if (headerRetry && !isNaN(Number(headerRetry))) {
          retryAfter = Math.max(1, Number(headerRetry));
        } else if (typeof resJson?.retry_after === "number") {
          retryAfter = resJson.retry_after;
        }

        console.log(`[WaSender] Rate limited (429). Retrying after ${retryAfter} seconds (attempt ${attempts + 1}/${maxAttempts})...`);
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

// In-memory cache for contact verification (24 hour TTL) to stay well under WhatsApp limits
const onWhatsAppCache = new Map<string, { exists: boolean; expiresAt: number; data?: any }>();

/**
 * Verifies if a given phone number, WhatsApp JID, or username handle is registered on WhatsApp via WaSender API.
 * Endpoint: GET https://www.wasenderapi.com/api/on-whatsapp/{contact_identifier}
 * Cached for 24 hours to comply with WaSender rate limits (10-60 req/min).
 *
 * @param contactIdentifier - Phone number (+233..., 024...), WhatsApp JID (1234567890@s.whatsapp.net), or handle
 * @param apiKey - Optional WaSender API key override. Defaults to WHATSAPP_API_KEY environment secret.
 */
export async function checkIsOnWhatsApp(
  contactIdentifier: string,
  apiKey?: string
): Promise<{ success: boolean; exists: boolean; data?: any; error?: string }> {
  let identifier = String(contactIdentifier || "").trim();
  if (!identifier) {
    return { success: false, exists: false, error: "Empty contact identifier" };
  }

  // Format clean JID or digits (no '+', no spaces)
  let clean = identifier.replace(/\s+/g, "").replace(/-/g, "").replace(/^whatsapp:/i, "").replace(/^\+/, "");
  if (clean.startsWith("0") && clean.length === 10) {
    clean = "233" + clean.slice(1);
  }
  if (!clean.includes("@")) {
    clean = `${clean}@s.whatsapp.net`;
  }
  identifier = clean;

  // Check in-memory cache first to avoid high-risk endpoint overuse
  const cached = onWhatsAppCache.get(identifier);
  if (cached && Date.now() < cached.expiresAt) {
    return { success: true, exists: cached.exists, data: cached.data };
  }

  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    console.warn("[WaSender on-whatsapp] No API key available to verify contact:", contactIdentifier);
    return { success: false, exists: false, error: "Missing WaSender API Key (WHATSAPP_API_KEY)" };
  }

  const encodedPath = encodeURIComponent(identifier);
  const url = `https://wasenderapi.com/api/on-whatsapp/${encodedPath}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
      },
    });

    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.success !== false) {
      const exists = Boolean(json?.data?.exists ?? json?.exists);
      // Cache positive/negative existence for 24 hours
      onWhatsAppCache.set(identifier, {
        exists,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        data: json?.data || { exists },
      });

      return {
        success: true,
        exists,
        data: json?.data || { exists },
      };
    }

    if (json?.message && json.message.toLowerCase().includes("session is not connected")) {
      return {
        success: false,
        exists: false,
        error: "WhatsApp Session is not connected in Wasender. Please connect session first.",
      };
    }

    const errText = json?.message || (await res.text().catch(() => `HTTP ${res.status}`));
    console.error(`[WaSender on-whatsapp] Verification failed (${res.status}):`, errText);
    return {
      success: false,
      exists: false,
      error: `WaSender verification failed: ${errText}`,
    };
  } catch (err: any) {
    console.error("[WaSender on-whatsapp] Network/fetch error:", err?.message || err);
    return {
      success: false,
      exists: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Check live WhatsApp session status & user details via WaSender API.
 * Endpoint: GET https://wasenderapi.com/api/status and /api/user
 */
export async function getWaSenderStatus(apiKey?: string): Promise<{
  connected: boolean;
  status: string;
  user?: any;
  error?: string;
}> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    return { connected: false, status: "no_api_key", error: "Missing WHATSAPP_API_KEY" };
  }
  try {
    const statusRes = await fetch("https://wasenderapi.com/api/status", {
      headers: { Authorization: `Bearer ${resolvedKey}` },
    });
    const statusJson = await statusRes.json().catch(() => ({}));
    const status = statusJson?.status || (statusRes.ok ? "unknown" : "error");
    const connected = status === "connected" || status === "open";

    let user = null;
    if (connected) {
      const userRes = await fetch("https://wasenderapi.com/api/user", {
        headers: { Authorization: `Bearer ${resolvedKey}` },
      });
      const userJson = await userRes.json().catch(() => ({}));
      if (userJson?.success && userJson?.data) {
        user = userJson.data;
      }
    }

    return { connected, status, user };
  } catch (err: any) {
    return { connected: false, status: "error", error: err?.message || String(err) };
  }
}

/**
 * Fetch all WhatsApp groups from connected WaSender session.
 * Endpoint: GET https://wasenderapi.com/api/groups
 */
export async function getWaSenderGroups(apiKey?: string): Promise<{
  success: boolean;
  groups: Array<{ id: string; name: string; participantsCount: number; isAnnounce?: boolean }>;
  error?: string;
}> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    return { success: false, groups: [], error: "Missing WHATSAPP_API_KEY" };
  }
  try {
    const res = await fetch("https://wasenderapi.com/api/groups", {
      headers: { Authorization: `Bearer ${resolvedKey}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return { success: false, groups: [], error: json?.message || "Failed to fetch groups from WaSender" };
    }
    const list = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
    const groups = list.map((g: any) => ({
      id: g.id || g.jid,
      name: g.subject || g.name || "Unnamed Group",
      participantsCount: Array.isArray(g.participants) ? g.participants.length : (g.size || 0),
      isAnnounce: Boolean(g.announce || g.isAnnounce)
    }));
    return { success: true, groups };
  } catch (err: any) {
    return { success: false, groups: [], error: err?.message || String(err) };
  }
}

/**
 * List all WhatsApp sessions under account via WaSender API.
 * Endpoint: GET https://wasenderapi.com/api/whatsapp-sessions
 * Requires Personal Access Token (from wasenderapi.com/settings/tokens)
 */
export async function getWaSenderSessions(personalToken?: string): Promise<{
  success: boolean;
  sessions: any[];
  error?: string;
}> {
  const token = personalToken || Deno.env.get("WASENDER_PERSONAL_ACCESS_TOKEN") || Deno.env.get("WASENDER_TOKEN") || "";
  if (!token) {
    return { success: false, sessions: [], error: "Missing WaSender Personal Access Token (WASENDER_PERSONAL_ACCESS_TOKEN)" };
  }

  try {
    const res = await fetch("https://wasenderapi.com/api/whatsapp-sessions", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return { success: false, sessions: [], error: json?.message || `Failed to fetch sessions (${res.status})` };
    }

    const sessions = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
    return { success: true, sessions };
  } catch (err: any) {
    return { success: false, sessions: [], error: err?.message || String(err) };
  }
}

/**
 * Connects a WhatsApp session via WaSender API using QR code or Passkey.
 * Endpoint: POST https://wasenderapi.com/api/whatsapp-sessions/{whatsappSession}/connect
 *
 * @param sessionId - Numeric or string ID of the WhatsApp session.
 * @param personalToken - Personal Access Token (Bearer token from wasenderapi.com/settings/tokens).
 * @param linkMethod - Optional linking method. "qr" or "passkey". Defaults to "qr".
 */
export async function connectWaSenderSession(
  sessionId: number | string,
  personalToken?: string,
  linkMethod: "qr" | "passkey" = "qr"
): Promise<{
  success: boolean;
  data?: {
    status: string;
    qrCode?: string;
    [key: string]: any;
  };
  error?: string;
}> {
  const token = personalToken || Deno.env.get("WASENDER_PERSONAL_ACCESS_TOKEN") || Deno.env.get("WASENDER_TOKEN") || "";
  if (!token) {
    return {
      success: false,
      error: "Missing WaSender Personal Access Token. Generate one at wasenderapi.com/settings/tokens.",
    };
  }

  const cleanSessionId = String(sessionId || "").trim();
  if (!cleanSessionId) {
    return { success: false, error: "Missing WhatsApp Session ID." };
  }

  try {
    const url = `https://wasenderapi.com/api/whatsapp-sessions/${encodeURIComponent(cleanSessionId)}/connect`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ linkMethod: linkMethod || "qr" }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return {
        success: false,
        error: json?.message || json?.error || `WaSender session connect failed (${res.status})`,
      };
    }

    return {
      success: true,
      data: json?.data || json,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Disconnects a WhatsApp session via WaSender API.
 * Endpoint: POST https://wasenderapi.com/api/whatsapp-sessions/{whatsappSession}/disconnect
 */
export async function disconnectWaSenderSession(
  sessionId: number | string,
  personalToken?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const token = personalToken || Deno.env.get("WASENDER_PERSONAL_ACCESS_TOKEN") || Deno.env.get("WASENDER_TOKEN") || "";
  if (!token) {
    return { success: false, error: "Missing WaSender Personal Access Token." };
  }

  const cleanSessionId = String(sessionId || "").trim();
  if (!cleanSessionId) {
    return { success: false, error: "Missing WhatsApp Session ID." };
  }

  try {
    const url = `https://wasenderapi.com/api/whatsapp-sessions/${encodeURIComponent(cleanSessionId)}/disconnect`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return { success: false, error: json?.message || `Failed to disconnect (${res.status})` };
    }

    return { success: true, message: json?.message || "Session disconnected successfully" };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Fetches WhatsApp username metadata for a contact via WaSender API.
 * Endpoint: GET https://www.wasenderapi.com/api/fetch-username/{contact_identifier}
 *
 * @param contactIdentifier - Phone number (+123..., 024...), WhatsApp JID (1234567890@s.whatsapp.net), LID JID (1234567890@lid), or @handle
 * @param apiKey - Optional WaSender API key override. Defaults to WHATSAPP_API_KEY environment secret.
 */
export async function fetchWhatsAppUsername(
  contactIdentifier: string,
  apiKey?: string
): Promise<{ success: boolean; data?: { jid?: string; username?: string }; error?: string }> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    console.warn("[WaSender fetch-username] No API key available for:", contactIdentifier);
    return { success: false, error: "Missing WaSender API Key (WHATSAPP_API_KEY)" };
  }

  let identifier = String(contactIdentifier || "").trim();
  if (!identifier) {
    return { success: false, error: "Empty contact identifier" };
  }

  // If plain phone number, normalize to international format
  if (!identifier.includes("@")) {
    let clean = identifier.replace(/\s+/g, "").replace(/-/g, "").replace(/^whatsapp:/i, "");
    if (clean.startsWith("0") && clean.length === 10) {
      clean = "+233" + clean.slice(1);
    } else if (clean.startsWith("233") && !clean.startsWith("+")) {
      clean = "+" + clean;
    } else if (!clean.startsWith("+") && /^\d+$/.test(clean)) {
      clean = "+" + clean;
    }
    identifier = clean;
  }

  // URL-encode special characters (e.g. @ as %40) as required by WaSender API
  const encodedPath = encodeURIComponent(identifier);
  const url = `https://www.wasenderapi.com/api/fetch-username/${encodedPath}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        success: true,
        data: json?.data || json,
      };
    }

    const errText = await res.text();
    console.error(`[WaSender fetch-username] Failed (${res.status}):`, errText);
    return {
      success: false,
      error: `WaSender fetch-username failed (${res.status}): ${errText}`,
    };
  } catch (err: any) {
    console.error("[WaSender fetch-username] Network/fetch error:", err?.message || err);
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Helper to ensure a target is formatted as a WhatsApp JID (e.g. 1234567890@s.whatsapp.net).
 */
export function formatToWhatsAppJid(to: string): string {
  const clean = to.trim();
  if (clean.includes("@")) return clean;
  let digits = clean.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "233" + digits.slice(1);
  }
  return `${digits}@s.whatsapp.net`;
}

/**
 * Send a presence update (e.g. 'composing' typing indicator or 'recording') to a contact via WaSender API.
 * Endpoint: POST https://www.wasenderapi.com/api/send-presence-update
 *
 * @param jidOrPhone - Recipient JID (e.g. 1234567890@s.whatsapp.net) or local/international phone number
 * @param type - Presence state: 'composing' | 'recording' | 'available' | 'unavailable'
 * @param delayMs - Optional duration in milliseconds to show the presence indicator
 * @param apiKey - Optional WaSender API key override
 */
export async function sendWaSenderPresenceUpdate(
  jidOrPhone: string,
  type: "composing" | "recording" | "available" | "unavailable" = "composing",
  delayMs?: number,
  apiKey?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    console.warn("[WaSender presence] No API key available for presence update.");
    return { success: false, error: "Missing WaSender API Key (WHATSAPP_API_KEY)" };
  }

  const jid = formatToWhatsAppJid(jidOrPhone);
  const url = "https://www.wasenderapi.com/api/send-presence-update";

  const payload: any = { jid, type };
  if (typeof delayMs === "number" && delayMs > 0) {
    payload.delayMs = delayMs;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        success: true,
        data: json?.data || json,
      };
    }

    const errText = await res.text();
    console.error(`[WaSender presence] Failed (${res.status}):`, errText);
    return {
      success: false,
      error: `WaSender presence update failed (${res.status}): ${errText}`,
    };
  } catch (err: any) {
    console.error("[WaSender presence] Network error:", err?.message || err);
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Unified Typing Indicator dispatcher.
 * Tries WATI typing indicator, falls back to WaSender composing presence.
 */
export async function sendWhatsAppTypingIndicator(target: string): Promise<boolean> {
  const watiOk = await sendWatiTypingIndicator(target);
  if (watiOk) return true;
  const wasenderRes = await sendWaSenderPresenceUpdate(target, "composing", 3000);
  return wasenderRes.success;
}

/**
 * Decrypts an encrypted WhatsApp media file (image, video, audio, document, or sticker) via WaSender API.
 * Endpoint: POST https://www.wasenderapi.com/api/decrypt-media
 * Returns a temporary public URL valid for 1 hour.
 *
 * @param mediaInput - Raw incoming webhook message or structured media payload with url and mediaKey
 * @param apiKey - Optional WaSender API key override
 */
export async function decryptWaSenderMedia(
  mediaInput: any,
  apiKey?: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    console.warn("[WaSender decrypt-media] No API key available.");
    return { success: false, error: "Missing WaSender API Key (WHATSAPP_API_KEY)" };
  }

  let requestBody: any;

  if (mediaInput?.data?.messages) {
    requestBody = mediaInput;
  } else if (mediaInput?.messages?.key) {
    requestBody = { data: { messages: mediaInput.messages } };
  } else if (mediaInput?.key && mediaInput?.message) {
    requestBody = { data: { messages: mediaInput } };
  } else if (mediaInput?.url && mediaInput?.mediaKey) {
    const rawType = (mediaInput.mediaType || mediaInput.type || "image").toLowerCase();
    const messageField = rawType.endsWith("Message") ? rawType : `${rawType}Message`;
    const messageId = mediaInput.id || mediaInput.messageId || `msg_${Date.now()}`;

    requestBody = {
      data: {
        messages: {
          key: {
            id: messageId,
          },
          message: {
            [messageField]: {
              url: mediaInput.url,
              mimetype: mediaInput.mimetype || (rawType.includes("image") ? "image/jpeg" : "application/octet-stream"),
              mediaKey: mediaInput.mediaKey,
              fileSha256: mediaInput.fileSha256,
              fileLength: mediaInput.fileLength,
              fileName: mediaInput.fileName,
            },
          },
        },
      },
    };
  } else {
    requestBody = { data: mediaInput };
  }

  const url = "https://www.wasenderapi.com/api/decrypt-media";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        success: true,
        publicUrl: json?.publicUrl || json?.data?.publicUrl,
      };
    }

    const errText = await res.text();
    console.error(`[WaSender decrypt-media] Failed (${res.status}):`, errText);
    return {
      success: false,
      error: `WaSender decrypt-media failed (${res.status}): ${errText}`,
    };
  } catch (err: any) {
    console.error("[WaSender decrypt-media] Network error:", err?.message || err);
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Uploads a media file (image, video, audio, sticker, or document) to WaSender.
 * Endpoint: POST https://wasenderapi.com/api/upload
 * Supports raw binary (Uint8Array/ArrayBuffer/Blob) or Base64 string.
 * Returns a temporary public URL valid for 24 hours.
 *
 * @param fileData - Raw binary buffer or Base64 string (optionally with data: prefix)
 * @param mimeType - File MIME type (e.g. image/jpeg, application/pdf).
 * @param apiKey - Optional WaSender API key override
 */
export async function uploadWaSenderMedia(
  fileData: Uint8Array | ArrayBuffer | Blob | string,
  mimeType?: string,
  apiKey?: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  const url = "https://wasenderapi.com/api/upload";

  const headers: Record<string, string> = {};
  if (resolvedKey) {
    headers["Authorization"] = `Bearer ${resolvedKey}`;
  }

  let body: any;

  if (typeof fileData === "string") {
    // Base64 upload
    headers["Content-Type"] = "application/json";
    if (fileData.startsWith("data:")) {
      body = JSON.stringify({ base64: fileData });
    } else {
      body = JSON.stringify({
        base64: fileData,
        mimetype: mimeType || "image/jpeg",
      });
    }
  } else {
    // Raw binary upload
    headers["Content-Type"] = mimeType || "application/octet-stream";
    body = fileData;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        success: true,
        publicUrl: json?.publicUrl || json?.data?.publicUrl,
      };
    }

    const errText = await res.text();
    console.error(`[WaSender upload] Failed (${res.status}):`, errText);
    return {
      success: false,
      error: `WaSender upload failed (${res.status}): ${errText}`,
    };
  } catch (err: any) {
    console.error("[WaSender upload] Network error:", err?.message || err);
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Retrieves the Link ID (LID) associated with a real phone number JID via WaSender API.
 * Endpoint: GET https://www.wasenderapi.com/api/lid-from-pn/{pn}
 *
 * @param pn - Phone number or JID (e.g. 1234567890@s.whatsapp.net or +233241234567)
 * @param apiKey - Optional WaSender API key override
 */
export async function getLidFromPhoneNumber(
  pn: string,
  apiKey?: string
): Promise<{ success: boolean; lid?: string; error?: string }> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    return { success: false, error: "Missing WaSender API Key (WHATSAPP_API_KEY)" };
  }

  let formattedPn = pn.trim();
  if (!formattedPn.includes("@")) {
    let clean = formattedPn.replace(/\D/g, "");
    if (clean.startsWith("0") && clean.length === 10) clean = "233" + clean.slice(1);
    formattedPn = `${clean}@s.whatsapp.net`;
  }

  const encodedPn = encodeURIComponent(formattedPn);
  const url = `https://www.wasenderapi.com/api/lid-from-pn/${encodedPn}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        success: true,
        lid: json?.data?.lid || json?.lid,
      };
    }

    const errText = await res.text();
    console.error(`[WaSender lid-from-pn] Failed (${res.status}):`, errText);
    return { success: false, error: `WaSender lid-from-pn failed (${res.status}): ${errText}` };
  } catch (err: any) {
    console.error("[WaSender lid-from-pn] Network error:", err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Retrieves the real phone number JID (ending in @s.whatsapp.net) associated with a Link ID (LID).
 * Endpoint: GET https://www.wasenderapi.com/api/pn-from-lid/{lid}
 *
 * @param lid - Link ID ending with @lid (e.g. 1234567890@lid)
 * @param apiKey - Optional WaSender API key override
 */
export async function getPhoneNumberFromLid(
  lid: string,
  apiKey?: string
): Promise<{ success: boolean; pn?: string; error?: string }> {
  const resolvedKey = apiKey || Deno.env.get("WHATSAPP_API_KEY") || "";
  if (!resolvedKey) {
    return { success: false, error: "Missing WaSender API Key (WHATSAPP_API_KEY)" };
  }

  let formattedLid = lid.trim();
  if (!formattedLid.endsWith("@lid")) {
    formattedLid = `${formattedLid.replace(/@.*$/, "")}@lid`;
  }

  const encodedLid = encodeURIComponent(formattedLid);
  const url = `https://www.wasenderapi.com/api/pn-from-lid/${encodedLid}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${resolvedKey}`,
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      return {
        success: true,
        pn: json?.data?.pn || json?.pn,
      };
    }

    const errText = await res.text();
    console.error(`[WaSender pn-from-lid] Failed (${res.status}):`, errText);
    return { success: false, error: `WaSender pn-from-lid failed (${res.status}): ${errText}` };
  } catch (err: any) {
    console.error("[WaSender pn-from-lid] Network error:", err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Send a WhatsApp message via WATI API.
 * Uses official WATI API:
 * POST {endpoint}/api/v1/sendSessionMessage/{whatsappNumber}?messageText={text}
 *
 * @param to - Recipient phone number
 * @param text - Message text
 * @param config - Optional explicit WATI config overrides
 */
export async function sendWatiMessage(
  to: string,
  text: string,
  config?: { token?: string; endpoint?: string }
): Promise<boolean> {
  let token = Deno.env.get("WATI_TOKEN") || Deno.env.get("WATI_ACCESS_TOKEN") || Deno.env.get("WATI_API_KEY") || config?.token || "";
  let endpoint = Deno.env.get("WATI_ENDPOINT") || Deno.env.get("WATI_BASE_URL") || config?.endpoint || "";

  if (!token || !endpoint) {
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: settings } = await supabase
          .from("system_settings")
          .select("wati_token, wati_endpoint")
          .eq("id", 1)
          .maybeSingle();

        if (settings) {
          token = token || settings.wati_token || "";
          endpoint = endpoint || settings.wati_endpoint || "";
        }
      }
    } catch (dbErr) {
      console.warn("[WATI WhatsApp] Could not resolve WATI config from system_settings:", dbErr);
    }
  }

  if (!token) {
    return false;
  }

  endpoint = (endpoint || "https://live-mt-server.wati.io/10263110").replace(/\/+$/, "");

  let cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) {
    cleanPhone = "233" + cleanPhone.slice(1);
  }

  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    // 1. Ensure contact exists in WATI CRM (non-blocking background task)
    fetch(`${endpoint}/api/v1/addContact/${cleanPhone}`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: cleanPhone }),
    }).catch(() => {});

    // 2. Dispatch session message immediately
    const url = `${endpoint}/api/v1/sendSessionMessage/${cleanPhone}?messageText=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data && data.result === false) {
        console.warn(`[WATI WhatsApp] API returned result: false for ${cleanPhone}:`, data.info || data);
        return false;
      }
      console.log(`[WATI WhatsApp] Successfully sent to ${cleanPhone}`);
      return true;
    }

    const errText = await res.text();
    console.error(`[WATI WhatsApp] Send failed (${res.status}):`, errText);
    return false;
  } catch (err: any) {
    console.error("[WATI WhatsApp] Network/fetch error:", err?.message || err);
    return false;
  }
}

/**
 * Send an approved WhatsApp Template message via WATI API (V3 & V2).
 * Initiates new customer conversations or sends template broadcasts.
 *
 * @param to - Recipient phone number
 * @param templateName - Approved template name in WATI dashboard
 * @param parameters - Dynamic template parameters array [{ name: "1", value: "..." }]
 * @param config - Optional explicit WATI config overrides
 */
export async function sendWatiTemplateMessage(
  to: string,
  templateName: string,
  parameters: Array<{ name: string; value: string }> = [],
  config?: { token?: string; endpoint?: string; mediaUrl?: string }
): Promise<boolean> {
  let token = Deno.env.get("WATI_TOKEN") || Deno.env.get("WATI_ACCESS_TOKEN") || Deno.env.get("WATI_API_KEY") || config?.token || "";
  let endpoint = Deno.env.get("WATI_ENDPOINT") || Deno.env.get("WATI_BASE_URL") || config?.endpoint || "";

  if (!token || !endpoint) {
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: settings } = await supabase
          .from("system_settings")
          .select("wati_token, wati_endpoint")
          .eq("id", 1)
          .maybeSingle();

        if (settings) {
          token = token || settings.wati_token || "";
          endpoint = endpoint || settings.wati_endpoint || "";
        }
      }
    } catch { /* ignore DB lookup failure */ }
  }

  if (!token) return false;

  endpoint = (endpoint || "https://live-mt-server.wati.io/10263110").replace(/\/+$/, "");

  let cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) {
    cleanPhone = "233" + cleanPhone.slice(1);
  }

  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    const v2Url = `${endpoint}/api/v2/sendTemplateMessage?whatsappNumber=${cleanPhone}`;
    const payload: any = {
      template_name: templateName,
      broadcast_name: `swiftdata_${Date.now()}`,
      parameters: parameters,
    };

    if (config?.mediaUrl) {
      payload.media = { url: config.mediaUrl };
    }

    const res = await fetch(v2Url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data && data.result === false) {
        console.warn(`[WATI Template] API returned result: false for ${cleanPhone}:`, data.error || data);
        return false;
      }
      console.log(`[WATI Template] Successfully dispatched '${templateName}' to ${cleanPhone}`);
      return true;
    }

    const errText = await res.text();
    console.error(`[WATI Template] Dispatch failed (${res.status}):`, errText);
    return false;
  } catch (err: any) {
    console.error("[WATI Template] Error sending template message:", err?.message || err);
    return false;
  }
}

/**
 * Send template message via WATI API v3.
 * Endpoint: POST /api/ext/v3/messageTemplates/send
 */
export async function sendWatiV3TemplateMessage(
  to: string,
  templateName: string,
  broadcastName?: string,
  params: Array<{ name: string; value: string }> = [],
  config?: { token?: string; endpoint?: string; mediaUrl?: string }
): Promise<boolean> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return false;
  const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
  let cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) cleanPhone = "233" + cleanPhone.slice(1);

  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    const recipientObj: any = {
      phone_number: cleanPhone,
      custom_params: params,
    };

    if (config?.mediaUrl) {
      recipientObj.media_url = config.mediaUrl;
    }

    const res = await fetch(`${baseUrl}/api/ext/v3/messageTemplates/send`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_name: templateName,
        broadcast_name: broadcastName || `swiftdata_${Date.now()}`,
        recipients: [recipientObj]
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.success !== false;
    }
    return false;
  } catch (err: any) {
    console.error("[WATI v3 Template] Error:", err?.message || err);
    return false;
  }
}

/**
 * Schedule a WhatsApp template broadcast for future delivery via WATI API v3.
 * Endpoint: POST /api/ext/v3/messageTemplates/schedule
 */
export async function scheduleWatiTemplateMessage(
  to: string,
  templateName: string,
  scheduledAtUtcIso: string,
  broadcastName?: string,
  params: Array<{ name: string; value: string }> = [],
  config?: { token?: string; endpoint?: string }
): Promise<boolean> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return false;
  const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
  let cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) cleanPhone = "233" + cleanPhone.slice(1);

  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    const res = await fetch(`${baseUrl}/api/ext/v3/messageTemplates/schedule`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_name: templateName,
        broadcast_name: broadcastName || `scheduled_${Date.now()}`,
        scheduled_at: scheduledAtUtcIso,
        recipients: [
          {
            phone_number: cleanPhone,
            custom_params: params,
          }
        ]
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.success !== false;
    }
    return false;
  } catch (err: any) {
    console.error("[WATI Schedule Template] Error:", err?.message || err);
    return false;
  }
}

/**
 * Create a new WhatsApp Template programmatically in WATI.
 * Endpoint: POST /{tenantId}/api/v1/whatsApp/templates
 */
export async function createWatiTemplate(
  elementName: string,
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION",
  bodyText: string,
  language: string = "en",
  customParams: Array<{ paramName: string; paramValue: string }> = [],
  footerText?: string,
  config?: { token?: string; endpoint?: string },
  headerMedia?: { type: "none" | "text" | "image" | "document" | "video"; text?: string; link?: string }
): Promise<any> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  let endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return null;
  endpoint = (endpoint || "https://live-mt-server.wati.io/10263110").replace(/\/+$/, "");
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  let headerObj: any = { type: 0, typeString: "none" };

  if (headerMedia) {
    if (headerMedia.type === "image") {
      headerObj = { type: 2, headerTypeString: "image", typeString: "image", link: headerMedia.link || "" };
    } else if (headerMedia.type === "document") {
      headerObj = { type: 3, headerTypeString: "document", typeString: "document", link: headerMedia.link || "" };
    } else if (headerMedia.type === "video") {
      headerObj = { type: 4, headerTypeString: "video", typeString: "video", link: headerMedia.link || "" };
    } else if (headerMedia.type === "text" && headerMedia.text) {
      headerObj = { type: 1, headerTypeString: "text", typeString: "text", text: headerMedia.text };
    }
  }

  try {
    const res = await fetch(`${endpoint}/api/v1/whatsApp/templates`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "template",
        category,
        subCategory: "STANDARD",
        elementName,
        language,
        header: headerObj,
        body: bodyText,
        footer: footerText || "Powered by SwiftData",
        customParams,
        creationMethod: 0,
      }),
    });

    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch (err: any) {
    console.error("[WATI Create Template] Error:", err?.message || err);
    return null;
  }
}

/**
 * Get message details & delivery status by channel phoneNumber and localMessageId via WATI API.
 * Endpoint: GET /{tenantId}/api/v1/whatsApp/messages/{phoneNumber}/{localMessageId}
 *
 * @param channelPhoneNumber - Channel phone number with country code (e.g. 233...)
 * @param localMessageId - Message unique identifier
 * @param config - Optional explicit WATI config overrides
 */
export async function getWatiMessageStatus(
  channelPhoneNumber: string,
  localMessageId: string,
  config?: { token?: string; endpoint?: string }
): Promise<any | null> {
  const token = Deno.env.get("WATI_TOKEN") || Deno.env.get("WATI_ACCESS_TOKEN") || Deno.env.get("WATI_API_KEY") || config?.token || "";
  let endpoint = Deno.env.get("WATI_ENDPOINT") || Deno.env.get("WATI_BASE_URL") || config?.endpoint || "";

  if (!token) return null;

  endpoint = (endpoint || "https://live-mt-server.wati.io/10263110").replace(/\/+$/, "");
  const cleanPhone = channelPhoneNumber.replace(/\D/g, "");
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    const url = `${endpoint}/api/v1/whatsApp/messages/${cleanPhone}/${encodeURIComponent(localMessageId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": authHeader },
    });

    if (res.ok) {
      const data = await res.json();
      return data?.result || data;
    }
    return null;
  } catch (err: any) {
    console.error("[WATI Message Status] Fetch error:", err?.message || err);
    return null;
  }
}

/**
 * Get channels list (WhatsApp, Instagram, Messenger) via WATI API v3.
 * Endpoint: GET /api/ext/v3/channels
 */
export async function getWatiChannels(
  pageNumber: number = 1,
  pageSize: number = 20,
  config?: { token?: string; endpoint?: string }
): Promise<any | null> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return null;
  const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    const res = await fetch(`${baseUrl}/api/ext/v3/channels?page_number=${pageNumber}&page_size=${pageSize}`, {
      headers: { "Authorization": authHeader },
    });
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch (err: any) {
    console.error("[WATI Channels] Fetch error:", err?.message || err);
    return null;
  }
}

/**
 * Send typing indicator bubble to a WhatsApp contact via WATI API v3.
 * Endpoint: POST /api/ext/v3/conversations/typingIndicator
 */
export async function sendWatiTypingIndicator(
  targetPhone: string,
  config?: { token?: string; endpoint?: string }
): Promise<boolean> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return false;
  const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
  let cleanPhone = targetPhone.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) cleanPhone = "233" + cleanPhone.slice(1);
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    const res = await fetch(`${baseUrl}/api/ext/v3/conversations/typingIndicator`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target: cleanPhone }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.success === true;
    }
    return false;
  } catch (err: any) {
    console.error("[WATI Typing Indicator] Error:", err?.message || err);
    return false;
  }
}

/**
 * Send a file message via URL to an active conversation via WATI API v3.
 * Endpoint: POST /api/ext/v3/conversations/messages/fileViaUrl
 */
export async function sendWatiFileViaUrl(
  to: string,
  fileUrl: string,
  caption?: string,
  config?: { token?: string; endpoint?: string }
): Promise<boolean> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return false;
  const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
  let cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) cleanPhone = "233" + cleanPhone.slice(1);
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  try {
    const res = await fetch(`${baseUrl}/api/ext/v3/conversations/messages/fileViaUrl`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: cleanPhone,
        file_url: fileUrl,
        caption: caption || "",
      }),
    });

    if (res.ok) {
      return true;
    }
    return false;
  } catch (err: any) {
    console.error("[WATI Send File Via URL] Error:", err?.message || err);
    return false;
  }
}

/**
 * Send interactive buttons or list message to an active conversation via WATI API v3.
 * Endpoint: POST /api/ext/v3/conversations/messages/interactive
 */
export async function sendWatiInteractiveMessage(
  to: string,
  type: "buttons" | "list",
  interactiveData: {
    bodyText: string;
    headerText?: string;
    footerText?: string;
    buttonText?: string;
    buttons?: string[]; // Array of button titles (max 3)
    sections?: Array<{ title: string; rows: Array<{ title: string; description?: string }> }>;
  },
  config?: { token?: string; endpoint?: string }
): Promise<boolean> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return false;
  const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
  let cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) cleanPhone = "233" + cleanPhone.slice(1);
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  const payload: any = {
    target: cleanPhone,
    type,
  };

  if (type === "buttons") {
    payload.button_message = {
      header: interactiveData.headerText ? { type: "text", text: interactiveData.headerText } : undefined,
      body: interactiveData.bodyText,
      footer: interactiveData.footerText || "SwiftData Platform",
      buttons: (interactiveData.buttons || []).map((b) => ({ text: b })),
    };
  } else {
    payload.list_message = {
      header: interactiveData.headerText || "Options",
      body: interactiveData.bodyText,
      footer: interactiveData.footerText || "SwiftData Platform",
      button_text: interactiveData.buttonText || "Select Option",
      sections: interactiveData.sections || [],
    };
  }

  try {
    const res = await fetch(`${baseUrl}/api/ext/v3/conversations/messages/interactive`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      return true;
    }
    return false;
  } catch (err: any) {
    console.error("[WATI Interactive Message] Error:", err?.message || err);
    return false;
  }
}

/**
 * Send a WhatsApp message via Meta Official Cloud API (Facebook Graph API).
 * POST https://graph.facebook.com/v20.0/{phone_number_id}/messages
 *
 * @param to - Recipient phone number (digits with country code, e.g. 233...)
 * @param text - Message text
 * @param config - Optional explicit Meta Cloud API config overrides
 */
export async function sendMetaWhatsAppCloudMessage(
  to: string,
  text: string,
  config?: { phoneNumberId?: string; accessToken?: string }
): Promise<boolean> {
  let token = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") || Deno.env.get("WHATSAPP_CLOUD_API_TOKEN") || config?.accessToken || "";
  let phoneNumberId = Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID") || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || config?.phoneNumberId || "";

  if (!token || !phoneNumberId) {
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: settings } = await supabase
          .from("system_settings")
          .select("meta_whatsapp_access_token, meta_whatsapp_phone_number_id")
          .eq("id", 1)
          .maybeSingle();

        if (settings) {
          token = token || settings.meta_whatsapp_access_token || "";
          phoneNumberId = phoneNumberId || settings.meta_whatsapp_phone_number_id || "";
        }
      }
    } catch {
      /* ignore DB lookup error */
    }
  }

  if (!token || !phoneNumberId) {
    return false;
  }

  let cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) {
    cleanPhone = "233" + cleanPhone.slice(1);
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });

    if (res.ok) {
      console.log(`[Meta Cloud API WhatsApp] Successfully sent to ${cleanPhone}`);
      return true;
    }

    const errText = await res.text();
    console.error(`[Meta Cloud API WhatsApp] Send failed (${res.status}):`, errText);
    return false;
  } catch (err: any) {
    console.error("[Meta Cloud API WhatsApp] Network error:", err?.message || err);
    return false;
  }
}

/**
 * Unified WhatsApp Dispatcher.
 * Prioritizes:
 * 1. WATI API
 * 2. Meta Official WhatsApp Cloud API (Graph API)
 * 3. Twilio WhatsApp API
 * 4. WaSender API
 *
 * @param to - Recipient phone number
 */
const recentMessageDedupCache = new Map<string, number>();

export async function sendWhatsAppMessage(to: string, text: string, apiKey?: string) {
  if (!to || !text) return;
  const cleanTo = normalizePhone(to) || to.replace(/\D/g, "");
  if (!cleanTo || cleanTo.length < 9) return;

  // Anti-Ban Safeguard: Deduplication flood protection (prevents double replies within 3.5s)
  const dedupKey = `${cleanTo}:${text.trim().slice(0, 100)}`;
  const now = Date.now();
  const lastSent = recentMessageDedupCache.get(dedupKey);
  if (lastSent && now - lastSent < 3500) {
    console.log(`[WhatsApp Anti-Ban] Skipped duplicate message to ${cleanTo} within 3.5s`);
    return;
  }
  recentMessageDedupCache.set(dedupKey, now);

  if (recentMessageDedupCache.size > 500) {
    for (const [k, ts] of recentMessageDedupCache.entries()) {
      if (now - ts > 120000) recentMessageDedupCache.delete(k);
    }
  }

  // 1. Primary: WATI API
  const watiSuccess = await sendWatiMessage(to, text);
  if (watiSuccess) return;

  // 2. Secondary: Meta Official WhatsApp Cloud API
  const metaSuccess = await sendMetaWhatsAppCloudMessage(to, text);
  if (metaSuccess) return;

  // 3. Tertiary: Twilio WhatsApp API
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

  // 3. Tertiary / Fallback: WaSender API
  await sendWaSenderMessage(to, text, apiKey);
}

/**
 * Automated Transactional WhatsApp Order Receipt
 * Dispatches an instant WhatsApp push receipt to the customer when an order is completed.
 */
export async function sendWhatsAppOrderReceipt(
  to: string,
  order: {
    id: string;
    network?: string;
    package_size?: string;
    amount?: number | string;
    order_type?: string;
    customer_phone?: string;
    token?: string | null;
    vouchers?: Array<{ serial: string; pin: string; type?: string }>;
  }
): Promise<void> {
  try {
    if (!to) return;
    const cleanTo = normalizePhone(to) || to.replace(/\D/g, "");
    if (!cleanTo || cleanTo.length < 9) return;

    const isUtility = order.order_type === "utility";
    const isVoucher = order.order_type === "voucher" || (order.vouchers && order.vouchers.length > 0);
    const networkName = order.network || "";
    const packageName = order.package_size || "";
    const isAirtime = String(packageName).toUpperCase() === "AIRTIME";

    let displayPackage = `${networkName} ${packageName}`.trim();
    if (isAirtime) {
      displayPackage = `${networkName} GHS ${Number(order.amount || 0).toFixed(2)} Airtime`;
    }

    let msg = "";
    if (isUtility && order.token) {
      msg = [
        `⚡ *ECG Prepaid Token Generated!* 💡`,
        ``,
        `🔢 *Token:* *${order.token}*`,
        `📟 *Meter No:* ${order.customer_phone || to}`,
        `💰 *Amount:* GHS ${Number(order.amount || 0).toFixed(2)}`,
        `🆔 *Order ID:* ${order.id}`,
        ``,
        `_Enter the 20-digit token into your meter to load credit._`,
        `Thank you for choosing SwiftData Ghana! 🇬🇭`,
      ].join("\n");
    } else if (isVoucher && order.vouchers && order.vouchers.length > 0) {
      const vText = order.vouchers
        .map((v, i) => `📜 *Voucher ${i + 1}:*\n  • Serial: *${v.serial}*\n  • PIN: *${v.pin}*`)
        .join("\n\n");
      msg = [
        `🎓 *WAEC Results Checker Delivered!* 📜`,
        ``,
        vText,
        ``,
        `🆔 *Order ID:* ${order.id}`,
        `🌐 *Check Results:* https://ghana.waecdirect.org`,
        ``,
        `Thank you for choosing SwiftData Ghana! 🇬🇭`,
      ].join("\n");
    } else {
      msg = [
        `✅ *Order Delivered!* 🚀`,
        ``,
        `Your *${displayPackage}* order for *${order.customer_phone || to}* has been successfully delivered.`,
        ``,
        `🆔 *Order ID:* ${order.id}`,
        `💰 *Amount:* GHS ${Number(order.amount || 0).toFixed(2)}`,
        `⚡ *Status:* Delivered`,
        ``,
        `Thank you for choosing SwiftData Ghana! 🇬🇭`,
        `_Need assistance? Reply directly to this message._`,
      ].join("\n");
    }

    await sendWhatsAppMessage(cleanTo, msg);
  } catch (err) {
    console.error("[WhatsApp Push] Failed to send order receipt:", err);
  }
}

/**
 * Automated Transactional WhatsApp Wallet Top-Up Alert
 */
export async function sendWhatsAppWalletCredit(
  to: string,
  details: {
    amount: number | string;
    newBalance?: number | string;
    reference?: string;
  }
): Promise<void> {
  try {
    if (!to) return;
    const cleanTo = normalizePhone(to) || to.replace(/\D/g, "");
    if (!cleanTo || cleanTo.length < 9) return;

    const msg = [
      `💰 *Wallet Top-Up Confirmed!* 🚀`,
      ``,
      `Your SwiftData wallet has been credited with *GHS ${Number(details.amount).toFixed(2)}*.`,
      details.newBalance !== undefined ? `💳 *New Balance:* GHS ${Number(details.newBalance).toFixed(2)}` : null,
      details.reference ? `🆔 *Ref:* ${details.reference}` : null,
      ``,
      `You can now buy data bundles, airtime, and utility tokens instantly.`,
      `👉 Order now: https://swiftdatagh.shop`,
    ].filter(Boolean).join("\n");

    await sendWhatsAppMessage(cleanTo, msg);
  } catch (err) {
    console.error("[WhatsApp Push] Failed to send wallet top-up receipt:", err);
  }
}

/**
 * Get existing chatbots list via WATI V3 API (with V1 fallback).
 * Endpoint: GET /api/ext/v3/chatbots
 * Legacy Endpoint: GET /{tenantId}/api/v1/chatbots
 */
export async function getWatiChatbots(
  pageNumber: number = 1,
  pageSize: number = 50,
  config?: { token?: string; endpoint?: string }
): Promise<{ chatbot_list: Array<{ id: string; name: string; created?: string }>; page_number?: number; page_size?: number } | null> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token) return null;

  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  // Try V3 first
  try {
    const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
    const url = `${baseUrl}/api/ext/v3/chatbots?page_number=${pageNumber}&page_size=${pageSize}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": authHeader },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.chatbot_list)) {
        return data;
      }
    }
  } catch (err: any) {
    console.warn("[WATI Chatbots V3] Fetch error:", err?.message || err);
  }

  // Fallback to V1 if V3 fails or tenantId path is present in endpoint
  try {
    const v1Endpoint = (endpoint || "https://live-mt-server.wati.io/10263110").replace(/\/+$/, "");
    const res = await fetch(`${v1Endpoint}/api/v1/chatbots`, {
      method: "GET",
      headers: { "Authorization": authHeader },
    });

    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        return {
          chatbot_list: list,
          page_number: pageNumber,
          page_size: pageSize,
        };
      }
    }
  } catch (err: any) {
    console.error("[WATI Chatbots V1] Fetch error:", err?.message || err);
  }

  return null;
}

/**
 * Start a chatbot flow for a recipient via WATI V3 API (with V1 fallback).
 * Endpoint: POST /api/ext/v3/chatbots/start
 * Legacy Endpoint: POST /{tenantId}/api/v1/chatbots/start
 */
export async function startWatiChatbot(
  targetPhoneOrId: string,
  chatbotId: string,
  config?: { token?: string; endpoint?: string }
): Promise<boolean> {
  const token = Deno.env.get("WATI_TOKEN") || config?.token || "";
  const endpoint = Deno.env.get("WATI_ENDPOINT") || config?.endpoint || "";

  if (!token || !chatbotId) return false;

  let cleanTarget = targetPhoneOrId.replace(/\D/g, "");
  if (cleanTarget.startsWith("0") && cleanTarget.length === 10) {
    cleanTarget = "233" + cleanTarget.slice(1);
  }
  if (!cleanTarget) cleanTarget = targetPhoneOrId;

  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  // Try V3 first
  try {
    const baseUrl = (endpoint || "https://live-mt-server.wati.io").replace(/\/\d+$/, "").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/api/ext/v3/chatbots/start`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target: cleanTarget,
        chatbot_id: chatbotId,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.result !== false) {
        console.log(`[WATI Start Chatbot V3] Successfully started chatbot '${chatbotId}' for '${cleanTarget}'`);
        return true;
      }
    }
  } catch (err: any) {
    console.warn("[WATI Start Chatbot V3] Error:", err?.message || err);
  }

  // Fallback to V1 if V3 fails
  try {
    const v1Endpoint = (endpoint || "https://live-mt-server.wati.io/10263110").replace(/\/+$/, "");
    const url = `${v1Endpoint}/api/v1/chatbots/start?chatbotId=${encodeURIComponent(chatbotId)}&target=${encodeURIComponent(cleanTarget)}&whatsappNumber=${encodeURIComponent(cleanTarget)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": authHeader },
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.result !== false) {
        console.log(`[WATI Start Chatbot V1] Successfully started chatbot '${chatbotId}' for '${cleanTarget}'`);
        return true;
      }
    }
  } catch (err: any) {
    console.error("[WATI Start Chatbot V1] Error:", err?.message || err);
  }

  return false;
}

/**
 * Automated "Delivery is on Fire" Channel Alert
 *
 * Checks if 2 or more orders have been fulfilled recently in the backend.
 * If yes (and cooldown elapsed), automatically posts an announcement
 * to the official WhatsApp Channel with the site link and WhatsApp bot link.
 */
export async function checkAndTriggerDeliveryOnFire(
  supabaseAdmin: any,
  options?: {
    siteUrl?: string;
    botNumber?: string;
    channelJid?: string;
    windowMinutes?: number;
    cooldownMinutes?: number;
    force?: boolean;
    minOrders?: number;
  }
): Promise<boolean> {
  try {
    const windowMins = options?.windowMinutes || 60;
    const cooldownMins = options?.cooldownMinutes || 30;
    const windowStart = new Date(Date.now() - windowMins * 60 * 1000).toISOString();
    const cooldownStart = new Date(Date.now() - cooldownMins * 60 * 1000).toISOString();

    // 1. Check cooldown unless forced
    if (!options?.force) {
      const { data: recentAlert } = await supabaseAdmin
        .from("system_logs")
        .select("ts")
        .eq("event", "broadcast.delivery_fire")
        .gte("ts", cooldownStart)
        .limit(1)
        .maybeSingle();

      if (recentAlert) {
        return false;
      }
    }

    // 2. Count fulfilled orders in the recent window (Threshold: 20+ successful fulfillments)
    const { data: fulfilledOrders, error } = await supabaseAdmin
      .from("orders")
      .select("id, status, updated_at, network, package_size")
      .eq("status", "fulfilled")
      .gte("updated_at", windowStart)
      .limit(100);

    const minThreshold = options?.minOrders || 20;
    if (error || !fulfilledOrders || fulfilledOrders.length < minThreshold) {
      if (!options?.force) return false;
    }

    const orderCount = fulfilledOrders?.length || minThreshold;

    // 3. Resolve Channel JID, Bot Number, Site URL
    const targetChannelJid =
      options?.channelJid ||
      Deno.env.get("WHATSAPP_CHANNEL_JID") ||
      "120363425720623850@newsletter";

    let targetBotNumber = options?.botNumber || Deno.env.get("WHATSAPP_BOT_NUMBER");
    const targetSiteUrl = options?.siteUrl || "https://swiftdatagh.shop";
    let targetChannelLink = "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40";

    if (!targetBotNumber) {
      const { data: settings } = await supabaseAdmin
        .from("system_settings")
        .select("mashup_whatsapp_number, customer_service_number, support_channel_link")
        .eq("id", 1)
        .maybeSingle();

      targetBotNumber =
        settings?.mashup_whatsapp_number ||
        settings?.customer_service_number ||
        "12139035565";

      if (settings?.support_channel_link) {
        targetChannelLink = settings.support_channel_link;
      }
    }

    let cleanBotPhone = String(targetBotNumber || "12139035565").replace(/\D/g, "");
    if (cleanBotPhone.startsWith("0") && cleanBotPhone.length === 10) {
      cleanBotPhone = "233" + cleanBotPhone.slice(1);
    }
    if (!cleanBotPhone.startsWith("233") && !cleanBotPhone.startsWith("1") && cleanBotPhone.length === 9) {
      cleanBotPhone = "233" + cleanBotPhone;
    }

    // 4. Construct high-conversion dynamic delivery fire alert message
    const headline = orderCount >= 50 ? `🔥 *50+ ORDERS DELIVERED & COUNTING!* ⚡🚀` : `🔥 *DELIVERY IS ON FIRE!* ⚡🚀`;
    const subline = orderCount >= 10
      ? `Over *${orderCount} data bundles & telecom orders* have just been successfully fulfilled in real-time with zero delays! 🇬🇭✨`
      : `Our automated engine just delivered *${orderCount} orders* in under 5 minutes with zero delays! High-speed delivery is 100% active on all networks right now! 🇬🇭⚡`;

    const message = [
      headline,
      ``,
      `*Automated Delivery Engine is 100% ACTIVE!*`,
      subline,
      ``,
      `📶 *MTN Bundles* (SME, Retail, MashUp, Social, Midnight)`,
      `📶 *Telecel Bundles* (Instant automated top-ups)`,
      `📶 *AirtelTigo Bundles* (Instant data delivery)`,
      `📱 *Airtime Recharge* (All networks)`,
      `💡 *ECG & Utility Bills* (Prepaid meter tokens & postpaid)`,
      `🎓 *WAEC Result Checkers* (WASSCE & BECE Instant PINs)`,
      ``,
      `👉 *Order via Website:* ${targetSiteUrl}`,
      `🤖 *Order via WhatsApp Bot:* https://wa.me/${cleanBotPhone}?text=Hi`,
      `📢 *Official WhatsApp Channel:* ${targetChannelLink}`,
      ``,
      `_Place your order right now and receive it within seconds! 🚀💨_`
    ].join("\n");

    const sent = await sendWaSenderMessage(targetChannelJid, message);

    if (sent) {
      try {
        await supabaseAdmin.from("system_logs").insert({
          level: "info",
          source: "auto_delivery_fire",
          event: "broadcast.delivery_fire",
          message: `Automatic "Delivery is on Fire" alert dispatched to WhatsApp Channel (${targetChannelJid}) after ${orderCount} recent fulfillments`,
          data: {
            fulfilledCount: orderCount,
            channel_jid: targetChannelJid,
            botNumber: cleanBotPhone,
            siteUrl: targetSiteUrl
          }
        });
      } catch (logErr) {
        console.error("Failed to log delivery fire alert:", logErr);
      }
      console.log(`[Delivery On Fire] Alert successfully posted to ${targetChannelJid}`);
      return true;
    }

    return false;
  } catch (err: any) {
    console.error("[Delivery On Fire] Error checking or triggering alert:", err?.message || err);
    return false;
  }
}


