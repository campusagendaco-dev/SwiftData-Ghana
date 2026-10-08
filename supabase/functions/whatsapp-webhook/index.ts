import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendWhatsAppMessage, checkIsOnWhatsApp, getWaSenderStatus } from "../_shared/whatsapp.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
import { isNonRetryableTerminalError } from "../_shared/providers/utils.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://swiftdatagh.shop";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

let cachedPaystackKey = "";
async function getPaystackSecretKey(supabase: any): Promise<string> {
  if (cachedPaystackKey) return cachedPaystackKey;
  try {
    const { data: settings } = await supabase
      .from("v_system_settings_with_secrets").select("paystack_secret_key")
      .eq("id", 1)
      .maybeSingle();
    if (settings?.paystack_secret_key) {
      cachedPaystackKey = settings.paystack_secret_key;
      return cachedPaystackKey;
    }
  } catch (err) {
    console.error("Failed to fetch paystack_secret_key from DB in whatsapp-webhook:", err);
  }
  cachedPaystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  return cachedPaystackKey;
}

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100; // GHS
const WHATSAPP_BOT_NUMBER = Deno.env.get("WHATSAPP_BOT_NUMBER") || "12139035565";

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("233") && d.length === 12) d = "0" + d.slice(3);
  if (d.length === 9) d = "0" + d;
  return d;
}

function getPaymentProvider(phone: string): string {
  const norm = normalizePhone(phone);
  if (norm.startsWith("020") || norm.startsWith("050")) return "vod";
  if (norm.startsWith("027") || norm.startsWith("057") || norm.startsWith("026") || norm.startsWith("056")) return "atl";
  return "mtn";
}

function normalizeNetworkKey(network: string): "MTN" | "MTN Mash Up" | "Telecel" | "AirtelTigo" {
  const n = network.trim().toUpperCase();
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return "AirtelTigo";
  if (n === "VODAFONE" || n === "TELECEL") return "Telecel";
  if (n === "MTN MASH UP" || n === "MTN_MASH_UP" || n === "MTN MASHUP" || n === "MTN MASH-UP" || n === "MASHUP" || n === "MASH UP") return "MTN Mash Up";
  return "MTN";
}

function addPaystackFee(base: number): number {
  return parseFloat((base + Math.min(base * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP)).toFixed(2));
}

function feeAmount(base: number): number {
  return parseFloat(Math.min(base * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP).toFixed(2));
}

function parseQuickOrderText(text: string): { network: string; packageSize: string; recipient: string } | null {
  const clean = text.trim();
  if (clean.length < 7) return null;

  // 1. Look for Ghanaian 10-digit number (e.g. 0244123456) or 233...
  const phoneMatch = text.match(/\b(0[235][0-9]{8}|233[235][0-9]{8})\b/);
  if (!phoneMatch) return null;
  const recipient = normalizePhone(phoneMatch[1]);
  if (!recipient || recipient.length !== 10) return null;

  // 2. Identify network if mentioned, or infer from phone prefix
  let network = "";
  if (/\b(mtn|yello)\b/i.test(text)) network = "MTN";
  else if (/\b(telecel|vodafone|voda)\b/i.test(text)) network = "Telecel";
  else if (/\b(airteltigo|airtel|tigo|at)\b/i.test(text)) network = "AirtelTigo";

  if (!network) {
    if (recipient.startsWith("024") || recipient.startsWith("054") || recipient.startsWith("055") || recipient.startsWith("059") || recipient.startsWith("053") || recipient.startsWith("025")) {
      network = "MTN";
    } else if (recipient.startsWith("020") || recipient.startsWith("050")) {
      network = "Telecel";
    } else if (recipient.startsWith("027") || recipient.startsWith("057") || recipient.startsWith("026") || recipient.startsWith("056")) {
      network = "AirtelTigo";
    }
  }
  if (!network) return null;

  // 3. Extract bundle size: e.g. 1GB, 2GB, 3GB, 5GB, 10GB, 500MB
  const sizeMatch = text.match(/\b(\d+(?:\.\d+)?\s*(?:gb|mb|gig|gigs))\b/i);
  if (!sizeMatch) return null;
  let packageSize = sizeMatch[1].toUpperCase().replace(/\s+/g, "");
  packageSize = packageSize.replace("GIGS", "GB").replace("GIG", "GB");

  return { network, packageSize, recipient };
}

function formatMoreMenu(storeTitle: string): string {
  return [
    `➕ *More Services & Utility Bills*`,
    `_Powered by ${storeTitle}_ 🇬🇭`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*1* — 💡 ECG Electricity (Prepaid Meter Tokens & Postpaid)`,
    `*2* — 💧 Water & Pay TV Bills (GWCL, DStv, GOtv, StarTimes)`,
    `*3* — 🎓 WAEC Result Checker (WASSCE & BECE Instant PIN)`,
    `*4* — 🛡️ Verify MTN Beneficiary (Whitelist Status Check)`,
    `*5* — 💰 Wallet Balance & Instant Top-Up`,
    `*6* — 📋 Recent Orders History`,
    `*7* — 🎧 Live Support & Customer Care (0598170947)`,
    `*8* — 💼 Reseller Agent Program (Become an Agent)`,
    `*9* — 📢 Official WhatsApp Channel`,
    `*10* — 🔌 Developer API Integration`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Reply with 1 to 10 — or reply 0 for Main Menu._`
  ].join("\n");
}

function formatMainMenu(
  agent: Agent | null,
  storeName: string,
  senderProfile: any,
  senderProfileMeta: UserProfileAndWallet | null,
  isSenderAdmin: boolean,
  isSenderAgent: boolean,
  whatsappBotNumber: string,
  reorderOrder?: any
): string {
  const reorderLines: string[] = [];
  if (reorderOrder && (reorderOrder.package_size || reorderOrder.amount)) {
    const pkgDesc = reorderOrder.package_size
      ? `${reorderOrder.network} ${reorderOrder.package_size}`
      : `${reorderOrder.network} GH₵ ${Number(reorderOrder.amount).toFixed(2)} Airtime`;
    reorderLines.push(
      `⚡ *1-TAP FAST REORDER AVAILABLE:*`,
      `Reply *YES* to quickly repeat your last order:`,
      `👉 *${pkgDesc}* for \`${reorderOrder.customer_phone}\``,
      ``
    );
  }

  const agentCodeStr = (senderProfile?.referral_code || senderProfile?.slug || "").toUpperCase();
  const agentBar = isSenderAgent ? [
    `💼 *Agent Terminal Active:* *${senderProfile?.store_name || senderProfile?.full_name}*`,
    `💳 *Wallet:* GH₵ ${(senderProfileMeta?.walletBalance || 0).toFixed(2)}`,
    `🏷️ *Your Agent Code:* *${agentCodeStr}*`,
    `👉 *Your Bot Link:* \`https://wa.me/${whatsappBotNumber}?text=Hi+${agentCodeStr}\``,
    `_(Share with your customers so they order directly with your prices!)_`,
    ``
  ] : [];

  const modeHint = isSenderAdmin
    ? `_🛡️ Admin Detected: Reply *ADMIN* to switch to Admin Terminal._`
    : (isSenderAgent
      ? `_💼 Agent Detected: Reply *AGENT* to switch to Agent Hub._`
      : `_🏷️ Have an Agent Code? Reply *CODE <your_code>* to connect to your agent!_`);

  if (!agent) {
    return [
      `⚡ *SwiftData Ghana* (@swiftdatagh)`,
      `👋 *Welcome to SwiftData Ghana!*`,
      `_Ghana's #1 Automated Telecommunications & Data Hub_ 🇬🇭`,
      ``,
      ...agentBar,
      ...reorderLines,
      `How can we serve you today?`,
      ``,
      `*1* — 📶 Buy Data (MTN, Telecel, AirtelTigo)`,
      `*2* — 📱 Buy Airtime (Instant Recharge)`,
      `*3* — ⚡ MTN Mash Up (Voice + Data Packages)`,
      `*4* — 🔍 Track Order & Live Status`,
      `*5* — ➕ More Services & Bills (ECG, Water, WAEC & More)`,
      ``,
      `_Reply with 1 to 5 (or reply YES to reorder)_`,
      modeHint
    ].join("\n");
  } else {
    return [
      `🏪 *${storeName}*`,
      `_Official Agent Storefront (Powered by SwiftData Ghana)_`,
      ``,
      ...reorderLines,
      `How can we serve you today?`,
      ``,
      `*1* — 📶 Buy Data`,
      `*2* — 📱 Buy Airtime`,
      `*3* — ⚡ MTN Mash Up (Voice + Data)`,
      `*4* — 🔍 Track Order & Live Status`,
      `*5* — ➕ More Services & Bills (ECG, Water, WAEC & More)`,
      ``,
      `_Reply with 1 to 5 (or reply YES to reorder)_`,
      `_Reply *SWIFTDATA* anytime to switch to official platform bot._`,
      modeHint
    ].join("\n");
  }
}

async function callGemini(prompt: string) {
  if (!GEMINI_API_KEY) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500); // Fast 4.5s timeout
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Gemini error:", err);
    return null;
  }
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 8192) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
    }
    return {
      base64: btoa(binary),
      mimeType,
    };
  } catch (err) {
    console.error("[fetchImageAsBase64] Error:", err);
    return null;
  }
}

async function callGeminiVision(prompt: string, imageBase64: string, mimeType = "image/jpeg"): Promise<any> {
  if (!GEMINI_API_KEY) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64,
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          response_mime_type: "application/json",
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const json = await res.json();
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/```json\s*|```/g, "").trim();
      return JSON.parse(cleaned);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[Gemini Vision] Error:", err);
    return null;
  }
}

// ── WaSender payload parser ───────────────────────────────────────────────────

function parseMessage(payload: any): { 
  id?: string;
  from: string; 
  text: string; 
  fromMe: boolean;
  isImage: boolean;
  imageUrl?: string | null;
  imageBase64?: string | null;
  mimeType?: string;
} {
  const rawM = payload?.data?.messages || payload?.data || payload;
  const m = Array.isArray(rawM) ? rawM[0] : rawM;
  const messageId = String(m.key?.id || m.id || payload?.data?.id || payload?.id || "");
  let from = "";
  const candidatePn = m.key?.cleanedSenderPn || m.senderPn || m.key?.senderPn || payload?.data?.senderPhone;
  if (candidatePn && typeof candidatePn === "string") {
    from = candidatePn.replace(/\D/g, "");
  }

  if (!from) {
    const rawParticipant = String(m.key?.participant || m.participant || payload?.data?.participant || "");
    if (rawParticipant && rawParticipant.includes("@s.whatsapp.net")) {
      from = rawParticipant.split("@")[0].split(":")[0].replace(/\D/g, "");
    }
  }

  const rawRemoteJid = String(m.key?.remoteJid || payload?.data?.from || payload?.from || "");
  if (!from) {
    if (rawRemoteJid.includes("@s.whatsapp.net")) {
      from = rawRemoteJid.split("@")[0].split(":")[0].replace(/\D/g, "");
    } else if (rawRemoteJid.endsWith("@lid") || rawRemoteJid.includes("@lid")) {
      from = rawRemoteJid.split(":")[0];
      if (!from.endsWith("@lid")) from = `${from.split("@")[0]}@lid`;
    } else {
      const clean = rawRemoteJid.split("@")[0];
      const dig = clean.replace(/\D/g, "");
      if (dig.length >= 14 && !dig.startsWith("233")) {
        from = `${dig}@lid`;
      } else {
        from = clean;
      }
    }
  }
  const msg = m.message || {};
  const imageMsg = msg.imageMessage || msg.viewOnceMessage?.message?.imageMessage || msg.viewOnceMessageV2?.message?.imageMessage;
  
  const text = m.messageBody || 
               msg.conversation || 
               msg.extendedTextMessage?.text || 
               imageMsg?.caption || 
               "";

  const isImage = Boolean(
    imageMsg || 
    m.messageType === "imageMessage" || 
    m.messageType === "image" ||
    payload?.event?.includes("image")
  );

  let imageUrl: string | null = null;
  let imageBase64: string | null = null;
  const mimeType = imageMsg?.mimetype || "image/jpeg";

  if (isImage) {
    if (imageMsg?.url && typeof imageMsg.url === "string" && imageMsg.url.startsWith("http")) {
      imageUrl = imageMsg.url;
    } else if (payload?.data?.mediaUrl && typeof payload.data.mediaUrl === "string") {
      imageUrl = payload.data.mediaUrl;
    } else if (m.mediaUrl && typeof m.mediaUrl === "string") {
      imageUrl = m.mediaUrl;
    }

    if (imageMsg?.jpegThumbnail) {
      if (typeof imageMsg.jpegThumbnail === "string") {
        imageBase64 = imageMsg.jpegThumbnail;
      } else if (Array.isArray(imageMsg.jpegThumbnail)) {
        const bytes = new Uint8Array(imageMsg.jpegThumbnail);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
        }
        imageBase64 = btoa(binary);
      }
    }
  }

  return { 
    id: messageId,
    from: from.trim(), 
    text: text.trim(), 
    fromMe: Boolean(m.key?.fromMe),
    isImage,
    imageUrl,
    imageBase64,
    mimeType
  };
}

async function verifyKovaHmac(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  timestampHeader?: string | null
): Promise<boolean> {
  try {
    const cleanSecret = secret.trim();
    if (!cleanSecret || !signatureHeader) return true;

    const encoder = new TextEncoder();
    const candidateSecrets: Uint8Array[] = [
      encoder.encode(cleanSecret),
      encoder.encode(cleanSecret.replace(/^whsec_/, "")),
    ];

    try {
      const stripped = cleanSecret.replace(/^whsec_/, "");
      const binary = atob(stripped);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      candidateSecrets.push(bytes);
    } catch (_) {}

    const candidatePayloads: string[] = [rawBody];
    if (timestampHeader) {
      candidatePayloads.unshift(`${timestampHeader.trim()}.${rawBody}`);
    }

    const cleanSig = signatureHeader.trim().toLowerCase();
    const sigTokens = cleanSig.split(/[,\s]+/).map(t => t.replace(/^(v\d+=?|sha256=)/i, "").trim());

    for (const secBytes of candidateSecrets) {
      const key = await crypto.subtle.importKey(
        "raw",
        secBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      for (const payloadText of candidatePayloads) {
        const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadText));
        const hashArray = Array.from(new Uint8Array(signatureBuffer));
        const hex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        const b64 = btoa(String.fromCharCode(...hashArray));

        for (const token of sigTokens) {
          if (token === hex || token === hex.toLowerCase() || token === b64) {
            return true;
          }
        }
      }
    }

    console.warn(`[Kova HMAC] Signature mismatch. Received: "${signatureHeader.slice(0, 35)}..."`);
    return false;
  } catch (err) {
    console.error("[Kova HMAC] Error:", err);
    return false;
  }
}

function parseKovaPayload(payload: any): { from: string; text: string; messageId: string; isImage: boolean; imageUrl?: string | null } {
  // Check Meta Cloud API nested structure
  const metaMsg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (metaMsg) {
    const from = String(metaMsg.from || "").replace(/\D/g, "");
    const text = String(metaMsg.text?.body || metaMsg.caption || metaMsg.button?.text || "");
    const isImage = metaMsg.type === "image";
    return { from, text, messageId: metaMsg.id || "", isImage, imageUrl: metaMsg.image?.link || null };
  }

  // Check Kova data/message object
  const d = payload?.data || payload?.message || payload;
  const rawFrom = String(
    d?.customer?.phone ||
    d?.contact?.phone ||
    d?.customer?.phone_number ||
    d?.contact?.phone_number ||
    d?.customer_phone ||
    d?.sender_phone ||
    d?.from ||
    d?.sender ||
    d?.phone ||
    d?.recipient ||
    payload?.customer?.phone ||
    payload?.contact?.phone ||
    payload?.from ||
    payload?.sender ||
    ""
  );
  const from = rawFrom.replace(/\D/g, "");
  const text = String(
    d?.text?.body || 
    d?.text || 
    d?.message?.text || 
    d?.message?.body || 
    d?.message || 
    d?.message_content ||
    d?.message_text ||
    d?.body || 
    d?.content || 
    payload?.text || 
    payload?.message || 
    payload?.content ||
    ""
  ).trim();
  const messageId = String(d?.id || d?.message_id || d?.uuid || payload?.id || payload?.delivery_id || "");
  const isImage = d?.type === "image" || Boolean(d?.image || d?.media_url);
  const imageUrl = d?.image?.url || d?.media_url || null;

  return { from, text, messageId, isImage, imageUrl };
}

// ── Data access ───────────────────────────────────────────────────────────────

type Agent = {
  id: string;
  name: string;
  prices: Record<string, Record<string, number>>;
  wa: string | null;
  isSubAgent: boolean;
  parentAgentId: string | null;
  slug?: string;
  referralCode?: string;
};

async function getAgent(supabase: any, val: string, byId = false): Promise<Agent | null> {
  if (!val) return null;
  const cleanVal = val.trim();
  const q = supabase.from("profiles").select(
    "user_id, store_name, full_name, agent_prices, slug, referral_code, agent_approved, sub_agent_approved, whatsapp_number, is_sub_agent, parent_agent_id"
  );
  const { data: p } = await (byId
    ? q.eq("user_id", cleanVal).maybeSingle()
    : q.or(`slug.ilike.${cleanVal},referral_code.ilike.${cleanVal}`).limit(1).maybeSingle()
  );
  if (!p) return null;
  if (!byId && !p.agent_approved && !p.sub_agent_approved) return null;
  return {
    id: p.user_id,
    name: p.store_name || p.full_name || "SwiftData",
    prices: (p.agent_prices || {}) as Record<string, Record<string, number>>,
    wa: p.whatsapp_number || null,
    isSubAgent: Boolean(p.is_sub_agent),
    parentAgentId: p.parent_agent_id || null,
    slug: p.slug || "",
    referralCode: p.referral_code || p.slug || "",
  };
}

type UserProfileAndWallet = {
  profile: any;
  walletBalance: number;
  loyaltyBalance: number;
  creditLimit: number;
  isAdmin: boolean;
  isAgent: boolean;
};

async function getUserProfileAndWallet(supabase: any, rawPhone: string): Promise<UserProfileAndWallet | null> {
  const norm = normalizePhone(rawPhone);
  const digits = rawPhone.replace(/\D/g, "");
  const short = digits.length >= 9 ? digits.slice(-9) : digits;

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, phone, whatsapp_number, store_name, slug, referral_code, is_agent, is_sub_agent, agent_approved, sub_agent_approved, agent_prices")
    .or(`phone.ilike.%${short}%,whatsapp_number.ilike.%${short}%,phone.eq.${norm},whatsapp_number.eq.${norm}`)
    .limit(1);

  if (error || !profiles || profiles.length === 0) return null;
  const profile = profiles[0];

  const [{ data: wallet }, { data: adminRoles }] = await Promise.all([
    supabase
      .from("wallets")
      .select("balance, loyalty_balance, credit_limit")
      .eq("agent_id", profile.user_id)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.user_id)
      .eq("role", "admin")
  ]);

  const isAdmin = Boolean(adminRoles && adminRoles.length > 0);
  const isAgent = Boolean(profile.is_agent || profile.agent_approved || profile.is_sub_agent || profile.sub_agent_approved);

  return {
    profile,
    walletBalance: Number(wallet?.balance || 0),
    loyaltyBalance: Number(wallet?.loyalty_balance || 0),
    creditLimit: Number(wallet?.credit_limit || 0),
    isAdmin,
    isAgent,
  };
}

// ── Admin & Agent Terminal Helpers ──────────────────────────────────────────

function formatAdminMenu(adminName: string): string {
  return [
    `🛡️ *SwiftData Admin Terminal*`,
    `Welcome back, *${adminName}*! 🇬🇭`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*1* — 📊 System Health & Queue Diagnostics`,
    `*2* — 💳 Carrier & Gateway Balances (Telecel, MTN, AT, etc.)`,
    `*3* — 🔄 Auto-Retry & Heal Stuck Orders`,
    `*4* — 📈 Today's Financials (Volume, Orders, Profit)`,
    `*5* — 🔍 User / Agent Lookup (By phone or slug)`,
    `*6* — ⚙️ Maintenance & Platform Status`,
    `*7* — 📢 Send Broadcast to Active User Sessions`,
    `*8* — 🛒 Switch to Customer Retail Menu`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Reply with 1 to 8 — or reply 'CUSTOMER' anytime to browse retail._`
  ].join("\n");
}

async function getAiPackageRecommendation(supabase: any, userPhone: string, network: string, pkgs: any[]): Promise<string | null> {
  try {
    const normPhone = normalizePhone(userPhone) || userPhone.replace(/\D/g, "");
    const shortPhone = normPhone.length >= 9 ? normPhone.slice(-9) : normPhone;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentOrders } = await supabase
      .from("orders")
      .select("package_size, amount")
      .eq("network", network)
      .or(`customer_phone.ilike.%${shortPhone}%,customer_phone.eq.${normPhone}`)
      .in("status", ["fulfilled", "paid"])
      .gte("created_at", sevenDaysAgo);

    if (!recentOrders || recentOrders.length < 2) return null;

    const counts: Record<string, { count: number; totalSpent: number }> = {};
    for (const o of recentOrders) {
      const sz = String(o.package_size || "").toUpperCase();
      if (!sz) continue;
      if (!counts[sz]) counts[sz] = { count: 0, totalSpent: 0 };
      counts[sz].count++;
      counts[sz].totalSpent += Number(o.amount || 0);
    }

    let topSize = "";
    let topCount = 0;
    let topSpend = 0;
    for (const [sz, info] of Object.entries(counts)) {
      if (info.count > topCount) {
        topSize = sz;
        topCount = info.count;
        topSpend = info.totalSpent;
      }
    }

    if (!topSize || topCount < 2) return null;

    if (topSize === "1GB" || topSize === "1.0GB") {
      const target5gb = pkgs.find(p => p.size.toUpperCase() === "5GB" || p.size.toUpperCase() === "5 GB");
      if (target5gb) {
        return `💡 *Smart Savings Recommendation:*\nYou've purchased 1GB ${topCount} times this week (GH₵ ${topSpend.toFixed(2)}). Upgrade to *5GB for GH₵ ${target5gb.total.toFixed(2)}* to get 2GB extra data and save money!`;
      }
    } else if (topSize === "2GB" || topSize === "2.0GB") {
      const targetBulk = pkgs.find(p => p.size.toUpperCase() === "10GB" || p.size.toUpperCase() === "5GB");
      if (targetBulk) {
        return `💡 *Smart Savings Recommendation:*\nYou've purchased 2GB ${topCount} times recently! Upgrade to *${targetBulk.size} for GH₵ ${targetBulk.total.toFixed(2)}* for better bulk savings!`;
      }
    }
  } catch (err) {
    console.warn("[WA AI Recommendation] Error:", err);
  }
  return null;
}

async function processWhatsAppSelfServiceRefund(supabase: any, fromPhone: string, orderRefInput?: string): Promise<string> {
  const normPhone = normalizePhone(fromPhone) || fromPhone.replace(/\D/g, "");
  const shortPhone = normPhone.length >= 9 ? normPhone.slice(-9) : normPhone;

  // Resolve Profile & Wallet
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, phone, whatsapp_number")
    .or(`phone.ilike.%${shortPhone}%,whatsapp_number.ilike.%${shortPhone}%,phone.eq.${normPhone},whatsapp_number.eq.${normPhone}`)
    .limit(1);

  const profile = profiles?.[0];
  const userId = profile?.user_id || null;

  // 1. If specific order reference was provided (e.g. REFUND 622b3328)
  const cleanRef = orderRefInput?.trim().replace(/^refund\s+/i, "").trim().toUpperCase();
  if (cleanRef) {
    const { data: order } = await supabase
      .from("orders")
      .select("id, status, amount, network, package_size, customer_phone, agent_id, failure_reason, created_at, metadata")
      .or(`id.ilike.${cleanRef}%,metadata->>client_reference.eq.${cleanRef}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!order) {
      return `❌ *Order Not Found*\n\nNo order was found matching reference \`${cleanRef}\`. Please check your order ID or reply *4* to track status.`;
    }

    const isOwner = Boolean((userId && order.agent_id === userId) || (normalizePhone(order.customer_phone) === normPhone));
    if (!isOwner) {
      return `🔒 *Authorization Error*\n\nOrder #${order.id.slice(0, 8)} is not linked to your phone number (\`${normPhone}\`).`;
    }

    const st = String(order.status || "").toLowerCase();
    if (st === "refunded" || order.metadata?.is_refunded) {
      return `ℹ️ *Already Refunded*\n\nOrder #${order.id.slice(0, 8)} (${order.network || ""} ${order.package_size || ""}) was already refunded to your wallet balance.`;
    }

    const isEligible = (st === "failed" || st === "cancelled" || st === "unfulfilled" || st === "fulfillment_failed" || st === "rejected");
    if (!isEligible) {
      if (st === "fulfilled" || st === "completed" || st === "success") {
        return `✅ *Order Delivered Successfully*\n\nOrder #${order.id.slice(0, 8)} (${order.network || ""} ${order.package_size || ""}) was delivered to recipient \`${order.customer_phone}\`. Completed orders cannot be refunded.`;
      }
      return `⏳ *Order Processing*\n\nOrder #${order.id.slice(0, 8)} is currently processing with carrier servers. If delivery cannot be completed, it will become eligible for an instant refund shortly.`;
    }

    const refundAmt = Number(order.amount || 0);
    if (!userId) {
      return `⚠️ *Account Required*\n\nTo receive an instant wallet refund for Order #${order.id.slice(0, 8)} (GH₵ ${refundAmt.toFixed(2)}), please reply *REGISTER* to activate your free account!`;
    }

    const { data: credRes, error: credErr } = await supabase.rpc("credit_wallet", {
      p_agent_id: userId,
      p_amount: refundAmt
    });

    if (credErr) {
      console.error("[WA Refund] credit_wallet error:", credErr);
      return `⚠️ *Refund Processing Error*\n\nCould not process refund right now: ${credErr.message || "Database error"}. Please contact support (0598170947).`;
    }

    await supabase.from("orders").update({
      status: "refunded",
      failure_reason: "Refunded via WhatsApp self-service portal"
    }).eq("id", order.id);

    const newBal = Number(credRes?.new_balance || 0);
    const shortId = order.id.slice(0, 8);

    return [
      `✅ *Refund Processed Successfully!*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `• *Order ID:* #${shortId}`,
      `• *Package:* ${order.network || ""} ${order.package_size || "Data"}`,
      `• *Recipient:* \`${order.customer_phone}\``,
      `• *Refund Amount:* *GH₵ ${refundAmt.toFixed(2)}*`,
      `• *New Balance:* *GH₵ ${newBal.toFixed(2)}*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `The funds have been returned to your wallet balance and are available to place new orders immediately! 🚀`,
      ``,
      `_Reply 0 for Main Menu._`
    ].join("\n");
  }

  // 2. Query recent unrefunded failed orders
  let query = supabase
    .from("orders")
    .select("id, status, amount, network, package_size, customer_phone, created_at")
    .in("status", ["failed", "cancelled", "unfulfilled", "fulfillment_failed"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (userId) {
    query = query.or(`agent_id.eq.${userId},customer_phone.ilike.%${shortPhone}%`);
  } else {
    query = query.ilike("customer_phone", `%${shortPhone}%`);
  }

  const { data: failedOrders } = await query;
  if (!failedOrders || failedOrders.length === 0) {
    return [
      `ℹ️ *No Unrefunded Failed Orders Found*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `We couldn't find any recent failed or unrefunded orders linked to phone number \`${normPhone}\`.`,
      ``,
      `If you have a specific order ID or reference number, please reply:`,
      `👉 *REFUND <order_id>* (e.g. \`REFUND 622b3328\`)`,
      ``,
      `_Reply 0 for Main Menu._`
    ].join("\n");
  }

  const orderLines = failedOrders.map((o: any) => {
    const sId = o.id.slice(0, 8);
    const pkg = `${o.network || ""} ${o.package_size || "Data"}`.trim();
    const amt = Number(o.amount || 0).toFixed(2);
    return `• *#${sId}* — ${pkg} to \`${o.customer_phone}\` (GH₵ ${amt})\n  👉 Reply: \`REFUND ${sId}\``;
  });

  return [
    `↩️ *Eligible Orders for Instant Wallet Refund:*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...orderLines,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Reply with \`REFUND <order_id>\` to instantly return the funds to your wallet!`,
    ``,
    `_Reply 0 for Main Menu._`
  ].join("\n");
}

async function handleUserRegistrationStep(supabase: any, fromPhone: string, currentStep: string, textInput: string, dataObj: any): Promise<{ reply: string; nextStep: string; updatedData: any }> {
  const normPhone = normalizePhone(fromPhone) || fromPhone.replace(/\D/g, "");

  if (currentStep === "REG_FULL_NAME") {
    const name = textInput.trim();
    if (!name || name.length < 2) {
      return {
        reply: "⚠️ Please enter a valid *Full Name* (e.g. Senyo Kwami):",
        nextStep: "REG_FULL_NAME",
        updatedData: dataObj
      };
    }
    return {
      reply: [
        `Great, *${name}*! 👋`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Now please reply with your *Email Address* (e.g. \`senyo@gmail.com\`):`,
        ``,
        `_Reply 0 to cancel._`
      ].join("\n"),
      nextStep: "REG_EMAIL",
      updatedData: { ...dataObj, regName: name }
    };
  }

  if (currentStep === "REG_EMAIL") {
    const email = textInput.trim().toLowerCase();
    if (!email.includes("@") || !email.includes(".")) {
      return {
        reply: "⚠️ Please enter a valid *Email Address* (e.g. \`senyo@gmail.com\`):",
        nextStep: "REG_EMAIL",
        updatedData: dataObj
      };
    }

    const regName = dataObj.regName || "User";
    const newUserId = crypto.randomUUID();
    const shortPhone = normPhone.slice(-9);

    const { error: profErr } = await supabase.from("profiles").insert({
      user_id: newUserId,
      full_name: regName,
      email: email,
      phone: normPhone,
      whatsapp_number: normPhone,
      is_agent: false,
      is_sub_agent: false,
      created_at: new Date().toISOString()
    });

    if (profErr) {
      console.error("[WA Reg] Profile insert warning:", profErr);
      await supabase.from("profiles").update({
        full_name: regName,
        email: email,
        whatsapp_number: normPhone
      }).or(`phone.eq.${normPhone},phone.ilike.%${shortPhone}%`);
    }

    await supabase.from("wallets").insert({
      agent_id: newUserId,
      balance: 0,
      loyalty_balance: 0,
      updated_at: new Date().toISOString()
    }).catch(console.error);

    return {
      reply: [
        `🎉 *Account Created Successfully!*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Welcome to SwiftData Ghana, *${regName}*! 🇬🇭`,
        ``,
        `• *Phone:* \`${normPhone}\``,
        `• *Email:* \`${email}\``,
        `• *Wallet Balance:* GH₵ 0.00`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🚀 *Get Started:*`,
        `• Reply *BAL* to check balance & top up`,
        `• Reply *BUY 1GB ${normPhone}* to order data instantly!`,
        ``,
        `_Reply 0 for Main Menu._`
      ].join("\n"),
      nextStep: "MENU",
      updatedData: {}
    };
  }

  return { reply: "Registration process active.", nextStep: "MENU", updatedData: {} };
}

async function handleAgentRegistrationStep(supabase: any, fromPhone: string, currentStep: string, textInput: string, dataObj: any): Promise<{ reply: string; nextStep: string; updatedData: any }> {
  const normPhone = normalizePhone(fromPhone) || fromPhone.replace(/\D/g, "");
  const userMeta = await getUserProfileAndWallet(supabase, fromPhone);
  const profile = userMeta?.profile;
  const userId = profile?.user_id;

  if (currentStep === "AGENT_REG_STORE_NAME") {
    const storeName = textInput.trim();
    if (!storeName || storeName.length < 3) {
      return {
        reply: "⚠️ Please enter a valid *Store Name* (at least 3 characters, e.g. Kwami Data Hub):",
        nextStep: "AGENT_REG_STORE_NAME",
        updatedData: dataObj
      };
    }

    const slug = storeName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const refCode = storeName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    const actFee = await getAgentActivationFee(supabase);
    const walletBal = Number(userMeta?.walletBalance || 0);

    const updatedData = {
      ...dataObj,
      agentStoreName: storeName,
      agentSlug: slug,
      agentRefCode: refCode,
      actFee
    };

    if (walletBal >= actFee) {
      return {
        reply: [
          `🏪 *Store Name Confirmed:* *${storeName}*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `One-Time Lifetime Activation Fee: *GH₵ ${actFee.toFixed(2)}*`,
          `Your Wallet Balance: *GH₵ ${walletBal.toFixed(2)}*`,
          ``,
          `Select how you'd like to pay:`,
          `*1* — Pay GH₵ ${actFee.toFixed(2)} using Wallet Balance ✅`,
          `*2* — Pay via Mobile Money (MoMo Prompt) 📲`,
          ``,
          `_Reply 1 or 2 — or 0 to cancel._`
        ].join("\n"),
        nextStep: "AGENT_REG_PAY_CHOICE",
        updatedData
      };
    } else {
      return {
        reply: [
          `🏪 *Store Name Confirmed:* *${storeName}*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `One-Time Lifetime Activation Fee: *GH₵ ${actFee.toFixed(2)}*`,
          ``,
          `📱 Please reply with your Mobile Money (MTN/Telecel/AT) phone number to receive the payment prompt:`,
          `_Example: 0244123456_`,
          ``,
          `_Reply 0 to cancel._`
        ].join("\n"),
        nextStep: "AGENT_REG_MOMO_PHONE",
        updatedData
      };
    }
  }

  if (currentStep === "AGENT_REG_PAY_CHOICE") {
    const actFee = Number(dataObj.actFee || 15.00);
    const storeName = dataObj.agentStoreName || "Reseller Store";
    const slug = dataObj.agentSlug || "store";
    const refCode = dataObj.agentRefCode || "AGENT";

    if (textInput === "1") {
      if (!userId) {
        return { reply: "⚠️ Profile not found. Reply REGISTER to create your account first.", nextStep: "MENU", updatedData: {} };
      }

      const { error: debitErr } = await supabase.from("wallets").update({
        balance: (userMeta?.walletBalance || 0) - actFee,
        updated_at: new Date().toISOString()
      }).eq("agent_id", userId);

      if (debitErr) {
        return { reply: `⚠️ Wallet debit failed: ${debitErr.message}`, nextStep: "MENU", updatedData: {} };
      }

      await supabase.from("profiles").update({
        is_agent: true,
        agent_approved: true,
        store_name: storeName,
        slug: slug,
        referral_code: refCode
      }).eq("user_id", userId);

      await supabase.from("reseller_stores").upsert({
        user_id: userId,
        store_name: storeName,
        slug: slug,
        is_active: true
      }, { onConflict: "user_id" }).catch(console.error);

      return {
        reply: [
          `🎉 *Congratulations! You are now an Official SwiftData Agent!* 💼`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `• *Store Name:* *${storeName}*`,
          `• *Agent Code:* *${refCode}*`,
          `• *Store Web Link:* *${APP_BASE_URL}/store/${slug}*`,
          `• *Your Bot Link:* *https://wa.me/${WHATSAPP_BOT_NUMBER}?text=Hi+${refCode}*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Share your Bot Link with your customers so they order directly with your custom prices!`,
          ``,
          `_Reply *AGENT* anytime to access your Agent Hub._`
        ].join("\n"),
        nextStep: "MENU",
        updatedData: {}
      };
    }
  }

  return { reply: "Agent registration process active.", nextStep: "MENU", updatedData: {} };
}

async function getSystemHealthReport(supabase: any): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const [
    { count: processingCount },
    { count: pendingCount },
    { count: failedCount },
    { count: fulfilledCount }
  ] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "awaiting_payment"]),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "fulfillment_failed").gte("created_at", twoHoursAgo),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "fulfilled").gte("created_at", todayStart)
  ]);

  const pCount = processingCount || 0;
  const fCount = failedCount || 0;
  const healthStatus = fCount > 8 ? "🔴 Elevated Delivery Failures" : (pCount > 25 ? "🟡 High Queue Load" : "🟢 All Systems Optimal");

  return [
    `📊 *SwiftData Live System Health*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚙️ *Gateway Processing Queue:* *${pCount}* orders`,
    `⏳ *Awaiting MoMo Payment:* *${pendingCount || 0}* orders`,
    `✅ *Delivered Today:* *${fulfilledCount || 0}* orders`,
    `⚠️ *Failed in Last 2 Hours:* *${fCount}* orders`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🚦 *Operational Status:* ${healthStatus}`,
    ``,
    `_Reply 3 to trigger Auto-Retry._`,
    `_Reply 0 for Admin Terminal._`
  ].join("\n");
}

async function getProviderBalancesReport(supabase: any): Promise<string> {
  const { data: providers, error } = await supabase
    .from("providers")
    .select("provider_name, handler_type, balance, is_active")
    .order("balance", { ascending: false });

  if (error || !providers || providers.length === 0) {
    return `⚠️ Could not retrieve provider balances or none configured.\n\n_Reply 0 for Admin Terminal._`;
  }

  const lines = [
    `💳 *Carrier & Gateway Balances*`,
    `━━━━━━━━━━━━━━━━━━━━`
  ];

  for (const p of providers) {
    const name = p.provider_name || p.handler_type;
    const bal = Number(p.balance || 0).toFixed(2);
    const indicator = p.is_active ? "🟢" : "🔴";
    lines.push(`• *${name}*: GH₵ ${bal} ${indicator}`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`_Reply 0 for Admin Terminal._`);
  return lines.join("\n");
}

async function triggerHealAndRetry(supabase: any): Promise<string> {
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: stuck } = await supabase
    .from("orders")
    .select("id")
    .eq("status", "processing")
    .lte("created_at", tenMinsAgo)
    .limit(20);

  const stuckCount = stuck?.length || 0;

  try {
    fetch(`${SUPABASE_URL}/functions/v1/heal-processing-orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
    }).catch(() => {});
    fetch(`${SUPABASE_URL}/functions/v1/process-retries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
    }).catch(() => {});
  } catch (_err) {
    console.warn("[WA Bot] Healer dispatch error:", _err);
  }

  return [
    `🔄 *Auto-Retry & Queue Healer Dispatched!*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `• Detected Stalled Processing Orders: *${stuckCount}*`,
    `• Background Workers: 🟢 *Dispatched*`,
    ``,
    `Orders stuck in the gateway queue are being verified with telecom providers and re-submitted.`,
    ``,
    `_Reply 1 to check updated system health._`,
    `_Reply 0 for Admin Terminal._`
  ].join("\n");
}

async function getTodayFinancialsReport(supabase: any): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const { data: orders } = await supabase
    .from("orders")
    .select("amount, profit, status")
    .gte("created_at", todayStart)
    .in("status", ["fulfilled", "processing", "paid"]);

  let totalVol = 0;
  let totalProf = 0;
  const count = orders?.length || 0;

  for (const o of orders || []) {
    totalVol += Number(o.amount || 0);
    totalProf += Number(o.profit || 0);
  }

  const avgOrder = count > 0 ? (totalVol / count) : 0;

  return [
    `📈 *Today's Platform Financials*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📦 *Delivered / Queued Orders:* *${count}*`,
    `💰 *Gross Sales Volume:* *GH₵ ${totalVol.toFixed(2)}*`,
    `💵 *Platform Gross Profit:* *GH₵ ${totalProf.toFixed(2)}*`,
    `📊 *Average Order Value:* *GH₵ ${avgOrder.toFixed(2)}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Reply 0 for Admin Terminal._`
  ].join("\n");
}

async function lookupUserProfileDossier(supabase: any, query: string): Promise<string> {
  const clean = query.trim();
  const digits = clean.replace(/\D/g, "");
  const short = digits.length >= 9 ? digits.slice(-9) : digits;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, phone, whatsapp_number, store_name, slug, is_agent, is_sub_agent, agent_approved, sub_agent_approved")
    .or(`phone.ilike.%${short}%,whatsapp_number.ilike.%${short}%,slug.ilike.${clean}%,full_name.ilike.%${clean}%`)
    .limit(1);

  if (!profiles || profiles.length === 0) {
    return `❌ *User Not Found*\n\nNo user or agent matches "*${query}*".\n\n_Reply with another phone number to search, or reply 0 for Admin Terminal._`;
  }

  const p = profiles[0];
  const [{ data: wallet }, { data: adminRoles }, { data: recentOrders }] = await Promise.all([
    supabase.from("wallets").select("balance, loyalty_balance, credit_limit").eq("agent_id", p.user_id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", p.user_id).eq("role", "admin"),
    supabase.from("orders").select("id, network, package_size, amount, status, created_at").or(`customer_phone.eq.${p.phone},agent_id.eq.${p.user_id}`).order("created_at", { ascending: false }).limit(3)
  ]);

  const isAdmin = Boolean(adminRoles && adminRoles.length > 0);
  const isAgent = Boolean(p.is_agent || p.agent_approved || p.is_sub_agent);
  const roleLabel = isAdmin ? "🛡️ Super Admin" : (isAgent ? "💼 Reseller Agent" : "👤 Retail Customer");

  const lines = [
    `🔍 *User Account Dossier*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `👤 *Name:* *${p.full_name || "N/A"}*`,
    p.store_name ? `🏪 *Store:* *${p.store_name}* (/${p.slug})` : "",
    `📱 *Phone:* \`${p.phone || "N/A"}\``,
    `🏷️ *Account Role:* *${roleLabel}*`,
    `💳 *Wallet Balance:* *GH₵ ${Number(wallet?.balance || 0).toFixed(2)}*`,
    `🎁 *Loyalty Points:* *GH₵ ${Number(wallet?.loyalty_balance || 0).toFixed(2)}*`,
    `🛡️ *Credit Limit:* *GH₵ ${Number(wallet?.credit_limit || 0).toFixed(2)}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📋 *Recent Activity:*`
  ].filter(Boolean);

  if (recentOrders && recentOrders.length > 0) {
    recentOrders.forEach((o: any, idx: number) => {
      const item = o.package_size ? `${o.network} ${o.package_size}` : `${o.network} GH₵ ${Number(o.amount || 0).toFixed(2)}`;
      lines.push(`${idx + 1}. \`${o.id.slice(0, 8)}\` — ${item} (*${o.status}*)`);
    });
  } else {
    lines.push(`_No recent orders found._`);
  }

  lines.push(``);
  lines.push(`_Reply with another phone number to lookup, or 0 for Admin Terminal._`);
  return lines.join("\n");
}

function formatAgentMenu(storeName: string, walletBalance: number, slug: string, agentCode?: string): string {
  const displayCode = (agentCode || slug || "AGENT").toUpperCase();
  return [
    `💼 *SwiftData Agent Business Hub*`,
    `Store: *${storeName}* 🇬🇭`,
    `Agent Code: *${displayCode}* 🏷️`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💳 *Agent Wallet:* *GH₵ ${walletBalance.toFixed(2)}*`,
    `👉 *Your Bot Link:* \`https://wa.me/${WHATSAPP_BOT_NUMBER}?text=Hi+${displayCode}\``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*1* — 💳 My Agent Wallet & Commission`,
    `*2* — ⚡ Instant Wallet Top-Up (MoMo)`,
    `*3* — 🛍️ Buy Wholesale Data (Agent Pricing)`,
    `*4* — 📊 Today's Store Sales & Profit Report`,
    `*5* — 📲 Share Bot with Customers (My Code & Promo Message)`,
    `*6* — 📦 My Customers' Recent Orders`,
    `*7* — 💸 Request Withdrawal / Payout`,
    `*8* — 🛒 Switch to Standard Customer Menu`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Reply with 1 to 8 — or reply 'CUSTOMER' anytime to browse retail._`
  ].join("\n");
}

async function getAgentTodayReport(supabase: any, agentId: string, storeName: string, walletBalance: number): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const { data: orders } = await supabase
    .from("orders")
    .select("amount, profit, status")
    .eq("agent_id", agentId)
    .gte("created_at", todayStart)
    .in("status", ["fulfilled", "processing", "paid"]);

  let totalSales = 0;
  let totalProfit = 0;
  const count = orders?.length || 0;

  for (const o of orders || []) {
    totalSales += Number(o.amount || 0);
    totalProfit += Number(o.profit || 0);
  }

  return [
    `📊 *Today's Store Performance Report*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Store: *${storeName}*`,
    `• *Customer Orders Today:* *${count}*`,
    `• *Total Customer Spending:* *GH₵ ${totalSales.toFixed(2)}*`,
    `• *Net Profit Earned Today:* *GH₵ ${totalProfit.toFixed(2)}* 🚀`,
    `• *Available Wallet Balance:* *GH₵ ${walletBalance.toFixed(2)}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Reply 0 for Agent Business Hub._`
  ].join("\n");
}

function getAgentPromoCaptions(storeName: string, slug: string, referralCode?: string): string {
  const agentCode = (referralCode || slug || "").toUpperCase();
  const botLink = `https://wa.me/${WHATSAPP_BOT_NUMBER}?text=Hi+${encodeURIComponent(agentCode)}`;
  const storeLink = `https://swiftdatagh.shop/store/${slug || agentCode.toLowerCase()}`;

  return [
    `📲 *Share Bot with Customers (Forwardable Promo Kit)*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏷️ *Your Agent Code:* *${agentCode}*`,
    `🤖 *1-Click WhatsApp Bot Link:*`,
    `${botLink}`,
    ``,
    `🌐 *Online Web Store:*`,
    `${storeLink}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `✨ *READY-TO-FORWARD PROMO MESSAGE #1 (Quick Order):*`,
    `_(Long-press & Forward to your WhatsApp Status or contacts)_ ⬇️`,
    ``,
    `⚡ *Instant MTN, Telecel & AT Data Bundles 24/7!* 📱🚀`,
    `Delivered automatically to your phone in under 2 minutes!`,
    ``,
    `👉 *Option 1 — Tap to Order via WhatsApp:*`,
    `${botLink}`,
    ``,
    `👉 *Option 2 — Save & Chat:*`,
    `Save bot number: *+1 (213) 903-5565*`,
    `Send message: *Hi ${agentCode}*`,
    `Agent Code: *${agentCode}*`,
    ``,
    `Order directly from *${storeName}* anytime!`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🔥 *READY-TO-FORWARD PROMO MESSAGE #2 (Promo Blast):*`,
    `🚀 *Need a Fast Data Top-Up in 60 Seconds?* ⚡`,
    `Cheapest bundle rates in Ghana from *${storeName}*!`,
    `👉 Tap to buy: ${botLink}`,
    `My Agent Code: *${agentCode}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_Reply 0 for Agent Business Hub._`
  ].join("\n");
}

async function getAgentRecentOrders(supabase: any, agentId: string): Promise<string> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, network, package_size, amount, profit, customer_phone, status, created_at")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!orders || orders.length === 0) {
    return `📦 *My Customers' Orders*\n\nNo orders have been placed through your store yet.\nShare your bot link to start selling!\n\n_Reply 0 for Agent Hub._`;
  }

  const lines = [
    `📦 *Recent Orders Through Your Store (Last ${orders.length})*`,
    `━━━━━━━━━━━━━━━━━━━━`
  ];

  orders.forEach((o: any, idx: number) => {
    const dt = new Date(o.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const item = o.package_size ? `${o.network} ${o.package_size}` : `${o.network} GH₵ ${Number(o.amount || 0).toFixed(2)}`;
    lines.push(`*${idx + 1}.* \`${o.customer_phone}\` — ${item}`);
    lines.push(`   Status: *${o.status.toUpperCase()}* | Profit: *GH₵ ${Number(o.profit || 0).toFixed(2)}*`);
    lines.push(`   Ref: \`${o.id.slice(0, 8)}\` (${dt})`);
    lines.push(``);
  });

  lines.push(`_Reply 0 for Agent Hub._`);
  return lines.join("\n");
}

async function getAgentActivationFee(supabase: any): Promise<number> {
  try {
    const { data: settings } = await supabase
      .from("v_system_settings_with_secrets")
      .select("agent_activation_fee")
      .eq("id", 1)
      .maybeSingle();
    if (settings?.agent_activation_fee) {
      return Number(settings.agent_activation_fee);
    }
  } catch (_err) {
    console.warn("[WA Bot] Settings fee error:", _err);
  }
  return 50;
}

function formatOrderDiagnostic(order: any): string {
  const statusEmoji: Record<string, string> = {
    pending: "⏳ Awaiting MoMo Payment",
    awaiting_payment: "⏳ Awaiting MoMo Payment",
    paid: "💳 Paid & Queued",
    processing: "⚙️ Carrier Gateway Dispatch Active",
    fulfilled: "✅ Delivered Successfully",
    fulfillment_failed: "❌ Delivery Failed",
    cancelled: "🚫 Cancelled / Refunded",
  };

  const statusLabel = statusEmoji[order.status] || (order.status || "UNKNOWN").toUpperCase();
  const dt = new Date(order.created_at).toLocaleDateString("en-GH", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const lines = [
    `🔍 *LIVE ORDER STATUS REPORT*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📦 *Order ID:* \`${order.id.slice(0, 8)}\``,
    `📶 *Network:* *${order.network || "N/A"}*`,
    order.package_size ? `📦 *Bundle:* *${order.package_size}*` : `📱 *Airtime:* *GH₵ ${Number(order.amount || 0).toFixed(2)}*`,
    `📱 *Recipient:* *${order.customer_phone || "N/A"}*`,
    `💰 *Amount:* *GH₵ ${Number(order.amount || 0).toFixed(2)}*`,
    `📊 *Status:* *${statusLabel}*`,
    `📅 *Date:* ${dt}`,
  ];
  return lines.join("\n");
}

type Pkg = { size: string; basePrice: number; total: number };

async function getPackagesForNetwork(
  supabase: any,
  network: string,
  agentPrices: Record<string, Record<string, number>>,
  category?: string
): Promise<Pkg[]> {
  const pkgs: Pkg[] = [];

  // Handle specific MTN categories matching the UI design
  if (network === "MTN" && category) {
    if (category === "sme") {
      const { data: rows } = await supabase
        .from("global_package_settings")
        .select("package_size, public_price, agent_price")
        .eq("network", "MTN")
        .not("package_size", "ilike", "GHS%")
        .eq("is_unavailable", false)
        .order("public_price", { ascending: true });
      for (const row of rows || []) {
        const base = Number(row.public_price || row.agent_price || 0);
        if (base > 0) pkgs.push({ size: row.package_size, basePrice: base, total: addPaystackFee(base) });
      }
      return pkgs;
    }

    if (category === "mashup") {
      const { data: rows } = await supabase
        .from("global_package_settings")
        .select("package_size, public_price, agent_price")
        .eq("network", "MTN Mash Up")
        .eq("is_unavailable", false)
        .order("public_price", { ascending: true });
      for (const row of rows || []) {
        const base = Number(row.public_price || row.agent_price || 0);
        if (base > 0) pkgs.push({ size: row.package_size, basePrice: base, total: addPaystackFee(base) });
      }
      return pkgs;
    }

    const categoryMap: Record<string, string> = {
      data_bundles: "Data Bundles",
      idd: "IDD Bundles",
      kokrokoo: "Kokrokoo Bundles",
      midnight: "Midnight Bundles",
      social: "Social Media Bundles",
      video: "Video Bundles",
    };
    const targetCat = categoryMap[category];
    if (targetCat) {
      const { data: provRows } = await supabase
        .from("provider_packages")
        .select("package_name, raw_data, capacity_gb")
        .eq("provider_id", "1177b72a-a2d7-462d-9366-9dde6e83ccd7")
        .eq("is_active", true)
        .eq("raw_data->>category", targetCat);

      for (const r of provRows || []) {
        const amt = parseFloat(r.raw_data?.amount || "0");
        const name = r.package_name || r.raw_data?.name || `${r.capacity_gb}GB`;
        if (amt > 0) {
          pkgs.push({ size: name, basePrice: amt, total: addPaystackFee(amt) });
        }
      }
      if (pkgs.length > 0) {
        return pkgs.sort((a, b) => a.total - b.total);
      }
    }
  }

  // 1. Use agent's custom selling prices if configured (case-insensitive)
  const networkLower = network.toLowerCase();
  const custom = (agentPrices?.[network] || agentPrices?.[network.toUpperCase()] || agentPrices?.[networkLower] || {}) as Record<string, number>;

  for (const [size, price] of Object.entries(custom)) {
    const base = Number(price);
    if (base > 0) pkgs.push({ size, basePrice: base, total: addPaystackFee(base) });
  }

  if (pkgs.length > 0) {
    console.log(`[WA Bot] Found ${pkgs.length} custom prices for ${network}`);
    return pkgs.sort((a, b) => a.total - b.total);
  }

  // 2. Fall back to global public prices
  console.log(`[WA Bot] Querying global bundles for ${network}...`);

  try {
    console.log(`[WA Bot] Executing global query for ${network}...`);
    const { data: rows, error } = await supabase
      .from("global_package_settings")
      .select("package_size, public_price, agent_price")
      .ilike("network", network)
      .eq("is_unavailable", false)
      .order("public_price", { ascending: true })
      .limit(30);

    if (error) {
      console.error("[WA Bot] DB Error fetching bundles:", error);
      throw error;
    }

    console.log(`[WA Bot] Query success! Found ${rows?.length || 0} bundles`);

    if (!rows || rows.length === 0) {
      console.warn(`[WA Bot] No bundles found in DB for network: ${network}`);
    }

    for (const row of rows || []) {
      const base = Number(row.public_price || row.agent_price || 0);
      if (base > 0) pkgs.push({ size: row.package_size, basePrice: base, total: addPaystackFee(base) });
    }
  } catch (err) {
    console.error("[WA Bot] getPackagesForNetwork caught error:", err);
    throw err;
  }

  return pkgs;
}

// ── Profit resolution (mirrors initialize-payment logic) ─────────────────────

type ProfitInfo = { profit: number; parentProfit: number; parentAgentId: string | null; costPrice: number };

async function resolveProfit(
  supabase: any,
  network: string,
  packageSize: string,
  agent: Agent | null,
  agentSellingBase: number
): Promise<ProfitInfo> {
  const norm = normalizeNetworkKey(network);
  const normPkg = packageSize.replace(/\s+/g, "").toUpperCase();

  const { data: globalRow } = await supabase
    .from("global_package_settings")
    .select("agent_price, cost_price")
    .eq("network", norm)
    .eq("package_size", normPkg)
    .maybeSingle();

  const adminAgentPrice = Number(globalRow?.agent_price || 0);
  const costPrice = Number(globalRow?.cost_price || adminAgentPrice);

  if (!agent) {
    return {
      profit: Math.max(0, parseFloat((agentSellingBase - costPrice).toFixed(2))),
      parentProfit: 0,
      parentAgentId: null,
      costPrice,
    };
  }

  if (adminAgentPrice <= 0) return { profit: 0, parentProfit: 0, parentAgentId: null, costPrice };

  if (agent.isSubAgent && agent.parentAgentId) {
    const { data: parentProfile } = await supabase
      .from("profiles")
      .select("sub_agent_prices, agent_prices")
      .eq("user_id", agent.parentAgentId)
      .maybeSingle();

    const subPrices = (parentProfile?.sub_agent_prices || {}) as Record<string, Record<string, number>>;
    const agentPrices = (parentProfile?.agent_prices || {}) as Record<string, Record<string, number>>;
    const hasSubPrices = Object.keys(subPrices).length > 0;
    const priceSource = hasSubPrices ? subPrices : agentPrices;

    const parentChargesSubAgent = Number(priceSource?.[norm]?.[normPkg] || priceSource?.[network]?.[packageSize] || adminAgentPrice);
    const safeParentCharge = Math.max(parentChargesSubAgent, adminAgentPrice);

    return {
      profit: Math.max(0, parseFloat((agentSellingBase - safeParentCharge).toFixed(2))),
      parentProfit: Math.max(0, parseFloat((safeParentCharge - adminAgentPrice).toFixed(2))),
      parentAgentId: agent.parentAgentId,
      costPrice,
    };
  }

  return {
    profit: Math.max(0, parseFloat((agentSellingBase - adminAgentPrice).toFixed(2))),
    parentProfit: 0,
    parentAgentId: null,
    costPrice,
  };
}

// ── Paystack initialization ───────────────────────────────────────────────────

type PayResult = { orderId: string; status?: string; otpMessage?: string; errorMessage?: string };

async function initDataPayment(
  supabase: any,
  from: string,
  agent: Agent | null,
  pkg: Pkg,
  network: string,
  recipient: string,
  payerPhone?: string
): Promise<PayResult | null> {
  const orderId = crypto.randomUUID();
  const fee = feeAmount(pkg.basePrice);
  const { profit, parentProfit, parentAgentId, costPrice } = await resolveProfit(supabase, network, pkg.size, agent, pkg.basePrice);

  const cleanPayer = normalizePhone(payerPhone || from) || normalizePhone(recipient) || normalizePhone(from) || from;
  const provider = getPaymentProvider(cleanPayer);
  const resolvedAgentId = (agent?.id && agent.id !== ZERO_UUID) ? agent.id : ZERO_UUID;

  const metadata = {
    order_id: orderId,
    order_type: "data",
    agent_id: resolvedAgentId,
    network,
    package_size: pkg.size,
    customer_phone: recipient,
    momo_number: cleanPayer,
    channel: "whatsapp",
    wa_from: from,
    base_price: pkg.basePrice,
    cost_price: costPrice,
    profit,
    parent_profit: parentProfit,
    parent_agent_id: parentAgentId,
  };

  let json: any = null;
  try {
    const paystackKey = await getPaystackSecretKey(supabase);
    const res = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `wa-${cleanPayer}@swiftdatagh.shop`,
        amount: Math.round(pkg.total * 100),
        reference: orderId,
        metadata,
        currency: "GHS",
        mobile_money: {
          phone: cleanPayer,
          provider,
        }
      }),
    });
    json = await res.json();
    if (!res.ok || !json.status || !json.data?.reference) {
      console.error("[WA Bot] Paystack data direct charge failed:", json);
      return null;
    }
  } catch (err) {
    console.error("[WA Bot] initDataPayment fetch error:", err);
    return null;
  }

  const { error } = await supabase.from("orders").insert({
    id: orderId,
    agent_id: resolvedAgentId,
    parent_agent_id: parentAgentId || null,
    order_type: "data",
    network,
    package_size: pkg.size,
    customer_phone: recipient,
    payment_method: "mobile_money",
    amount: pkg.basePrice,
    paystack_fee: fee,
    cost_price: costPrice,
    profit,
    parent_profit: parentProfit,
    status: "pending",
    channel: "whatsapp",
    failure_reason: null,
    metadata,
  });
  if (error) { console.error("[WA Bot] Order insert error:", error); return null; }

  return { orderId, status: json?.data?.status, otpMessage: json?.data?.otp_message };
}

async function initAirtimePayment(
  supabase: any,
  from: string,
  agent: Agent | null,
  network: string,
  airtimeBase: number,
  recipient: string,
  payerPhone?: string
): Promise<PayResult | null> {
  const orderId = crypto.randomUUID();
  const fee = 0;
  const total = airtimeBase;

  const cleanPayer = normalizePhone(payerPhone || from) || normalizePhone(recipient) || normalizePhone(from) || from;
  const provider = getPaymentProvider(cleanPayer);
  const resolvedAgentId = (agent?.id && agent.id !== ZERO_UUID) ? agent.id : ZERO_UUID;

  const metadata = {
    order_id: orderId,
    order_type: "airtime",
    agent_id: resolvedAgentId,
    network,
    customer_phone: recipient,
    momo_number: cleanPayer,
    base_price: airtimeBase,
    channel: "whatsapp",
    wa_from: from,
    profit: 0,
    parent_profit: 0,
  };

  let json: any = null;
  try {
    const paystackKey = await getPaystackSecretKey(supabase);
    const res = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `wa-${cleanPayer}@swiftdatagh.shop`,
        amount: Math.round(total * 100),
        reference: orderId,
        metadata,
        currency: "GHS",
        mobile_money: {
          phone: cleanPayer,
          provider,
        }
      }),
    });
    json = await res.json();
    if (!res.ok || !json.status || !json.data?.reference) {
      console.error("[WA Bot] Paystack airtime direct charge failed:", json);
      return null;
    }
  } catch (err) {
    console.error("[WA Bot] initAirtimePayment fetch error:", err);
    return null;
  }

  const { error } = await supabase.from("orders").insert({
    id: orderId,
    agent_id: resolvedAgentId,
    order_type: "airtime",
    network,
    package_size: null,
    customer_phone: recipient,
    payment_method: "mobile_money",
    amount: airtimeBase,
    paystack_fee: fee,
    cost_price: null,
    profit: 0,
    parent_profit: 0,
    status: "pending",
    channel: "whatsapp",
    failure_reason: null,
    metadata,
  });
  if (error) { console.error("[WA Bot] Airtime order insert error:", error); return null; }

  return { orderId, status: json?.data?.status, otpMessage: json?.data?.otp_message };
}

async function getAfaPrice(supabase: any): Promise<number> {
  try {
    const { data } = await supabase
      .from("global_package_settings")
      .select("agent_price, public_price")
      .eq("network", "AFA")
      .eq("package_size", "BUNDLE")
      .maybeSingle();
    if (data) {
      return Number(data.agent_price ?? data.public_price ?? 15.00);
    }
  } catch (e) {
    console.error("[WA Bot] Error querying AFA price:", e);
  }
  return 15.00;
}

async function initAfaPayment(
  supabase: any,
  from: string,
  agent: Agent | null,
  afaPrice: number,
  data: any
): Promise<PayResult | null> {
  const orderId = crypto.randomUUID();
  const fee = feeAmount(afaPrice);
  const total = addPaystackFee(afaPrice);

  const provider = getPaymentProvider(from);
  const userPhone = normalizePhone(from);
  const resolvedAgentId = (agent?.id && agent.id !== ZERO_UUID) ? agent.id : ZERO_UUID;

  const metadata = {
    order_id: orderId,
    order_type: "afa",
    agent_id: resolvedAgentId,
    network: "AFA",
    package_size: "BUNDLE",
    customer_phone: data.afaPhone,
    channel: "whatsapp",
    wa_from: from,
    base_price: afaPrice,
    cost_price: 15.00,
    profit: 0,
    parent_profit: 0,
    parent_agent_id: agent?.parentAgentId || null,
    afa_full_name: data.afaName,
    afa_ghana_card: data.afaCard,
    afa_occupation: data.afaOccupation,
    afa_email: data.afaEmail || null,
    afa_residence: data.afaResidence,
    afa_date_of_birth: data.afaDob
  };

  let json: any = null;
  try {
    const paystackKey = await getPaystackSecretKey(supabase);
    const res = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `wa-${from}@swiftdatagh.shop`,
        amount: Math.round(total * 100),
        reference: orderId,
        metadata,
        currency: "GHS",
        mobile_money: {
          phone: userPhone,
          provider,
        }
      }),
    });
    json = await res.json();
    if (!res.ok || !json.status || !json.data?.reference) {
      console.error("[WA Bot] Paystack AFA charge failed:", json);
      return null;
    }
  } catch (err) {
    console.error("[WA Bot] initAfaPayment fetch error:", err);
    return null;
  }

  const { error } = await supabase.from("orders").insert({
    id: orderId,
    agent_id: resolvedAgentId,
    parent_agent_id: agent?.parentAgentId || null,
    order_type: "afa",
    network: "AFA",
    package_size: "BUNDLE",
    customer_phone: data.afaPhone,
    amount: afaPrice,
    paystack_fee: fee,
    cost_price: 15.00,
    profit: 0,
    parent_profit: 0,
    status: "pending",
    channel: "whatsapp",
    failure_reason: null,
    metadata,
    afa_full_name: data.afaName,
    afa_ghana_card: data.afaCard,
    afa_occupation: data.afaOccupation,
    afa_email: data.afaEmail || null,
    afa_residence: data.afaResidence,
    afa_date_of_birth: data.afaDob,
  });
  if (error) { console.error("[WA Bot] AFA order insert error:", error); return null; }

  return { orderId };
}

// ── Main handler ─────────────────────────────────────────────────────────────


function sanitizePublicFailureReason(rawReason?: string | null): string {
  if (!rawReason) return "Carrier gateway timeout or network dispatch delay.";
  let r = rawReason;
  if (/refunded/i.test(r)) {
    return "Delivery could not be completed by carrier network and was refunded to balance.";
  }
  // Strip ALL provider brand names to protect internal systems
  r = r.replace(/\b(DataHub|BundleZone|DataMart|Datamart|Xcel|Hubnet|Korba|Korba365|SKDataPlug|SKPlug|Spendless|TxtConnect|Mnotify|Arkesel|Hubtel)\b/gi, "Carrier Network");
  r = r.replace(/Carrier Network reported:\s*/gi, "Carrier reported: ");
  return r;
}

async function verifyBeneficiary(phone: string): Promise<{ success: boolean; isVerified: boolean; isNonBeneficiary: boolean; message: string }> {
  try {
    const norm = normalizePhone(phone);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const vRes = await fetch(`${supabaseUrl}/functions/v1/verify-beneficiary`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone: norm })
    });
    const vJson = await vRes.json().catch(() => ({}));
    if (vJson?.exists && (vJson.verification_status === "VERIFIED" || vJson.status === "verified" || vJson.can_order === true)) {
      return {
        success: true,
        isVerified: true,
        isNonBeneficiary: false,
        message: "Number is verified on the MTN beneficiary list and ready for instant delivery."
      };
    }
    if (vJson?.is_non_beneficiary) {
      return {
        success: true,
        isVerified: false,
        isNonBeneficiary: true,
        message: "Number is eligible for instant delivery."
      };
    }
    return {
      success: true,
      isVerified: false,
      isNonBeneficiary: false,
      message: vJson?.message || "Number is not yet on the MTN beneficiary whitelist."
    };
  } catch (err) {
    console.error("[WA Bot] verifyBeneficiary error:", err);
    return { success: false, isVerified: false, isNonBeneficiary: false, message: "Beneficiary lookup service is temporarily unreachable." };
  }
}

async function initUtilityPayment(
  supabase: any,
  payerPhone: string,
  fromWa: string,
  agent: Agent | null,
  utilityType: string,
  utilityProvider: string,
  accountNumber: string,
  accountName: string,
  amount: number,
  extraMeta?: Record<string, any>
): Promise<PayResult | null> {
  const orderId = crypto.randomUUID();
  const fee = feeAmount(amount);
  const total = parseFloat((amount + fee).toFixed(2));
  const normPayer = normalizePhone(payerPhone);
  const provider = getPaymentProvider(normPayer);
  const resolvedAgentId = (agent?.id && agent.id !== ZERO_UUID) ? agent.id : ZERO_UUID;

  const metadata = {
    order_id: orderId,
    order_type: "utility",
    utility_type: utilityType,
    utility_provider: utilityProvider,
    utility_account_number: accountNumber,
    utility_account_name: accountName,
    agent_id: resolvedAgentId,
    base_price: amount,
    channel: "whatsapp",
    wa_from: fromWa,
    is_korba: true,
    meter_id: extraMeta?.meterId || "",
    meter_number: extraMeta?.meterNumber || accountNumber,
    ...(extraMeta || {})
  };

  let json: any = null;
  try {
    const paystackKey = await getPaystackSecretKey(supabase);
    const res = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `wa_${normPayer}@swiftdata.tech`,
        amount: Math.round(total * 100),
        currency: "GHS",
        reference: orderId,
        mobile_money: { phone: normPayer, provider },
        metadata,
      }),
    });
    json = await res.json().catch(() => ({}));
    if (!res.ok || !json.status || !json.data?.reference) {
      console.error("[WA Bot] Paystack utility charge failed:", json);
      return { orderId: "", errorMessage: json?.message || "Payment prompt could not be initiated by carrier." };
    }
  } catch (err: any) {
    console.error("[WA Bot] initUtilityPayment fetch error:", err);
    return { orderId: "", errorMessage: "Network error while connecting to payment provider." };
  }

  const { error } = await supabase.from("orders").insert({
    id: orderId,
    agent_id: resolvedAgentId,
    order_type: "utility",
    utility_type: utilityType,
    utility_provider: utilityProvider,
    utility_account_number: accountNumber,
    utility_account_name: accountName,
    customer_phone: normPayer,
    amount: amount,
    paystack_fee: fee,
    cost_price: amount,
    profit: 0,
    parent_profit: 0,
    status: "pending",
    channel: "whatsapp",
    failure_reason: null,
    metadata,
    payment_method: "paystack",
    payment_reference: json.data?.reference || orderId,
  });

  if (error) {
    console.error("[WA Bot] Utility order insert error:", error);
    return { orderId: "", errorMessage: "Database error recording utility order." };
  }
  return { orderId, status: json?.data?.status, otpMessage: json?.data?.otp_message };
}

const inMemoryIncomingDedup = new Map<string, number>();

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method === "GET") {
    return new Response("WhatsApp Webhook is active", {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
      status: 200,
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const supabase = supabaseAdmin;

  let isTwilio = false;
  let from = "";
  let text = "";
  let messageId = "";
  let fromMe = false;
  let isImage = false;
  let imageUrl: string | null = null;
  let imageBase64: string | null = null;
  let imageMimeType = "image/jpeg";
  const contentType = req.headers.get("content-type") || "";

  try {
    const kovaSig = req.headers.get("x-kova-signature") ||
                    req.headers.get("x-webhook-signature") ||
                    req.headers.get("webhook-signature") ||
                    req.headers.get("svix-signature");
    const kovaTimestamp = req.headers.get("x-kova-timestamp") ||
                          req.headers.get("x-webhook-timestamp") ||
                          req.headers.get("webhook-timestamp") ||
                          req.headers.get("svix-timestamp");
    const kovaEvent = req.headers.get("x-kova-callback-event") ||
                      req.headers.get("x-webhook-event") ||
                      req.headers.get("webhook-event");
    const kovaDelivery = req.headers.get("x-kova-delivery") ||
                         req.headers.get("x-webhook-id") ||
                         req.headers.get("webhook-id") ||
                         req.headers.get("svix-id");
    const isKova = Boolean(kovaEvent || kovaSig || kovaDelivery || kovaTimestamp);

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      // Incoming from Twilio WhatsApp API
      isTwilio = true;
      const formData = await req.formData();
      const rawFrom = String(formData.get("From") || formData.get("WaId") || "");
      const rawBody = String(formData.get("Body") || "");
      const cleanPhone = rawFrom.replace(/^whatsapp:/i, "").trim();

      messageId = String(formData.get("MessageSid") || formData.get("SmsMessageSid") || "");
      from = normalizePhone(cleanPhone) || cleanPhone.replace(/\D/g, "");
      text = rawBody.trim();
      fromMe = false;

      const numMedia = parseInt(String(formData.get("NumMedia") || "0"), 10);
      if (numMedia > 0) {
        isImage = true;
        imageUrl = String(formData.get("MediaUrl0") || "") || null;
        imageMimeType = String(formData.get("MediaContentType0") || "image/jpeg");
      }

      console.log(`[WA Webhook] Twilio incoming from: ${from} (raw: ${rawFrom}), text: "${text.slice(0, 50)}", isImage: ${isImage}`);
    } else if (isKova) {
      // Incoming from Arkesel Kova WhatsApp Business API
      const rawBody = await req.text().catch(() => "");
      const kovaSecret = Deno.env.get("KOVA_SIGNING_SECRET") || "";

      if (kovaSecret && kovaSig) {
        const valid = await verifyKovaHmac(rawBody, kovaSig, kovaSecret, kovaTimestamp);
        if (!valid) {
          console.warn("[WA Webhook] Kova HMAC verification failed.");
          return new Response("Unauthorized signature", { status: 401, headers: corsHeaders });
        }
      }

      let payload: any = null;
      try {
        payload = JSON.parse(rawBody);
      } catch (pErr) {
        console.error("[WA Webhook] Failed to parse Kova JSON:", pErr);
        return new Response("ok", { headers: corsHeaders });
      }

      const parsed = parseKovaPayload(payload);
      messageId = kovaDelivery || parsed.messageId || "";
      from = normalizePhone(parsed.from) || parsed.from;
      text = parsed.text;
      fromMe = false;
      isImage = parsed.isImage;
      imageUrl = parsed.imageUrl || null;

      console.log(`[WA Webhook] Kova incoming from: ${from}, event: ${kovaEvent || "message"}, text: "${text.slice(0, 50)}", isImage: ${isImage}`);
    } else {
      // Incoming JSON (WaSender, Meta Cloud API, or raw Kova)
      const payload = await req.json().catch(() => null);
      if (payload?.action === "check_on_whatsapp" || payload?.action === "check_whatsapp") {
        const checkResult = await checkIsOnWhatsApp(payload.contact || payload.phone || payload.number || "");
        return new Response(JSON.stringify(checkResult), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (payload?.action === "session_status" || payload?.action === "status") {
        const sessionStatus = await getWaSenderStatus();
        return new Response(JSON.stringify(sessionStatus), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (payload?.entry || payload?.inbox_id || payload?.ticket || payload?.customer_id) {
        // Meta Cloud API or Kova without custom headers
        const parsed = parseKovaPayload(payload);
        messageId = parsed.messageId || "";
        from = normalizePhone(parsed.from) || parsed.from;
        text = parsed.text;
        fromMe = false;
        isImage = parsed.isImage;
        imageUrl = parsed.imageUrl || null;
        console.log(`[WA Webhook] Kova/Meta JSON incoming from: ${from}, text: "${text.slice(0, 50)}", isImage: ${isImage}`);
      } else if (payload?.event?.includes("message")) {
        // WaSender API
        const parsed = parseMessage(payload);
        messageId = parsed.id || "";
        from = parsed.from;
        text = parsed.text;
        fromMe = parsed.fromMe;
        isImage = parsed.isImage;
        imageUrl = parsed.imageUrl || null;
        imageBase64 = parsed.imageBase64 || null;
        imageMimeType = parsed.mimeType || "image/jpeg";
        console.log(`[WA Webhook] WaSender incoming from: ${from}, text: "${text.slice(0, 50)}", isImage: ${isImage}`);
      } else {
        return new Response("ok", { headers: corsHeaders });
      }
    }

    if (!from || (!text && !isImage) || fromMe) {
      if (isTwilio) {
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
          headers: { "Content-Type": "text/xml" },
          status: 200,
        });
      }
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      await supabase.from("system_logs").insert({
        source: "whatsapp-webhook",
        event: "webhook.incoming",
        level: "info",
        message: `Incoming WhatsApp from ${from}: "${text.slice(0, 50)}"`,
        data: { from, text: text.slice(0, 200), messageId, isKova, isTwilio },
      });
    } catch (_) {}

    // ── INCOMING DEDUPLICATION SAFEGUARD ─────────────────────────────────────
    // 1. In-memory short-burst dedup check (prevents double executions within 3.5s)
    const burstKey = `${from}:${messageId || text.trim().toLowerCase()}`;
    const now = Date.now();
    const lastSeen = inMemoryIncomingDedup.get(burstKey);
    if (lastSeen && (now - lastSeen) < 3500) {
      console.log(`[WA Webhook] Dropping burst duplicate webhook for key: ${burstKey} (${now - lastSeen}ms ago)`);
      if (isTwilio) {
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
          headers: { "Content-Type": "text/xml" },
          status: 200,
        });
      }
      return new Response("ok (duplicate)", { headers: corsHeaders });
    }
    inMemoryIncomingDedup.set(burstKey, now);

    // Prune stale cache entries if map grows
    if (inMemoryIncomingDedup.size > 2000) {
      for (const [k, ts] of inMemoryIncomingDedup.entries()) {
        if (now - ts > 10000) inMemoryIncomingDedup.delete(k);
      }
    }

    // 2. Database atomic deduplication via claim_whatsapp_webhook_message RPC
    if (messageId) {
      try {
        const { data: isClaimed, error: claimErr } = await supabase.rpc("claim_whatsapp_webhook_message", {
          p_message_id: messageId,
          p_from: from,
        });
        if (!claimErr && isClaimed === false) {
          console.log(`[WA Webhook] DB atomic duplicate dropped for messageId: ${messageId}`);
          if (isTwilio) {
            return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
              headers: { "Content-Type": "text/xml" },
              status: 200,
            });
          }
          return new Response("ok (duplicate)", { headers: corsHeaders });
        }
      } catch (rpcErr) {
        console.warn("[WA Webhook] Error checking claim_whatsapp_webhook_message:", rpcErr);
      }
    }

    // Load session
    const { data: sess } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("phone_number", from)
      .maybeSingle();

    let step: string = sess?.current_step || "MENU";
    let data: Record<string, any> = sess?.order_data || {};
    let agentId: string = sess?.agent_id || "";
    let input = text.toLowerCase().trim();

    // ── IMAGE COMPLAINT & SCREENSHOT DETECTION (MULTIMODAL GEMINI VISION) ─────
    if (isImage) {
      console.log(`[WA Bot] Processing incoming image message from ${from}...`);
      let visionData: any = null;
      let base64ToUse = imageBase64;
      let mimeToUse = imageMimeType || "image/jpeg";

      if (!base64ToUse && imageUrl) {
        const downloaded = await fetchImageAsBase64(imageUrl);
        if (downloaded) {
          base64ToUse = downloaded.base64;
          mimeToUse = downloaded.mimeType;
        }
      }

      if (base64ToUse) {
        const visionPrompt = `You are an expert OCR & customer care assistant for SwiftData Ghana (telecoms, airtime, and data bundles platform).
A customer submitted this screenshot as a complaint or inquiry on WhatsApp.
Carefully examine all text, badges, and numbers in the screenshot.
Extract:
1. "is_order_screenshot": true if this is an order status screen, payment receipt, SMS receipt, transaction screen, mobile money confirmation, or SwiftData dashboard/store page.
2. "reference": Any visible order ID, reference, or transaction hash (e.g. "8c1d2146", "#8c1d2146-e3c", or similar alphanumeric hash).
3. "phone": Recipient phone number (e.g. "0594132962", "024...", "055...").
4. "network": Telecom network (MTN, Telecel, Vodafone, AirtelTigo, AT).
5. "package": Package or volume (e.g. "1GB", "2GB", "5GB", "10GB", or GHS Airtime amount).
6. "amount": Price or charge in GHS (e.g. "4.94", "5.00").
7. "status": Visible status in the screenshot (e.g. "FULFILLMENT FAILED", "FAILED", "PENDING", "UNPAID", "SPAM", "SUCCESS").
8. "failure_reason": Any error message or note shown in the screenshot.
9. "summary": One concise sentence summarizing the complaint.

Return ONLY a valid JSON object matching these keys.`;

        visionData = await callGeminiVision(visionPrompt, base64ToUse, mimeToUse);
        console.log(`[WA Bot] Gemini Vision OCR extracted:`, JSON.stringify(visionData));
      }

      // Check customer's recent orders from database
      const normFrom = normalizePhone(from);
      const { data: recentOrders } = await supabase
        .from("orders")
        .select("id, status, network, package_size, amount, customer_phone, failure_reason, created_at, metadata")
        .or(`customer_phone.eq.${normFrom},customer_phone.eq.${from}`)
        .order("created_at", { ascending: false })
        .limit(10);

      let matchedOrder: any = null;

      // 1. Match by reference extracted by Gemini Vision
      if (visionData?.reference) {
        const rawRef = String(visionData.reference).replace(/[^a-zA-Z0-9-]/g, "").trim().toLowerCase();
        if (rawRef.length >= 4) {
          matchedOrder = recentOrders?.find((o: any) => o.id.toLowerCase().includes(rawRef));
          if (!matchedOrder) {
            const { data: directRefOrder } = await supabase
              .from("orders")
              .select("id, status, network, package_size, amount, customer_phone, failure_reason, created_at, metadata")
              .ilike("id", `%${rawRef}%`)
              .maybeSingle();
            if (directRefOrder) matchedOrder = directRefOrder;
          }
        }
      }

      // 2. Match by extracted recipient phone number
      if (!matchedOrder && visionData?.phone) {
        const normExtracted = normalizePhone(visionData.phone);
        matchedOrder = recentOrders?.find((o: any) =>
          normalizePhone(o.customer_phone) === normExtracted ||
          normalizePhone(o.metadata?.momo_number) === normExtracted
        );
      }

      // 3. Fallback: match sender's most recent failed, pending, or processing order
      if (!matchedOrder && recentOrders && recentOrders.length > 0) {
        matchedOrder = recentOrders.find((o: any) =>
          o.status === "fulfillment_failed" || o.status === "failed" || o.status === "pending" || o.status === "processing"
        ) || recentOrders[0];
      }

      if (matchedOrder) {
        data.lastOrderId = matchedOrder.id;
        data.lastFailedOrderId = matchedOrder.id;

        const shortId = matchedOrder.id.slice(0, 8).toUpperCase();
        const net = matchedOrder.network || visionData?.network || "MTN";
        const pkg = matchedOrder.package_size || visionData?.package || "1GB";
        const phone = matchedOrder.customer_phone || visionData?.phone || from;
        const isFailed = matchedOrder.status === "fulfillment_failed" ||
                         matchedOrder.status === "failed" ||
                         String(visionData?.status || "").toUpperCase().includes("FAIL");

        const replyLines = [
          `🤖 *SwiftData Intelligent Support*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `I see the screenshot of your ${isFailed ? "*failed*" : ""} *${net} ${pkg}* order (\`#${shortId}\`) for *${phone}*.`,
          ``,
        ];

        if (isFailed) {
          replyLines.push(
            `Status: *❌ FULFILLMENT FAILED*`,
            `🛡️ *Don't worry, your money is 100% safe!*`,
            ``,
            `👉 Reply *R* to automatically *Retry delivery now* 🔄`,
            `👉 Or chat with Human Care Desk: https://wa.me/233598170947`
          );
        } else {
          replyLines.push(
            `Status: *${matchedOrder.status.toUpperCase()}*`,
            ``,
            `👉 Reply *R* to re-check or retry delivery 🔄`,
            `👉 Or chat with Human Care Desk: https://wa.me/233598170947`
          );
        }

        replyLines.push(``, `_Reply 0 to return to Main Menu._`);

        await supabase.from("whatsapp_sessions").upsert({
          phone_number: from,
          agent_id: agentId || "",
          current_step: "LIVE_SUPPORT",
          order_data: data,
          updated_at: new Date().toISOString(),
        });

        await sendWhatsAppMessage(from, replyLines.join("\n"));

        if (isTwilio) {
          return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
            headers: { "Content-Type": "text/xml" },
            status: 200,
          });
        }
        return new Response("ok", { headers: corsHeaders });
      } else {
        const fallbackLines = [
          `👋 *SwiftData Customer Support*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Thank you for sending your screenshot!`,
        ];
        if (visionData?.summary) {
          fallbackLines.push(`_${visionData.summary}_`, ``);
        }
        fallbackLines.push(
          `We couldn't immediately link this to an active order for *${from}*.`,
          ``,
          `Please reply with your *Order ID* (or first 8 digits) or recipient phone number, or chat directly with our team:`,
          `👨‍💼 https://wa.me/233598170947`,
          ``,
          `_Reply 0 for Main Menu._`
        );

        await sendWhatsAppMessage(from, fallbackLines.join("\n"));
        if (isTwilio) {
          return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
            headers: { "Content-Type": "text/xml" },
            status: 200,
          });
        }
        return new Response("ok", { headers: corsHeaders });
      }
    }

    // ── GLOBAL: Self-Service Refund Command ─────────────────────────────────
    if (input.startsWith("refund") || input === "request refund" || input === "my refund" || input === "claim refund") {
      const refundReply = await processWhatsAppSelfServiceRefund(supabase, from, text);
      await sendWhatsAppMessage(from, refundReply);
      return new Response("ok", { headers: corsHeaders });
    }

    // ── GLOBAL: Self-Service Account Registration Command ───────────────────
    if (["register", "signup", "sign up", "create account", "new account", "new user", "join"].includes(input)) {
      const userMeta = await getUserProfileAndWallet(supabase, from);
      if (userMeta?.profile) {
        await sendWhatsAppMessage(from, [
          `ℹ️ *Account Already Active!*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Hi *${userMeta.profile.full_name || "Agent"}*! You already have an active account registered to phone \`${normalizePhone(from) || from}\`.`,
          `• *Wallet Balance:* GH₵ ${(userMeta.walletBalance || 0).toFixed(2)}`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `• Reply *BAL* to check balance & top up`,
          `• Reply *BUY 1GB ${normalizePhone(from) || from}* to order data instantly!`,
          ``,
          `_Reply 0 for Main Menu._`
        ].join("\n"));
        return new Response("ok", { headers: corsHeaders });
      }

      await supabase.from("whatsapp_sessions").upsert({
        phone_number: from,
        agent_id: agentId || "",
        current_step: "REG_FULL_NAME",
        order_data: {},
        updated_at: new Date().toISOString(),
      });

      await sendWhatsAppMessage(from, [
        `📝 *SwiftData Ghana Account Registration*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Welcome to SwiftData Ghana! Let's set up your free account in 30 seconds.`,
        ``,
        `Please reply with your *Full Name* (e.g. Senyo Kwami):`,
        ``,
        `_Reply 0 to cancel._`
      ].join("\n"));
      return new Response("ok", { headers: corsHeaders });
    }

    // ── GLOBAL: Self-Service Reseller Agent Onboarding Command ──────────────
    if (["become agent", "join agent", "upgrade agent", "agent signup", "register agent", "reseller signup", "upgrade to agent"].includes(input)) {
      const userMeta = await getUserProfileAndWallet(supabase, from);
      if (userMeta?.isAgent) {
        await sendWhatsAppMessage(from, [
          `💼 *Reseller Agent Account Active!*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Store: *${userMeta.profile?.store_name || "My Store"}*`,
          `Agent Code: *${(userMeta.profile?.referral_code || userMeta.profile?.slug || "").toUpperCase()}*`,
          ``,
          `Reply *AGENT* to access your Agent Hub & Performance Report!`,
          ``,
          `_Reply 0 for Main Menu._`
        ].join("\n"));
        return new Response("ok", { headers: corsHeaders });
      }

      const actFee = await getAgentActivationFee(supabase);
      await supabase.from("whatsapp_sessions").upsert({
        phone_number: from,
        agent_id: agentId || "",
        current_step: "AGENT_REG_STORE_NAME",
        order_data: { actFee },
        updated_at: new Date().toISOString(),
      });

      await sendWhatsAppMessage(from, [
        `💼 *Join SwiftData Reseller Agent Program*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Start your own telecom data business directly on WhatsApp!`,
        `• Wholesale rates & set your own prices to keep 100% profit`,
        `• Your custom WhatsApp bot link & web storefront`,
        `• One-Time Lifetime Activation Fee: *GH₵ ${actFee.toFixed(2)}*`,
        ``,
        `Please reply with your desired *Store Name* (e.g. Kwami Data Hub):`,
        ``,
        `_Reply 0 to cancel._`
      ].join("\n"));
      return new Response("ok", { headers: corsHeaders });
    }

    // ── GLOBAL: "r" or "retry" — instant automated order delivery retry ───────
    if (["r", "retry", "re-try", "retry order", "try again"].includes(input)) {
      let targetOrderId = data.lastFailedOrderId || data.lastOrderId;

      if (!targetOrderId) {
        const normFrom = normalizePhone(from);
        const { data: recentFail } = await supabase
          .from("orders")
          .select("id, status, network, package_size, customer_phone")
          .or(`customer_phone.eq.${normFrom},customer_phone.eq.${from}`)
          .in("status", ["fulfillment_failed", "failed", "pending"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recentFail) {
          targetOrderId = recentFail.id;
        }
      }

      if (!targetOrderId) {
        await sendWhatsAppMessage(from, [
          `ℹ️ *No pending or failed order found to retry.*`,
          `If you have your Order ID, please reply with it or reply *0* for the Main Menu.`
        ].join("\n"));
        return new Response("ok", { headers: corsHeaders });
      }

      const { data: orderToRetry } = await supabase
        .from("orders")
        .select("id, status, network, package_size, amount, customer_phone, failure_reason, retry_count, provider_order_id")
        .eq("id", targetOrderId)
        .maybeSingle();

      const shortId = targetOrderId.slice(0, 8).toUpperCase();
      const phone = orderToRetry?.customer_phone || from;
      const pkg = orderToRetry?.package_size || "bundle";
      const net = orderToRetry?.network || "Data";

      // 1. Anti-Duplicate Guard: Already fulfilled
      if (orderToRetry?.status === "fulfilled") {
        await sendWhatsAppMessage(from, [
          `✅ *Order Already Delivered!*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Order *#${shortId}* (${net} ${pkg}) for \`${phone}\` was already delivered successfully to the recipient line!`,
          ``,
          `No further retry is needed.`,
          `_Reply 0 for Main Menu._`
        ].join("\n"));
        return new Response("ok", { headers: corsHeaders });
      }

      // 2. Anti-Duplicate Guard: Actively in-transit with carrier provider
      const hasActiveProviderRef = Boolean(
        orderToRetry?.provider_order_id &&
        orderToRetry.provider_order_id !== "failed_api_call" &&
        orderToRetry.provider_order_id !== "timeout" &&
        orderToRetry.provider_order_id !== "routed"
      );
      if (orderToRetry?.status === "processing" && hasActiveProviderRef) {
        await sendWhatsAppMessage(from, [
          `⏳ *Order Already Processing!*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Order *#${shortId}* is currently in transit with the mobile carrier network for \`${phone}\`.`,
          ``,
          `To protect you from duplicate charges, please allow 1-2 minutes for carrier delivery.`,
          `_Reply 0 for Main Menu._`
        ].join("\n"));
        return new Response("ok", { headers: corsHeaders });
      }

      // 3. Financial & Loss Shield: Terminal recipient line errors (barred, invalid, payee limit)
      if (isNonRetryableTerminalError(orderToRetry?.failure_reason)) {
        await sendWhatsAppMessage(from, [
          `❌ *Automatic Retry Not Available*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Order *#${shortId}* failed due to a mobile network restriction on \`${phone}\`:`,
          `_${orderToRetry?.failure_reason}_`,
          ``,
          `🛡️ *Your money is 100% safe.*`,
          `To prevent duplicate debits, our human care team will help you change the number or receive a refund:`,
          `👨‍💼 https://wa.me/233598170947`,
          ``,
          `_Reply 0 for Main Menu._`
        ].join("\n"));
        return new Response("ok", { headers: corsHeaders });
      }

      // 4. Max Retries Shield
      if (Number(orderToRetry?.retry_count || 0) >= 2) {
        await sendWhatsAppMessage(from, [
          `⚠️ *Maximum Retries Reached*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Order *#${shortId}* has reached the maximum retry limit.`,
          `Our engineering desk has been notified and will resolve this manually:`,
          `👨‍💼 https://wa.me/233598170947`,
          ``,
          `_Reply 0 for Main Menu._`
        ].join("\n"));
        return new Response("ok", { headers: corsHeaders });
      }

      await sendWhatsAppMessage(from, [
        `🔄 *Retrying Delivery for Order #${shortId}...*`,
        `Please hold on while we re-route your *${net} ${pkg}* to *${phone}*. This takes about 15-30 seconds.`
      ].join("\n"));

      try {
        await supabase
          .from("orders")
          .update({ 
            status: "paid",
            retry_count: (Number(orderToRetry?.retry_count || 0) + 1),
            last_retry_at: new Date().toISOString()
          })
          .eq("id", targetOrderId)
          .in("status", ["pending", "fulfillment_failed", "failed"]);

        const vRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reference: targetOrderId }),
        });

        const vJson = await vRes.json().catch(() => null);

        if (vJson?.status === "fulfilled" || vJson?.success === true) {
          await sendWhatsAppMessage(from, [
            `🎉 *Order Fulfilled Successfully!*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Your *${net} ${pkg}* bundle (\`#${shortId}\`) has been delivered to *${phone}*! 🚀`,
            ``,
            `Thank you for your patience and for choosing SwiftData!`,
            `_Reply 0 for Main Menu._`
          ].join("\n"));
        } else {
          const reason = vJson?.failure_reason || vJson?.error || "Temporary upstream network delay";
          await sendWhatsAppMessage(from, [
            `⚠️ *Retry Status Update*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `We re-attempted delivery for order \`#${shortId}\`, but the network provider reported:`,
            `_${String(reason).slice(0, 140)}_`,
            ``,
            `🛡️ *Your money is 100% safe.*`,
            `Our engineering team has been alerted to review this. You can also chat directly with human support:`,
            `👨‍💼 https://wa.me/233598170947`,
            ``,
            `_Reply *R* to try again later, or *0* for Main Menu._`
          ].join("\n"));
        }
      } catch (err) {
        console.error("[WA Bot] Error retrying order:", err);
        await sendWhatsAppMessage(from, [
          `⚠️ *Retry In Progress*`,
          `We initiated your retry for order \`#${shortId}\`. If the delivery doesn't reflect within 5 minutes, our team will process it manually.`,
          ``,
          `_Reply 0 for Main Menu._`
        ].join("\n"));
      }

      return new Response("ok", { headers: corsHeaders });
    }

    // ── GLOBAL: "done" — verify payment ──────────────────────────────────────
    if (input === "done" && data.lastOrderId) {
      try {
        const paystackKey = await getPaystackSecretKey(supabase);
        const vRes = await fetch(`https://api.paystack.co/transaction/verify/${data.lastOrderId}`, {
          headers: { Authorization: `Bearer ${paystackKey}` },
        });
        const vJson = await vRes.json();

        if (vJson.status && vJson.data?.status === "success") {
          await supabase.from("orders").update({ status: "paid" }).eq("id", data.lastOrderId).in("status", ["pending", "fulfillment_failed"]);

          // Trigger instant verification & provider fulfillment
          try {
            fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ reference: data.lastOrderId })
            }).catch(console.error);
          } catch (_err) {
            console.warn("[WA Bot] Verify dispatch error:", _err);
          }

          await supabase.from("whatsapp_sessions").delete().eq("phone_number", from);

          if (data.utilityType || data.utilityProvider) {
            await sendWhatsAppMessage(from, [
              `⚡ *Payment Confirmed! Your ${data.utilityProvider || "ECG"} Order is Processing*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `• *Meter/Account:* \`${data.utilityAccount}\``,
              data.utilityAccountName ? `• *Account Name:* *${data.utilityAccountName}*` : "",
              `• *Amount:* GH₵ ${(data.utilityAmount || data.totalPrice || 0).toFixed(2)}`,
              ``,
              `Your power recharge has been verified and submitted to ECG servers. For prepaid meters, your recharge token will be delivered via SMS shortly! 💡`,
              ``,
              `_Reply 0 for Main Menu._`
            ].filter(Boolean).join("\n"));
          } else if (data.voucherType) {
            await sendWhatsAppMessage(from, [
              `🎓 *Payment Confirmed! Your Result Checker is Ready*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `• *Exam:* ${data.voucherType}`,
              `• *Quantity:* ${data.voucherQty || 1}`,
              `• *Recipient:* \`${data.voucherRecipient || from}\``,
              ``,
              `Your WAEC Serial Number & PIN are being generated and sent to your phone via SMS right now! 📲`,
              ``,
              `_Reply 0 for Main Menu._`
            ].join("\n"));
          } else if (data.topupAmount) {
            const topupUserId = data.topupAgentId || data.authProfile?.user_id || vJson.data?.metadata?.agent_id;
            const creditAmt = Number(data.topupAmount || vJson.data?.metadata?.wallet_credit || 0);

            let newBalanceMsg = "";
            if (topupUserId && creditAmt > 0) {
              const { data: credRes, error: credErr } = await supabase.rpc("credit_wallet", {
                p_agent_id: topupUserId,
                p_amount: creditAmt
              });
              console.log("[WA Bot] credit_wallet executed:", credRes, credErr);
              await supabase.from("orders").update({
                status: "fulfilled",
                paystack_verified_amount: vJson.data?.amount ? vJson.data.amount / 100 : creditAmt
              }).eq("id", data.lastOrderId);

              if (credRes?.new_balance !== undefined) {
                newBalanceMsg = `\n• *New Wallet Balance:* *GH₵ ${Number(credRes.new_balance).toFixed(2)}*`;
              }
            }

            await sendWhatsAppMessage(from, [
              `💰 *Wallet Top-Up Confirmed & Credited!*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `• *Amount Credited:* GH₵ ${Number(data.topupAmount).toFixed(2)}`,
              `• *Payment Status:* ✅ Successful (Paystack Verified)`,
              `• *Reference:* \`${data.lastOrderId}\`${newBalanceMsg}`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Your SwiftData wallet has been credited successfully and is ready to use! 🚀`,
              ``,
              `_Reply 0 for Main Menu._`
            ].join("\n"));
          } else {
            const orderLabel = data.afaPhone ? "AFA Registration" : `*${data.net || ""} ${data.pkg || "airtime"}*`;
            await sendWhatsAppMessage(from, [
              `✅ *Payment Confirmed!*`,
              ``,
              `Your *${orderLabel}* order is being processed and will arrive shortly. 🚀`,
              ``,
              `_Reply *Hi* anytime to place a new order._`,
            ].join("\n"));
          }

          if (data.recipient) {
            sendPaymentSms(supabase, data.recipient, "payment_success", { phone: data.recipient }).catch(console.error);
          }
        } else {
          await sendWhatsAppMessage(from, [
            `⚠️ *Payment not confirmed yet.*`,
            ``,
            `Please make sure you approved the MoMo prompt on your phone and entered your PIN, then reply *Done* again.`,
            ``,
            `_Reply *0* to cancel and start over._`,
          ].join("\n"));
        }
      } catch (e) {
        console.error("[WA Bot] Payment verify error:", e);
        await sendWhatsAppMessage(from, `⚠️ Could not check payment right now. Please try again in a moment.`);
      }
      return new Response("ok");
    }

    // ── GLOBAL: Anti-Ban Opt-Out / STOP Compliance ───────────────────────────
    const normFromPhone = normalizePhone(from) || from.replace(/\D/g, "");
    if (["stop", "unsubscribe", "optout", "opt out", "cancel notifications", "stop promo", "stop promos", "end"].includes(input)) {
      try {
        await supabase.from("whatsapp_opt_outs").upsert({
          phone: normFromPhone,
          reason: "user_requested_stop"
        }, { onConflict: "phone" });
        await supabase.from("profiles").update({ whatsapp_opt_out: true }).or(`phone.eq.${normFromPhone},whatsapp_number.eq.${normFromPhone}`);
      } catch (optErr) {
        console.error("[WA Anti-Ban] Error saving opt-out:", optErr);
      }

      await sendWhatsAppMessage(from, [
        `🛑 *Promotional Notifications Paused*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `You have been unsubscribed from automated marketing announcements and promotional alerts.`,
        ``,
        `💡 _You will still receive your direct purchase receipts and transaction codes whenever you order._`,
        ``,
        `• Reply *START* anytime to re-enable promotional updates.`,
        `• Reply *0* or *Hi* to browse data bundles & airtime.`
      ].join("\n"));
      return new Response("ok");
    }

    if (["start promo", "unstop", "resubscribe", "enable notifications"].includes(input)) {
      try {
        await supabase.from("whatsapp_opt_outs").delete().eq("phone", normFromPhone);
        await supabase.from("profiles").update({ whatsapp_opt_out: false }).or(`phone.eq.${normFromPhone},whatsapp_number.eq.${normFromPhone}`);
      } catch (optErr) {
        console.error("[WA Anti-Ban] Error removing opt-out:", optErr);
      }

      await sendWhatsAppMessage(from, [
        `✅ *Promotional Notifications Active!*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `You're all set to receive exclusive bundle deals, network status alerts, and flash discounts! 🎉`,
        ``,
        `_Reply 0 or Hi to view the menu._`
      ].join("\n"));
      return new Response("ok");
    }

    // ── GLOBAL: reset commands ────────────────────────────────────────────────
    const isResetCmd = ["0", "hi", "hello", "hey", "start", "cancel", "menu", "main menu", "help", "swiftdata", "swiftdatagh", "swift", "official"].includes(input);
    if (isResetCmd) {
      step = "MENU";
      const currentMode = data.viewMode;
      data = currentMode ? { viewMode: currentMode } : {};
      // If user sends 'swiftdata', 'swiftdatagh', 'official', or resets via '0'/'menu'/'cancel', return to flagship SwiftData Ghana
      if (["swiftdata", "swiftdatagh", "swift", "official", "0", "cancel", "menu"].includes(input)) {
        agentId = "";
      }
    }

    const senderProfileMeta = await getUserProfileAndWallet(supabase, from);
    const senderProfile = senderProfileMeta?.profile;
    const isSenderAdmin = Boolean(senderProfileMeta?.isAdmin);
    const isSenderAgent = Boolean(senderProfileMeta?.isAgent);

    // ── GLOBAL: Role-Aware Mode Switching ──────────────────────────────────────
    if (["admin", "admin menu", "dashboard", "admin terminal", "superadmin"].includes(input)) {
      if (isSenderAdmin) {
        step = "ADMIN_MENU";
        data.viewMode = "admin";
        input = "";
      } else {
        await sendWhatsAppMessage(from, "🔒 *Access Denied:* Your WhatsApp number is not authorized for Admin Terminal access.");
        return new Response("ok");
      }
    } else if (isSenderAdmin && (input === "broadcast" || input === "announce" || input === "notify sessions")) {
      step = "SELECT_ADMIN_SERVICE";
      input = "7";
    } else if (["agent", "agent menu", "reseller", "reseller menu", "agent hub", "agent portal"].includes(input)) {
      if (isSenderAgent || isSenderAdmin) {
        step = "AGENT_MENU";
        data.viewMode = "agent";
        input = "";
      } else {
        await sendWhatsAppMessage(from, "🔒 *Access Denied:* You do not have an active Reseller Agent account.\n\nReply *12* from the main menu to join our Agent Program!");
        return new Response("ok");
      }
    } else if (["customer", "retail", "shop", "user", "buyer", "client"].includes(input)) {
      step = "MENU";
      data.viewMode = "customer";
      input = "";
    }

    // ── Explicit Agent Linking by Code / Name anytime ──────────────────────────
    const agentCodeMatch = text.match(/^(?:code|agent|store|vendor|ref)\s+([a-z0-9_-]+)$/i);
    if (agentCodeMatch) {
      const codeWord = agentCodeMatch[1].trim();
      const found = await getAgent(supabase, codeWord);
      if (found) {
        agentId = found.id;
        data = { ...data, agentId: found.id };
        step = "SELECT_SERVICE";
        input = "";
        await supabase
          .from("whatsapp_sessions")
          .upsert({
            phone_number: from,
            agent_id: found.id,
            current_step: "SELECT_SERVICE",
            order_data: data,
            updated_at: new Date().toISOString(),
          });

        const agentWelcome = [
          `✅ *Connected to ${found.name}!*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `You are now shopping with *${found.name}*'s special bundle rates.`,
          ``,
          `Please choose a service:`,
          `*1* — Buy Data 📶`,
          `*2* — Buy Airtime 📱`,
          `*3* — MTN Mash Up ⚡`,
          `*4* — ECG Electricity 💡`,
          `*5* — Water & Pay TV Bills 💧`,
          `*6* — WAEC Result Checker 🎓`,
          `*7* — Verify MTN Beneficiary 🛡️`,
          `*8* — Wallet Balance 💰`,
          `*9* — Track Order 🔍`,
          `*10* — Contact Store Support 🎧`,
          ``,
          `_Reply with a number (1-10) to begin._`
        ].join("\n");
        await sendWhatsAppMessage(from, agentWelcome);
        return new Response("ok", { headers: corsHeaders });
      } else {
        await sendWhatsAppMessage(
          from,
          `❌ *Agent Code Not Found*\n\nWe couldn't find an active agent with code *${agentCodeMatch[1].toUpperCase()}*. Please check the spelling or reply *0* for main menu.`
        );
        return new Response("ok", { headers: corsHeaders });
      }
    }

    // ── Agent detection on first contact ─────────────────────────────────────
    if (step === "MENU" && !agentId) {
      for (const rawWord of text.split(/\s+/)) {
        const word = rawWord.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!word || ["hi", "hello", "hey", "menu", "start", "swiftdata", "swiftdatagh", "swift", "data", "ghana", "0", "help"].includes(word)) continue;
        const found = await getAgent(supabase, word);
        if (found) { agentId = found.id; break; }
      }
    }

    // Direct users belong to official SwiftData Ghana brand (clear any stale Fredi fallback ID)
    if (agentId === "8a0c1533-7e85-4626-9479-eb770a6739e2") {
      agentId = "";
    }

    const agent = agentId ? await getAgent(supabase, agentId, true) : null;
    const storeName = agent?.name || "SwiftData Ghana";

    // ── NLP / Direct Beneficiary Verification Check ────────────────────────
    const isBeneficiaryCmd = !isResetCmd &&
      /\b(beneficiary|whitelist|verify\s*number|check\s*number|check\s*beneficiary|verify\s*beneficiary|check\s*mtn|verify\s*mtn)\b/i.test(text);

    if (isBeneficiaryCmd) {
      const phoneMatch = text.match(/\b(0[235][0-9]{8}|233[235][0-9]{8})\b/);
      if (phoneMatch) {
        const checkPhone = normalizePhone(phoneMatch[1]);
        const vResult = await verifyBeneficiary(checkPhone);
        let resp = "";
        if (vResult.isVerified) {
          resp = [
            `✅ *Beneficiary Verified!*`,
            `────────────────────`,
            `📱 *Number:* \`${checkPhone}\``,
            `⚡ *Network:* MTN Ghana`,
            `📊 *Status:* *Active & Whitelisted*`,
            ``,
            `This number is registered on the MTN beneficiary list and ready to receive instant automated data bundles!`,
            ``,
            `_Reply 1 to Buy Data now, or 0 for Menu._`
          ].join("\n");
        } else {
          resp = [
            `⚠️ *Beneficiary Verification Result*`,
            `────────────────────`,
            `📱 *Number:* \`${checkPhone}\``,
            `⚡ *Network:* MTN Ghana`,
            `📊 *Status:* *Not Whitelisted*`,
            ``,
            `*How to add to MTN Beneficiary Whitelist:* `,
            `1. Dial **170#** on your phone`,
            `2. Select *Option 1 (Transfer Money)*`,
            `3. Select *Option 5 (Other Networks)* or *Option 1 (MoMo User)*`,
            `4. Enter *${checkPhone}* and send a small transfer (e.g. GH₵ 1) to whitelist it.`,
            ``,
            `💡 *Good News:* You can still place your order! Our system will automatically route delivery through instant carrier channels.`,
            ``,
            `_Reply 1 to Buy Data, or 0 for Menu._`
          ].join("\n");
        }
        await sendWhatsAppMessage(from, resp);
        return new Response("ok");
      } else {
        step = "ENTER_BENEFICIARY_CHECK_PHONE";
        await supabase.from("whatsapp_sessions").upsert({
          phone_number: from,
          agent_id: agentId || "",
          step: "ENTER_BENEFICIARY_CHECK_PHONE",
          data: {},
          updated_at: new Date().toISOString(),
        });
        const promptMsg = [
          `🔍 *Check MTN Beneficiary Whitelist*`,
          `────────────────────`,
          `Check if your MTN recipient number is registered to receive data bundles smoothly without network delays.`,
          ``,
          `📱 *Please enter the 10-digit MTN phone number:* `,
          `_Example: 0244123456_`,
          ``,
          `_Reply 0 to go back to Menu._`
        ].join("\n");
        await sendWhatsAppMessage(from, promptMsg);
        return new Response("ok");
      }
    }

    // ── Instant Heuristic NLP Fast-Path (<1ms, no network latency) ───────────
    if (step === "MENU" && !isResetCmd && !["1", "2", "3", "4", "5", "yes", "y"].includes(input)) {
      // 1. Direct Quick Order NLP Check (e.g. "mtn 1gb 0244123456" or "telecel 2gb 0501234567")
      const quickOrder = parseQuickOrderText(text);
      if (quickOrder) {
        try {
          const pkgs = await getPackagesForNetwork(supabase, quickOrder.network, agent?.prices || {});
          const matched = pkgs.find(p => p.size.toUpperCase() === quickOrder.packageSize.toUpperCase());
          if (matched) {
            data.net = quickOrder.network;
            data.pkg = matched.size;
            data.recipient = quickOrder.recipient;
            data.basePrice = matched.basePrice;
            data.totalPrice = matched.total;
            data.isAirtime = false;

            const normFrom = normalizePhone(from);
            const isFromGhana = normFrom && normFrom.length === 10 && normFrom.startsWith("0");

            const lines = [
              `⚡ *Smart Order Detected!*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `📶 Network:   *${quickOrder.network}*`,
              `📦 Bundle:    *${matched.size}*`,
              `👤 Recipient: \`${quickOrder.recipient}\``,
              `💰 You Pay:   *GH₵ ${matched.total.toFixed(2)}*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Please provide the Mobile Money (MoMo) number to pay:`,
              ``,
              `• Reply *1* to pay with recipient number (\`${quickOrder.recipient}\`)`,
            ];
            if (isFromGhana && normFrom !== quickOrder.recipient) {
              lines.push(`• Reply *2* to pay with your WhatsApp number (\`${normFrom}\`)`);
            }
            lines.push(
              `• Or type any other 10-digit MoMo number (e.g. \`0244123456\`)`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `_Reply 0 to cancel._`
            );

            await supabase.from("whatsapp_sessions").upsert({
              phone_number: from,
              agent_id: agentId || "",
              current_step: "ENTER_PAYER_MOMO",
              order_data: data,
              updated_at: new Date().toISOString(),
            });
            await sendWhatsAppMessage(from, lines.join("\n"));
            return new Response("ok", { headers: corsHeaders });
          }
        } catch (err) {
          console.warn("[WA Bot] Quick order parse error:", err);
        }
      }

      // 2. Keyword heuristic routing (<1ms)
      const lower = text.toLowerCase();
      if (/\b(data|bundle|bundles|gig|gigs|gb|mb)\b/.test(lower) && !lower.includes("history")) {
        step = "SELECT_SERVICE";
        input = "1";
      } else if (/\b(airtime|credit|recharge|topup\s*phone)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "2";
      } else if (/\b(mashup|mash\s*up|mash)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "3";
      } else if (/\b(track|order\s*status|check\s*order|my\s*order)\b/.test(lower) || /[0-9a-f]{8}-[0-9a-f]{4}/.test(lower)) {
        const potentialPhoneOrId = text.replace(/\b(track|order|status|check|my|for)\b/gi, "").trim();
        const extractedDigits = potentialPhoneOrId.replace(/\D/g, "");
        if ((extractedDigits.length >= 9 && extractedDigits.length <= 13) || /^[0-9a-f]{8}/i.test(potentialPhoneOrId)) {
          step = "TRACK_ORDER";
          text = potentialPhoneOrId;
          input = potentialPhoneOrId;
        } else {
          step = "SELECT_SERVICE";
          input = "4";
        }
      } else if (/\b(more|menu\s*2|other|services|bills|utilities)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "5";
      } else if (/\b(ecg|light|power|prepaid\s*meter|postpaid\s*meter)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "ecg";
      } else if (/\b(water|gwcl|dstv|gotv|startimes)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "water";
      } else if (/\b(waec|wassce|bece|checker|result\s*checker)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "waec";
      } else if (/\b(beneficiary|whitelist)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "beneficiary";
      } else if (/\b(wallet|balance|my\s*wallet)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "wallet";
      } else if (/\b(support|help|customer\s*care|care|complaint|human|talk\s*to\s*someone)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "support";
      } else if (/\b(orders|history|recent\s*orders)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "history";
      } else if (/\b(portal|become\s*an\s*agent|join\s*agent|reseller)\b/.test(lower)) {
        step = "SELECT_SERVICE";
        input = "portal";
      } else {
        // 3. Fallback to Gemini AI (Fast 4.5s timeout)
        let customPrompt = SYSTEM_PROMPT;
        try {
          const { data: settingsData } = await supabase
            .from("v_system_settings_with_secrets").select("whatsapp_bot_prompt")
            .eq("id", 1)
            .maybeSingle();
          if (settingsData && settingsData.whatsapp_bot_prompt && settingsData.whatsapp_bot_prompt.trim().length > 0) {
            customPrompt = settingsData.whatsapp_bot_prompt;
          }
        } catch (err) {
          console.error("Failed to fetch custom bot prompt:", err);
        }

        const aiResponse = await callGemini(`${customPrompt.replace(/\{\{storeName\}\}/g, storeName)}\n\nUser Message: "${text}"\n\nAnalyze the intent and respond with a friendly message or identify the service needed.`);
        if (aiResponse) {
          if (aiResponse.includes("BUY_DATA") || text.toLowerCase().includes("data")) {
            step = "SELECT_SERVICE";
            input = "1";
          } else if (aiResponse.includes("BUY_AIRTIME") || text.toLowerCase().includes("airtime")) {
            step = "SELECT_SERVICE";
            input = "2";
          } else if (aiResponse.includes("MASHUP") || text.toLowerCase().includes("mashup") || text.toLowerCase().includes("mash up")) {
            step = "SELECT_SERVICE";
            input = "3";
          } else if (aiResponse.includes("TRACK") || text.toLowerCase().includes("track")) {
            step = "SELECT_SERVICE";
            input = "4";
          } else if (aiResponse.includes("ECG") || text.toLowerCase().includes("ecg") || text.toLowerCase().includes("meter") || text.toLowerCase().includes("power") || text.toLowerCase().includes("light")) {
            step = "SELECT_SERVICE";
            input = "ecg";
          } else if (aiResponse.includes("UTILITY") || text.toLowerCase().includes("water") || text.toLowerCase().includes("dstv") || text.toLowerCase().includes("gotv") || text.toLowerCase().includes("startimes")) {
            step = "SELECT_SERVICE";
            input = "water";
          } else if (aiResponse.includes("CHECKER") || aiResponse.includes("WAEC") || text.toLowerCase().includes("checker") || text.toLowerCase().includes("waec") || text.toLowerCase().includes("wassce") || text.toLowerCase().includes("bece")) {
            step = "SELECT_SERVICE";
            input = "waec";
          } else if (aiResponse.includes("BENEFICIARY") || text.toLowerCase().includes("beneficiary") || text.toLowerCase().includes("whitelist")) {
            step = "SELECT_SERVICE";
            input = "beneficiary";
          } else if (aiResponse.includes("WALLET") || text.toLowerCase().includes("wallet") || text.toLowerCase().includes("balance") || text.toLowerCase().includes("topup")) {
            step = "SELECT_SERVICE";
            input = "wallet";
          } else if (aiResponse.includes("SUPPORT") || aiResponse.includes("AGENT") || text.toLowerCase().includes("agent") || text.toLowerCase().includes("human") || text.toLowerCase().includes("care") || text.toLowerCase().includes("complain")) {
            step = "SELECT_SERVICE";
            input = "support";
          } else if (aiResponse.includes("HISTORY") || text.toLowerCase().includes("order history") || text.toLowerCase().includes("recent order")) {
            step = "SELECT_SERVICE";
            input = "history";
          } else if (aiResponse.includes("PORTAL") || aiResponse.includes("RESELLER") || text.toLowerCase().includes("become an agent")) {
            step = "SELECT_SERVICE";
            input = "portal";
          } else if (aiResponse.includes("CHANNEL") || text.toLowerCase().includes("channel")) {
            step = "SELECT_SERVICE";
            input = "channel";
          } else if (aiResponse.includes("API") || text.toLowerCase().includes("developer") || text.toLowerCase().includes("api")) {
            step = "SELECT_SERVICE";
            input = "api";
          } else {
            await sendWhatsAppMessage(from, sanitizePublicFailureReason(aiResponse));
            return new Response("ok", { headers: corsHeaders });
          }
        }
      }
    }

    let reply = "";
    let nextStep = step;

    // ── State machine ─────────────────────────────────────────────────────────
    switch (step) {
      // ── Self-Service Registration & Onboarding Steps ────────────────────────
      case "REG_FULL_NAME":
      case "REG_EMAIL": {
        const regRes = await handleUserRegistrationStep(supabase, from, step, text, data);
        await sendWhatsAppMessage(from, regRes.reply);
        await supabase.from("whatsapp_sessions").upsert({
          phone_number: from,
          agent_id: agentId || "",
          current_step: regRes.nextStep,
          order_data: regRes.updatedData,
          updated_at: new Date().toISOString(),
        });
        return new Response("ok", { headers: corsHeaders });
      }

      case "AGENT_REG_STORE_NAME":
      case "AGENT_REG_PAY_CHOICE":
      case "AGENT_REG_MOMO_PHONE": {
        const agRes = await handleAgentRegistrationStep(supabase, from, step, text, data);
        await sendWhatsAppMessage(from, agRes.reply);
        await supabase.from("whatsapp_sessions").upsert({
          phone_number: from,
          agent_id: agentId || "",
          current_step: agRes.nextStep,
          order_data: agRes.updatedData,
          updated_at: new Date().toISOString(),
        });
        return new Response("ok", { headers: corsHeaders });
      }

      // ── MENU ─────────────────────────────────────────────────────────────────
      case "MENU": {
        // Check for recent successful order to offer 1-tap reorder
        const normFrom = normalizePhone(from);
        const { data: lastOrder } = await supabase
          .from("orders")
          .select("id, network, package_size, amount, customer_phone, metadata")
          .or(`customer_phone.eq.${normFrom},customer_phone.eq.${from}`)
          .in("status", ["fulfilled", "paid"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const reorderLines: string[] = [];
        if (lastOrder && (lastOrder.package_size || lastOrder.amount)) {
          data.reorderOrder = lastOrder;
          const pkgDesc = lastOrder.package_size ? `${lastOrder.network} ${lastOrder.package_size}` : `${lastOrder.network} GH₵ ${Number(lastOrder.amount).toFixed(2)} Airtime`;
          reorderLines.push(
            `⚡ *1-TAP FAST REORDER AVAILABLE:*`,
            `Reply *YES* to quickly repeat your last order:`,
            `👉 *${pkgDesc}* for \`${lastOrder.customer_phone}\``,
            ``
          );
        }

        const effectiveMode = data.viewMode || (isSenderAdmin && !agentId ? "admin" : (isSenderAgent && !agentId ? "agent" : "customer"));

        if (effectiveMode === "admin") {
          reply = formatAdminMenu(senderProfile?.full_name || "Admin");
          nextStep = "SELECT_ADMIN_SERVICE";
          break;
        }

        if (effectiveMode === "agent") {
          const storeTitle = senderProfile?.store_name || senderProfile?.full_name || "My Store";
          const bal = Number(senderProfileMeta?.walletBalance || 0);
          const slug = senderProfile?.slug || "";
          const agentCode = (senderProfile?.referral_code || slug || "").toUpperCase();
          reply = formatAgentMenu(storeTitle, bal, slug, agentCode);
          nextStep = "SELECT_AGENT_SERVICE";
          break;
        }

        reply = formatMainMenu(
          agent,
          storeName,
          senderProfile,
          senderProfileMeta,
          isSenderAdmin,
          isSenderAgent,
          WHATSAPP_BOT_NUMBER,
          data.reorderOrder
        );
        nextStep = "SELECT_SERVICE";
        break;
      }

      // ── Service selection ─────────────────────────────────────────────────────
      case "SELECT_SERVICE": {
        if ((input === "yes" || input === "y") && data.reorderOrder) {
          const o = data.reorderOrder;
          if (o.package_size) {
            data.net = o.network;
            data.pkg = o.package_size;
            data.recipient = o.customer_phone;
            data.payerMoMo = o.metadata?.momo_number || o.customer_phone;
            data.isAirtime = false;
            
            const pkgs = await getPackagesForNetwork(supabase, o.network, agent?.prices || {});
            const match = pkgs.find(p => p.size.toUpperCase() === o.package_size.toUpperCase());
            const base = match ? match.basePrice : Number(o.amount || 0);
            data.basePrice = base;
            data.totalPrice = addPaystackFee(base);
            data.isReorder = true;

            reply = [
              `⚡ *Confirm Fast Reorder*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `📶 Network:   *${o.network}*`,
              `📦 Package:   *${o.package_size}*`,
              `📱 Recipient: \`${o.customer_phone}\``,
              `💰 Total:     *GH₵ ${data.totalPrice.toFixed(2)}*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              ``,
              `Reply *1* to send MoMo payment prompt ✅`,
              `Reply *0* to cancel ❌`,
            ].join("\n");
            nextStep = "CONFIRM_ORDER";
          } else {
            data.net = o.network;
            data.airtimeBase = Number(o.amount || 0);
            data.recipient = o.customer_phone;
            data.isAirtime = true;
            data.isReorder = true;

            reply = [
              `⚡ *Confirm Fast Reorder (Airtime)*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `📱 Network:   *${o.network}*`,
              `💰 Amount:    *GH₵ ${data.airtimeBase.toFixed(2)}*`,
              `📱 Recipient: \`${o.customer_phone}\``,
              `━━━━━━━━━━━━━━━━━━━━`,
              ``,
              `Reply *1* to send MoMo payment prompt ✅`,
              `Reply *0* to cancel ❌`,
            ].join("\n");
            nextStep = "CONFIRM_ORDER";
          }
        } else if (input === "1" || input.includes("data") || input.includes("bundle")) {
          reply = `📶 *Select Network:*\n\n*1* — MTN\n*2* — Telecel\n*3* — AirtelTigo\n\n_Reply 0 to go back_`;
          nextStep = "SELECT_NET_DATA";
        } else if (input === "2" || input.includes("airtime") || input.includes("credit") || input.includes("recharge")) {
          reply = `📱 *Select Network for Airtime:*\n\n*1* — MTN\n*2* — Telecel\n*3* — AirtelTigo\n\n_Reply 0 to go back_`;
          nextStep = "SELECT_NET_AIRTIME";
        } else if (input === "3" || input.includes("mashup") || input.includes("mash up") || input.includes("mash")) {
          data.net = "MTN";
          data.isAirtime = false;
          data.mtnCategory = "mashup";
          data.categoryLabel = "MTN Mash Up";

          let pkgs: Pkg[] = [];
          try {
            pkgs = await getPackagesForNetwork(supabase, "MTN", agent?.prices || {}, "mashup");
          } catch (err) {
            console.error("[WA Bot] Error in mashup fetch:", err);
          }

          if (pkgs.length > 0) {
            data.pkgList = pkgs;
            const lines = pkgs.map((p, i) => `*${i + 1}*. ${p.size} — GH₵ ${p.total.toFixed(2)}`);
            reply = `✨ *MTN Mash Up Packages:*\n_(Voice & Data combo bundles)_\n\n${lines.join("\n")}\n\n_Reply with the package number — or 0 to go back_`;
            nextStep = "SELECT_PACKAGE";
          } else {
            reply = [
              `✨ *MTN Mash Up & Special Bundles:*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `*1* — 🏷️ Affordable SME Bundles`,
              `*2* — ⚡ Instant: Data Bundles`,
              `*3* — 🕒 Instant: Midnight Bundles`,
              `*4* — 💬 Instant: Social Media Bundles`,
              `*5* — 🎥 Instant: Video Bundles`,
              `*6* — 🌐 Instant: IDD Bundles`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `_Reply with a number from 1 to 6 — or 0 to go back_`
            ].join("\n");
            nextStep = "SELECT_MTN_CATEGORY";
          }
        } else if (input === "4" || input.includes("track")) {
          reply = [
            `🔍 *Live Order Tracking & System Diagnostics*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Please reply with your **Phone Number** (e.g. \`0547636024\`) or your **Order ID**.`,
            ``,
            `💡 _Tip: You can simply enter the recipient number that received the bundle!_`,
            ``,
            `_Reply with a phone number, or reply 0 for Menu._`
          ].join("\n");
          nextStep = "TRACK_ORDER";
        } else if (input === "5" || input.includes("more") || input.includes("service") || input.includes("bill") || input.includes("utility") || input.includes("other")) {
          reply = formatMoreMenu(agent?.name || storeName || "SwiftData Ghana");
          nextStep = "MORE_MENU";
        } else if (input.includes("ecg") || input.includes("electricity") || input.includes("meter") || input.includes("light") || input.includes("power")) {
          data.isUtility = true;
          data.utilityType = "electricity";
          reply = [
            `⚡ *ECG & Electricity Recharge:*`,
            `────────────────────`,
            `*1* — 💡 ECG Prepaid (Alpha & Smart Meters via ECG Direct)`,
            `*2* — 🏢 ECG Postpaid`,
            `*3* — ⚡ NEDCO`,
            `────────────────────`,
            `_Reply 1, 2, or 3 — or 0 for Menu_`
          ].join("\n");
          nextStep = "SELECT_UTILITY_PROVIDER";
        } else if (input.includes("water") || input.includes("gwcl") || input.includes("tv") || input.includes("dstv") || input.includes("gotv") || input.includes("startimes")) {
          data.isUtility = true;
          reply = [
            `💧 *Select Bill / Utility Service:*`,
            `────────────────────`,
            `*1* — 💧 Ghana Water (GWCL Bills)`,
            `*2* — 📺 Pay TV (DSTV / GOtv / StarTimes)`,
            `────────────────────`,
            `_Reply 1 or 2 — or 0 for Menu_`
          ].join("\n");
          nextStep = "SELECT_WATER_OR_TV";
        } else if (input === "6" || input.includes("check") || input.includes("waec") || input.includes("wassce") || input.includes("bece") || input.includes("vouch")) {
          reply = [
            `🎓 *WAEC Result Checker Vouchers:* `,
            `────────────────────`,
            `*1* — WASSCE Result Checker (GH₵ 18.00)`,
            `*2* — BECE Result Checker (GH₵ 18.00)`,
            `────────────────────`,
            `_Instant Serial Number & PIN delivered directly here in chat!_`,
            ``,
            `_Reply 1 or 2 — or 0 for Menu_`
          ].join("\n");
          nextStep = "SELECT_CHECKER_TYPE";
        } else if (input === "7" || input.includes("beneficiary") || input.includes("whitelist") || input.includes("verify")) {
          reply = [
            `🛡️ *Verify MTN Beneficiary Number (Affordable SME)*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Check if an MTN number is on the MTN Beneficiary Whitelist to receive *Affordable SME Data Bundles*.`,
            ``,
            `💡 *Note:* Beneficiary whitelisting is only required for Affordable SME data bundles. Korba and standard retail packages do NOT require beneficiary whitelisting.`,
            ``,
            `📱 *Please enter the 10-digit MTN number to verify:*`,
            `_Example: 0244123456_`,
            ``,
            `_Reply 0 to go back_`
          ].join("\n");
          nextStep = "ENTER_BENEFICIARY_CHECK_PHONE";
        } else if (input === "8" || input.includes("wallet") || input.includes("balance") || input.includes("topup") || input.includes("top up")) {
          const normFrom = normalizePhone(from);
          const userMeta = await getUserProfileAndWallet(supabase, from);

          if (!userMeta?.profile) {
            reply = `⚠️ *Account Not Found*\n\nNo registered SwiftData account was found for your phone number (*${from}*).\n\nPlease sign up at https://swiftdatagh.shop to create your wallet.\n\n_Reply 0 for menu._`;
            nextStep = "MENU";
          } else {
            const profile = userMeta.profile;
            const balance = userMeta.walletBalance;
            const accountTitle = profile.store_name || profile.full_name || "SwiftData User";

            data.authProfile = profile;
            data.topupAgentId = profile.user_id;
            data.walletBalance = balance;

            reply = [
              `💳 *SwiftData Wallet Balance*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Account: *${accountTitle}*`,
              `Phone:   *${normFrom}*`,
              `Balance: *GH₵ ${balance.toFixed(2)}*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              ``,
              `⚡ *Would you like to top up your wallet?*`,
              `• Reply with the amount in GH₵ (e.g. *20* or *50*) to top up instantly via MoMo.`,
              `• Or reply *0* to return to the Main Menu.`,
            ].join("\n");
            nextStep = "ENTER_WALLET_TOPUP_AMT";
          }
        } else if (input === "9" || input.includes("track")) {
          reply = [
            `🔍 *Live Order Tracking & System Diagnostics*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Please reply with your **Phone Number** (e.g. \`0547636024\`) or your **Order ID**.`,
            ``,
            `💡 _Tip: You can simply enter the recipient number that received the bundle!_`,
            ``,
            `_Reply with a phone number, or reply 0 for Menu._`
          ].join("\n");
          nextStep = "TRACK_ORDER";
        } else if (input === "10" || input.includes("support") || input.includes("care") || input.includes("complain") || input.includes("issue") || input.includes("agent")) {
          const normFrom = normalizePhone(from);
          const { data: recentOrders } = await supabase
            .from("orders")
            .select("*")
            .or(`customer_phone.eq.${normFrom},customer_phone.eq.${from}`)
            .order("created_at", { ascending: false })
            .limit(3);

          const waNum = agent?.wa?.replace(/[^0-9]/g, "");
          const isAgentStore = Boolean(agent && waNum);
          const storeSupportLink = isAgentStore ? `https://wa.me/${waNum}` : "https://wa.me/233598170947";

          if (recentOrders && recentOrders.length > 0) {
            const latest = recentOrders[0];
            data.lastOrderId = latest.id;
            const diagnostic = formatOrderDiagnostic(latest);

            reply = [
              `👋 *SwiftData Live Support & Complaints Desk*`,
              `We are genuinely here to help you get this resolved!`,
              ``,
              diagnostic,
              ``,
              `🛠️ *Available Actions:*`,
              latest.status === "fulfillment_failed" || latest.status === "pending" || latest.status === "processing"
                ? `• Reply *R* to automatically *Retry* this order now 🔄`
                : ``,
              isAgentStore
                ? `• Message Store Agent directly: ${storeSupportLink} 👨‍💼\n• Central Technical Desk: https://wa.me/233598170947`
                : `• Message SwiftData Official Support: https://wa.me/233598170947 👨‍💼\n• Phone/WhatsApp: *0598170947*\n• Email: *support@swiftdata.tech*`,
              ``,
              `_Or reply with your complaint details directly below._`,
              `_Reply 0 for Main Menu._`
            ].filter(Boolean).join("\n");
            nextStep = "LIVE_SUPPORT";
          } else {
            reply = [
              `👋 *SwiftData Live Support & Customer Care*`,
              `We are genuinely here to help you!`,
              ``,
              isAgentStore
                ? `👨‍💼 *Store Agent Chat:* ${storeSupportLink}\n🛠️ *Central Support Desk:* https://wa.me/233598170947`
                : `👨‍💼 *SwiftData Live Support:* https://wa.me/233598170947\n📞 *Call / WhatsApp:* 0598170947\n📧 *Email:* support@swiftdata.tech`,
              ``,
              `_Reply 0 to return to Menu._`
            ].join("\n");
            nextStep = "MENU";
          }
        } else if (input === "11" || input.includes("history") || input.includes("recent") || input.includes("report")) {
          const normFrom = normalizePhone(from);
          const { data: recentOrders } = await supabase
            .from("orders")
            .select("id, network, package_size, amount, status, created_at")
            .or(`customer_phone.eq.${normFrom},customer_phone.eq.${from}`)
            .order("created_at", { ascending: false })
            .limit(5);

          if (!recentOrders || recentOrders.length === 0) {
            reply = `📋 *Recent Orders Report*\n\nNo order history found for your phone number (*${from}*).\n\n_Reply 0 to return to menu._`;
          } else {
            const statusEmoji: Record<string, string> = {
              fulfilled: "✅ Delivered",
              pending: "⏳ Pending",
              processing: "⚙️ Processing",
              paid: "💳 Paid",
              fulfillment_failed: "❌ Failed",
            };

            const reportLines = [
              `📋 *Recent Orders Report (Last ${recentOrders.length})*`,
              ``
            ];

            recentOrders.forEach((o: any, i: number) => {
              const dt = new Date(o.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
              const label = statusEmoji[o.status] || o.status.toUpperCase();
              const itemStr = o.package_size ? `${o.network} ${o.package_size}` : `${o.network} GH₵ ${Number(o.amount || 0).toFixed(2)}`;
              reportLines.push(`*${i + 1}.* ${itemStr}`);
              reportLines.push(`   Status: *${label}* (${dt})`);
              reportLines.push(`   Order ID: \`${o.id.slice(0, 8)}\``);
              reportLines.push(``);
            });

            reportLines.push(`_Reply 0 to return to the menu._`);
            reply = reportLines.join("\n");
          }
          nextStep = "MENU";
        } else if (input === "12" || input.includes("portal") || input.includes("reseller") || input.includes("sales") || input.includes("profit")) {
          const userMeta = await getUserProfileAndWallet(supabase, from);
          const profile = userMeta?.profile;

          if (!profile || (!profile.is_agent && !profile.is_sub_agent && !profile.agent_approved && !profile.sub_agent_approved)) {
            const actFee = await getAgentActivationFee(supabase);
            reply = [
              `💼 *SwiftData Reseller Agent Portal*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Start your own telecom data business directly on WhatsApp!`,
              ``,
              `✨ *What You Get as a Registered Agent:*`,
              `• 🤖 Your own branded WhatsApp Bot link for your customers`,
              `• 🌐 Your personal online storefront (e.g. swiftdatagh.shop/store/yourname)`,
              `• 💰 Wholesale bundle rates & set your own prices to keep 100% profit`,
              `• ⚡ Instant automated 24/7 carrier delivery across MTN, Telecel & AT`,
              `• 📱 Dedicated Agent Web Dashboard with login credentials`,
              `• 💵 One-Time Lifetime Activation: *GH₵ ${actFee.toFixed(2)}*`,
              ``,
              `🚀 *Get Started Right Now:*`,
              `👉 Sign up instantly at: *https://swiftdatagh.shop/agent-register*`,
              `📞 Or chat with our onboarding agent: https://wa.me/233598170947`,
              ``,
              `_Reply 0 to return to the Main Menu._`,
            ].join("\n");
            nextStep = "MENU";
          } else {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const { data: todayOrders } = await supabase
              .from("orders")
              .select("amount, profit, status, created_at")
              .eq("agent_id", profile.user_id)
              .gte("created_at", todayStart.toISOString());

            let totalCount = 0;
            let totalRevenue = 0;
            let totalProfit = 0;

            (todayOrders || []).forEach((o: any) => {
              if (o.status === "fulfilled" || o.status === "paid") {
                totalCount++;
                totalRevenue += Number(o.amount || 0);
                totalProfit += Number(o.profit || 0);
              }
            });

            const storeTitle = profile.store_name || profile.full_name || "Reseller Store";
            const dtStr = new Date().toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
            const botLink = `https://wa.me/${WHATSAPP_BOT_NUMBER}?text=Hi+${profile.slug || ""}`;
            const storeUrl = `${APP_BASE_URL}/store/${profile.slug || ""}`;
            const dashboardUrl = `${APP_BASE_URL}/auth?role=agent`;

            reply = [
              `📊 *Daily Agent Performance Report*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Store: *${storeTitle}*`,
              `Date:  *${dtStr}*`,
              ``,
              `📦 Orders Completed Today: *${totalCount}*`,
              `💰 Total Sales Revenue:   *GH₵ ${totalRevenue.toFixed(2)}*`,
              `💵 Net Profit Earned:     *GH₵ ${totalProfit.toFixed(2)}*`,
              `💳 Wallet Balance:        *GH₵ ${Number(userMeta.walletBalance || 0).toFixed(2)}*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              ``,
              `🛒 *Your Storefront Link:*`,
              `${storeUrl}`,
              ``,
              `🤖 *Your Customer WhatsApp Bot Link:*`,
              `${botLink}`,
              `_(Share this link with your customers to earn profit on every order!)_`,
              ``,
              `🌐 *Agent Web Dashboard:*`,
              `${dashboardUrl}`,
              ``,
              `_Reply 0 for menu._`,
            ].join("\n");
            nextStep = "MENU";
          }
        } else if (input === "13" || input.includes("channel")) {
          reply = [
            `📢 *Official SwiftData WhatsApp Channel*`,
            ``,
            `Stay connected with our official broadcast channel:`,
            `⚡ Real-time carrier network status (MTN, Telecel, AT)`,
            `🔥 Daily discounts & flash data bundle sales`,
            `🔔 Instant service maintenance notices & news`,
            ``,
            `👉 *Tap to Join Official Channel:*`,
            `https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40`,
            ``,
            `_Reply 0 to return to the menu._`
          ].join("\n");
          nextStep = "MENU";
        } else if (input === "14" || input.includes("api") || input.includes("developer") || input.includes("integration")) {
          reply = [
            `⚡ *SwiftData Developer API & Technical Support* 🔌`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Are you building an app, website, or fintech and need automated data & airtime delivery?`,
            ``,
            `🚀 *API Features & Benefits:*`,
            `• Instant automated carrier top-ups (MTN, Telecel, AT)`,
            `• High-uptime REST endpoints with JSON payloads`,
            `• Live webhook delivery status callbacks`,
            `• Wholesale developer rates & automated wallet billing`,
            ``,
            `👨‍💼 *Chat Directly with Our Technical Lead (Real Person):*`,
            `Our integration engineer is active and ready to issue your API key and help you integrate!`,
            ``,
            `👉 *Tap to Chat on WhatsApp:*`,
            `https://wa.me/233598170947?text=Hello%20SwiftData%20Support,%20I%20am%20a%20developer%20interested%20in%20API%20Access`,
            ``,
            `📞 *Call Directly:* *0598170947*`,
            `📧 *Email:* *support@swiftdata.tech*`,
            `📖 *Developer Documentation:* https://swiftdatagh.shop/developer`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply 0 to return to the Main Menu._`
          ].join("\n");
          nextStep = "MENU";
        } else if (input.includes("afa")) {
          reply = `ℹ️ *AFA Registration has been discontinued.* Please explore our high-speed Data Bundles (Option 1) or MTN Mash Up (Option 3).\n\n_Reply 0 for Main Menu._`;
          nextStep = "MENU";
        } else {
          // Check if user replied directly with an agent code or store slug!
          const maybeAgent = await getAgent(supabase, input);
          if (maybeAgent) {
            agentId = maybeAgent.id;
            data = { ...data, agentId: maybeAgent.id };
            nextStep = "SELECT_SERVICE";
            reply = [
              `✅ *Connected to ${maybeAgent.name}!*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `You are now connected to *${maybeAgent.name}*'s store.`,
              ``,
              `Please choose a service:`,
              `*1* — Buy Data 📶`,
              `*2* — Buy Airtime 📱`,
              `*3* — MTN Mash Up ⚡`,
              `*4* — ECG Electricity 💡`,
              `*5* — Water & Pay TV Bills 💧`,
              `*6* — WAEC Result Checker 🎓`,
              `*7* — Verify MTN Beneficiary 🛡️`,
              `*8* — Wallet Balance 💰`,
              `*9* — Track Order 🔍`,
              `*10* — Contact Store Support 🎧`,
              ``,
              `_Reply 1 to buy data at this store's special rates._`
            ].join("\n");
            break;
          }
          reply = `⚠️ Please reply with a number from *1 to 5* (or *5* for More Services, or reply *CODE <agent_code>* to connect to an agent).`;
        }
        break;
      }

      // ── MORE SERVICES MENU ───────────────────────────────────────────────────
      case "MORE_MENU": {
        if (input === "0" || input === "back" || input === "menu" || input === "home" || input === "main") {
          reply = formatMainMenu(
            agent,
            storeName,
            senderProfile,
            senderProfileMeta,
            isSenderAdmin,
            isSenderAgent,
            WHATSAPP_BOT_NUMBER,
            data.reorderOrder
          );
          nextStep = "SELECT_SERVICE";
          break;
        } else if (input === "1" || input.includes("ecg") || input.includes("electricity") || input.includes("meter") || input.includes("light") || input.includes("power")) {
          data.isUtility = true;
          data.utilityType = "electricity";
          reply = [
            `⚡ *ECG & Electricity Recharge:*`,
            `────────────────────`,
            `*1* — 💡 ECG Prepaid (Alpha & Smart Meters via ECG Direct)`,
            `*2* — 🏢 ECG Postpaid`,
            `*3* — ⚡ NEDCO`,
            `────────────────────`,
            `_Reply 1, 2, or 3 — or 0 for Menu_`
          ].join("\n");
          nextStep = "SELECT_UTILITY_PROVIDER";
        } else if (input === "2" || input.includes("water") || input.includes("gwcl") || input.includes("tv") || input.includes("dstv") || input.includes("gotv") || input.includes("startimes")) {
          data.isUtility = true;
          reply = [
            `💧 *Select Bill / Utility Service:*`,
            `────────────────────`,
            `*1* — 💧 Ghana Water (GWCL Bills)`,
            `*2* — 📺 Pay TV (DSTV / GOtv / StarTimes)`,
            `────────────────────`,
            `_Reply 1 or 2 — or 0 for Menu_`
          ].join("\n");
          nextStep = "SELECT_WATER_OR_TV";
        } else if (input === "3" || input.includes("check") || input.includes("waec") || input.includes("wassce") || input.includes("bece") || input.includes("vouch")) {
          reply = [
            `🎓 *WAEC Result Checker Vouchers:* `,
            `────────────────────`,
            `*1* — WASSCE Result Checker (GH₵ 18.00)`,
            `*2* — BECE Result Checker (GH₵ 18.00)`,
            `────────────────────`,
            `_Instant Serial Number & PIN delivered directly here in chat!_`,
            ``,
            `_Reply 1 or 2 — or 0 for Menu_`
          ].join("\n");
          nextStep = "SELECT_CHECKER_TYPE";
        } else if (input === "4" || input.includes("beneficiary") || input.includes("whitelist") || input.includes("verify")) {
          reply = [
            `🛡️ *Verify MTN Beneficiary Number (Affordable SME)*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Check if an MTN number is on the MTN Beneficiary Whitelist to receive *Affordable SME Data Bundles*.`,
            ``,
            `💡 *Note:* Beneficiary whitelisting is only required for Affordable SME data bundles. Korba and standard retail packages do NOT require beneficiary whitelisting.`,
            ``,
            `📱 *Please enter the 10-digit MTN number to verify:*`,
            `_Example: 0244123456_`,
            ``,
            `_Reply 0 to go back_`
          ].join("\n");
          nextStep = "ENTER_BENEFICIARY_CHECK_PHONE";
        } else if (input === "5" || input.includes("wallet") || input.includes("balance") || input.includes("topup") || input.includes("top up")) {
          const normFrom = normalizePhone(from);
          const userMeta = await getUserProfileAndWallet(supabase, from);

          if (!userMeta?.profile) {
            reply = `⚠️ *Account Not Found*\n\nNo registered SwiftData account was found for your phone number (*${from}*).\n\nPlease sign up at https://swiftdatagh.shop to create your wallet.\n\n_Reply 0 for menu._`;
            nextStep = "MENU";
          } else {
            const profile = userMeta.profile;
            const balance = userMeta.walletBalance;
            const accountTitle = profile.store_name || profile.full_name || "SwiftData User";

            data.authProfile = profile;
            data.topupAgentId = profile.user_id;
            data.walletBalance = balance;

            reply = [
              `💳 *SwiftData Wallet Balance*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Account: *${accountTitle}*`,
              `Phone:   *${normFrom}*`,
              `Balance: *GH₵ ${balance.toFixed(2)}*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              ``,
              `⚡ *Would you like to top up your wallet?*`,
              `• Reply with the amount in GH₵ (e.g. *20* or *50*) to top up instantly via MoMo.`,
              `• Or reply *0* to return to the Main Menu.`,
            ].join("\n");
            nextStep = "ENTER_WALLET_TOPUP_AMT";
          }
        } else if (input === "6" || input.includes("history") || input.includes("recent") || input.includes("report")) {
          const normFrom = normalizePhone(from);
          const { data: recentOrders } = await supabase
            .from("orders")
            .select("id, network, package_size, amount, status, created_at")
            .or(`customer_phone.eq.${normFrom},customer_phone.eq.${from}`)
            .order("created_at", { ascending: false })
            .limit(5);

          if (!recentOrders || recentOrders.length === 0) {
            reply = `📋 *Recent Orders Report*\n\nNo order history found for your phone number (*${from}*).\n\n_Reply 0 to return to menu._`;
          } else {
            const statusEmoji: Record<string, string> = {
              fulfilled: "✅ Delivered",
              pending: "⏳ Pending",
              processing: "⚙️ Processing",
              paid: "💳 Paid",
              fulfillment_failed: "❌ Failed",
            };

            const reportLines = [
              `📋 *Recent Orders Report (Last ${recentOrders.length})*`,
              ``
            ];

            recentOrders.forEach((o: any, i: number) => {
              const dt = new Date(o.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
              const label = statusEmoji[o.status] || o.status.toUpperCase();
              const itemStr = o.package_size ? `${o.network} ${o.package_size}` : `${o.network} GH₵ ${Number(o.amount || 0).toFixed(2)}`;
              reportLines.push(`*${i + 1}.* ${itemStr}`);
              reportLines.push(`   Status: *${label}* (${dt})`);
              reportLines.push(`   Order ID: \`${o.id.slice(0, 8)}\``);
              reportLines.push(``);
            });

            reportLines.push(`_Reply 0 to return to the menu._`);
            reply = reportLines.join("\n");
          }
          nextStep = "MENU";
        } else if (input === "7" || input.includes("support") || input.includes("care") || input.includes("complain") || input.includes("issue") || input.includes("agent") || input.includes("help")) {
          const normFrom = normalizePhone(from);
          const { data: recentOrders } = await supabase
            .from("orders")
            .select("*")
            .or(`customer_phone.eq.${normFrom},customer_phone.eq.${from}`)
            .order("created_at", { ascending: false })
            .limit(3);

          const waNum = agent?.wa?.replace(/[^0-9]/g, "");
          const isAgentStore = Boolean(agent && waNum);
          const storeSupportLink = isAgentStore ? `https://wa.me/${waNum}` : "https://wa.me/233598170947";

          if (recentOrders && recentOrders.length > 0) {
            const latest = recentOrders[0];
            data.lastOrderId = latest.id;
            const diagnostic = formatOrderDiagnostic(latest);

            reply = [
              `👋 *SwiftData Live Support & Complaints Desk*`,
              `We are genuinely here to help you get this resolved!`,
              ``,
              diagnostic,
              ``,
              `🛠️ *Available Actions:*`,
              latest.status === "fulfillment_failed" || latest.status === "pending" || latest.status === "processing"
                ? `• Reply *R* to automatically *Retry* this order now 🔄`
                : ``,
              isAgentStore
                ? `• Message Store Agent directly: ${storeSupportLink} 👨‍💼\n• Central Technical Desk: https://wa.me/233598170947`
                : `• Message SwiftData Official Support: https://wa.me/233598170947 👨‍💼\n• Phone/WhatsApp: *0598170947*\n• Email: *support@swiftdata.tech*`,
              ``,
              `_Or reply with your complaint details directly below._`,
              `_Reply 0 for Main Menu._`
            ].filter(Boolean).join("\n");
            nextStep = "LIVE_SUPPORT";
          } else {
            reply = [
              `👋 *SwiftData Live Support & Customer Care*`,
              `We are genuinely here to help you!`,
              ``,
              isAgentStore
                ? `👨‍💼 *Store Agent Chat:* ${storeSupportLink}\n🛠️ *Central Support Desk:* https://wa.me/233598170947`
                : `👨‍💼 *SwiftData Live Support:* https://wa.me/233598170947\n📞 *Call / WhatsApp:* 0598170947\n📧 *Email:* support@swiftdata.tech`,
              ``,
              `_Reply 0 to return to Menu._`
            ].join("\n");
            nextStep = "MENU";
          }
        } else if (input === "8" || input.includes("portal") || input.includes("reseller") || input.includes("sales") || input.includes("profit")) {
          const userMeta = await getUserProfileAndWallet(supabase, from);
          const profile = userMeta?.profile;

          if (!profile || (!profile.is_agent && !profile.is_sub_agent && !profile.agent_approved && !profile.sub_agent_approved)) {
            const actFee = await getAgentActivationFee(supabase);
            reply = [
              `💼 *SwiftData Reseller Agent Portal*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Start your own telecom data business directly on WhatsApp!`,
              ``,
              `✨ *What You Get as a Registered Agent:*`,
              `• 🤖 Your own branded WhatsApp Bot link for your customers`,
              `• 🌐 Your personal online storefront (e.g. swiftdatagh.shop/store/yourname)`,
              `• 💰 Wholesale bundle rates & set your own prices to keep 100% profit`,
              `• ⚡ Instant automated 24/7 carrier delivery across MTN, Telecel & AT`,
              `• 📱 Dedicated Agent Web Dashboard with login credentials`,
              `• 💵 One-Time Lifetime Activation: *GH₵ ${actFee.toFixed(2)}*`,
              ``,
              `🚀 *Get Started Right Now:*`,
              `👉 Sign up instantly at: *https://swiftdatagh.shop/agent-register*`,
              `📞 Or chat with our onboarding agent: https://wa.me/233598170947`,
              ``,
              `_Reply 0 to return to the Main Menu._`,
            ].join("\n");
            nextStep = "MENU";
          } else {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const { data: todayOrders } = await supabase
              .from("orders")
              .select("amount, profit, status, created_at")
              .eq("agent_id", profile.user_id)
              .gte("created_at", todayStart.toISOString());

            let totalCount = 0;
            let totalRevenue = 0;
            let totalProfit = 0;

            (todayOrders || []).forEach((o: any) => {
              if (o.status === "fulfilled" || o.status === "paid") {
                totalCount++;
                totalRevenue += Number(o.amount || 0);
                totalProfit += Number(o.profit || 0);
              }
            });

            const storeTitle = profile.store_name || profile.full_name || "Reseller Store";
            const dtStr = new Date().toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
            const botLink = `https://wa.me/${WHATSAPP_BOT_NUMBER}?text=Hi+${profile.slug || ""}`;
            const storeUrl = `${APP_BASE_URL}/store/${profile.slug || ""}`;
            const dashboardUrl = `${APP_BASE_URL}/auth?role=agent`;

            reply = [
              `📊 *Daily Agent Performance Report*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Store: *${storeTitle}*`,
              `Date:  *${dtStr}*`,
              ``,
              `📦 Orders Completed Today: *${totalCount}*`,
              `💰 Total Sales Revenue:   *GH₵ ${totalRevenue.toFixed(2)}*`,
              `💵 Net Profit Earned:     *GH₵ ${totalProfit.toFixed(2)}*`,
              `💳 Wallet Balance:        *GH₵ ${Number(userMeta.walletBalance || 0).toFixed(2)}*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              ``,
              `🛒 *Your Storefront Link:*`,
              `${storeUrl}`,
              ``,
              `🤖 *Your Customer WhatsApp Bot Link:*`,
              `${botLink}`,
              `_(Share this link with your customers to earn profit on every order!)_`,
              ``,
              `🌐 *Agent Web Dashboard:*`,
              `${dashboardUrl}`,
              ``,
              `_Reply 0 for menu._`,
            ].join("\n");
            nextStep = "MENU";
          }
        } else if (input === "9" || input.includes("channel")) {
          reply = [
            `📢 *Official SwiftData WhatsApp Channel*`,
            ``,
            `Stay connected with our official broadcast channel:`,
            `⚡ Real-time carrier network status (MTN, Telecel, AT)`,
            `🔥 Daily discounts & flash data bundle sales`,
            `🔔 Instant service maintenance notices & news`,
            ``,
            `👉 *Tap to Join Official Channel:*`,
            `https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40`,
            ``,
            `_Reply 0 to return to the menu._`
          ].join("\n");
          nextStep = "MENU";
        } else if (input === "10" || input.includes("api") || input.includes("developer") || input.includes("integration")) {
          reply = [
            `⚡ *SwiftData Developer API & Technical Support* 🔌`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Are you building an app, website, or fintech and need automated data & airtime delivery?`,
            ``,
            `🚀 *API Features & Benefits:*`,
            `• Instant automated carrier top-ups (MTN, Telecel, AT)`,
            `• High-uptime REST endpoints with JSON payloads`,
            `• Live webhook delivery status callbacks`,
            `• Wholesale developer rates & automated wallet billing`,
            ``,
            `👨‍💼 *Chat Directly with Our Technical Lead (Real Person):*`,
            `Our integration engineer is active and ready to issue your API key and help you integrate!`,
            ``,
            `👉 *Tap to Chat on WhatsApp:*`,
            `https://wa.me/233598170947?text=Hello%20SwiftData%20Support,%20I%20am%20a%20developer%20interested%20in%20API%20Access`,
            ``,
            `📞 *Call Directly:* *0598170947*`,
            `📧 *Email:* *support@swiftdata.tech*`,
            `📖 *Developer Documentation:* https://swiftdatagh.shop/developer`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply 0 to return to the Main Menu._`
          ].join("\n");
          nextStep = "MENU";
        } else {
          reply = `⚠️ Please choose an option from *1 to 10* — or reply *0* to return to the Main Menu.`;
          nextStep = "MORE_MENU";
        }
        break;
      }

      // ── ADMIN TERMINAL ───────────────────────────────────────────────────────
      case "ADMIN_MENU": {
        reply = formatAdminMenu(senderProfile?.full_name || "Admin");
        nextStep = "SELECT_ADMIN_SERVICE";
        break;
      }

      case "SELECT_ADMIN_SERVICE": {
        if (!isSenderAdmin) {
          reply = `🔒 *Access Denied:* Unauthorized Admin Terminal session.\n\n_Reply *Hi* for customer menu._`;
          nextStep = "MENU";
          data.viewMode = "customer";
          break;
        }

        if (input === "1" || input.includes("health") || input.includes("diag") || input.includes("queue")) {
          reply = await getSystemHealthReport(supabase);
          nextStep = "SELECT_ADMIN_SERVICE";
        } else if (input === "2" || input.includes("balance") || input.includes("provider") || input.includes("carrier")) {
          reply = await getProviderBalancesReport(supabase);
          nextStep = "SELECT_ADMIN_SERVICE";
        } else if (input === "3" || input.includes("retry") || input.includes("heal") || input.includes("stuck")) {
          reply = await triggerHealAndRetry(supabase);
          nextStep = "SELECT_ADMIN_SERVICE";
        } else if (input === "4" || input.includes("financial") || input.includes("revenue") || input.includes("profit") || input.includes("sale")) {
          reply = await getTodayFinancialsReport(supabase);
          nextStep = "SELECT_ADMIN_SERVICE";
        } else if (input === "5" || input.includes("lookup") || input.includes("user") || input.includes("find")) {
          reply = [
            `🔍 *User / Agent Account Lookup*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Please reply with the customer's *Phone Number* (e.g. 0244123456) or *Store Slug*:`,
            ``,
            `_Reply 0 to return to Admin Terminal._`
          ].join("\n");
          nextStep = "ADMIN_LOOKUP_USER";
        } else if (input === "6" || input.includes("maint") || input.includes("setting") || input.includes("status")) {
          const { data: s } = await supabase.from("v_system_settings_with_secrets").select("is_maintenance_mode, active_sms_gateway").eq("id", 1).maybeSingle();
          reply = [
            `⚙️ *Platform Status & Configuration*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `• *Platform Status:* ${s?.is_maintenance_mode ? "🔴 Under Maintenance" : "🟢 Live & Operational"}`,
            `• *Active SMS Gateway:* *${(s?.active_sms_gateway || "txtconnect").toUpperCase()}*`,
            `• *Telecom Dispatchers:* 🟢 Active & Auto-Routing`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply 0 for Admin Terminal._`
          ].join("\n");
          nextStep = "SELECT_ADMIN_SERVICE";
        } else if (input === "7" || input.includes("broadcast") || input.includes("session") || input.includes("notify") || input.includes("announc")) {
          const { data: sessionRows } = await supabase
            .from("whatsapp_sessions")
            .select("phone");
          const validSessionList = (sessionRows || []).filter((s: any) => {
            const p = String(s.phone || "").trim();
            return p && p !== "0000000000" && !p.includes("@") && p.length >= 9 && p.length <= 15;
          });
          const uniqueSessionCount = new Set(validSessionList.map((s: any) => s.phone)).size;

          reply = [
            `📢 *Broadcast to Active User Sessions*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `• *Target Audience:* *${uniqueSessionCount}* active WhatsApp user sessions`,
            `• *Channel Update:* Also posted to official channel`,
            `• *Protection:* Safe 2.5s jitter & auto opt-out footer`,
            ``,
            `Please reply with the *Announcement Message* you want to broadcast to these user sessions:`,
            ``,
            `_Reply 0 to cancel and return to Admin Terminal._`
          ].join("\n");
          nextStep = "ADMIN_BROADCAST_COMPOSE";
        } else if (input === "8" || input.includes("customer") || input.includes("retail") || input.includes("shop")) {
          data.viewMode = "customer";
          reply = `🔄 *Switched to Customer Retail Menu!*\n\n_Reply *Hi* or any service to browse._`;
          nextStep = "MENU";
        } else if (input === "0") {
          reply = formatAdminMenu(senderProfile?.full_name || "Admin");
          nextStep = "SELECT_ADMIN_SERVICE";
        } else {
          reply = `⚠️ Please reply with a valid option from *1 to 8*, or reply *0* for Admin Terminal.`;
          nextStep = "SELECT_ADMIN_SERVICE";
        }
        break;
      }

      case "ADMIN_BROADCAST_COMPOSE": {
        if (input === "0" || input === "cancel") {
          reply = formatAdminMenu(senderProfile?.full_name || "Admin");
          nextStep = "SELECT_ADMIN_SERVICE";
          break;
        }

        const composeMsg = text.trim();
        if (composeMsg.length < 4) {
          reply = `⚠️ Announcement message is too short. Please type a message to broadcast, or reply *0* to cancel:`;
          nextStep = "ADMIN_BROADCAST_COMPOSE";
          break;
        }

        data.broadcastMsg = composeMsg;

        const { data: composeSessions } = await supabase
          .from("whatsapp_sessions")
          .select("phone");
        const validComposeSessions = (composeSessions || []).filter((s: any) => {
          const p = String(s.phone || "").trim();
          return p && p !== "0000000000" && !p.includes("@") && p.length >= 9 && p.length <= 15;
        });
        const composeTargetCount = new Set(validComposeSessions.map((s: any) => s.phone)).size;
        data.broadcastCount = composeTargetCount;

        reply = [
          `📢 *Confirm Broadcast to User Sessions*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `• *Audience:* *${composeTargetCount}* Active User Sessions`,
          ``,
          `*Message Preview:*`,
          `"${composeMsg}"`,
          ``,
          `Reply *SEND* to dispatch now.`,
          `Reply *0* to cancel.`,
        ].join("\n");
        nextStep = "ADMIN_BROADCAST_CONFIRM";
        break;
      }

      case "ADMIN_BROADCAST_CONFIRM": {
        if (input === "0" || input === "cancel") {
          delete data.broadcastMsg;
          delete data.broadcastCount;
          reply = `❌ Broadcast cancelled.\n\n` + formatAdminMenu(senderProfile?.full_name || "Admin");
          nextStep = "SELECT_ADMIN_SERVICE";
          break;
        }

        if (input === "send" || input === "yes" || input === "confirm") {
          const messageToSend = data.broadcastMsg;
          const countSent = data.broadcastCount || 0;
          delete data.broadcastMsg;
          delete data.broadcastCount;

          if (!messageToSend) {
            reply = `⚠️ No broadcast message pending.\n\n` + formatAdminMenu(senderProfile?.full_name || "Admin");
            nextStep = "SELECT_ADMIN_SERVICE";
            break;
          }

          // Trigger admin-broadcast-whatsapp in background
          try {
            fetch(`${SUPABASE_URL}/functions/v1/admin-broadcast-whatsapp`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
              },
              body: JSON.stringify({
                segment: "active_sessions",
                message: messageToSend,
                title: "Announcement",
                broadcast_to_channel: true,
              })
            }).catch(e => console.warn("[WA Bot] Admin broadcast invoke error:", e));
          } catch (e) {
            console.warn("[WA Bot] Background broadcast dispatch error:", e);
          }

          reply = [
            `✅ *Broadcast Queued Successfully!* 🚀`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `• Dispatched to *${countSent}* active user sessions.`,
            `• Also posted to official WhatsApp channel.`,
            `• Anti-spam humanized rate limiting is active.`,
            ``,
            `_Reply 0 for Admin Terminal._`
          ].join("\n");
          nextStep = "SELECT_ADMIN_SERVICE";
          break;
        }

        reply = `⚠️ Please reply *SEND* to confirm dispatch, or *0* to cancel.`;
        nextStep = "ADMIN_BROADCAST_CONFIRM";
        break;
      }

      case "ADMIN_LOOKUP_USER": {
        if (input === "0") {
          reply = formatAdminMenu(senderProfile?.full_name || "Admin");
          nextStep = "SELECT_ADMIN_SERVICE";
          break;
        }
        reply = await lookupUserProfileDossier(supabase, input);
        nextStep = "ADMIN_LOOKUP_USER";
        break;
      }

      // ── AGENT BUSINESS HUB ───────────────────────────────────────────────────
      case "AGENT_MENU": {
        const storeTitle = senderProfile?.store_name || senderProfile?.full_name || "My Store";
        const bal = Number(senderProfileMeta?.walletBalance || 0);
        const slug = senderProfile?.slug || "";
        reply = formatAgentMenu(storeTitle, bal, slug);
        nextStep = "SELECT_AGENT_SERVICE";
        break;
      }

      case "SELECT_AGENT_SERVICE": {
        if (!isSenderAgent && !isSenderAdmin) {
          reply = `🔒 *Access Denied:* Unauthorized Agent Hub session.\n\n_Reply *Hi* for customer menu._`;
          nextStep = "MENU";
          data.viewMode = "customer";
          break;
        }

        const agentUser = senderProfile;
        const agentUserId = agentUser?.user_id;
        const storeTitle = agentUser?.store_name || agentUser?.full_name || "My Store";
        const bal = Number(senderProfileMeta?.walletBalance || 0);
        const slug = agentUser?.slug || "";

        if (input === "1" || input.includes("wallet") || input.includes("balance") || input.includes("commission")) {
          reply = [
            `💳 *My Agent Wallet & Account Overview*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Store: *${storeTitle}*`,
            `• *Available Balance:* *GH₵ ${bal.toFixed(2)}*`,
            `• *Loyalty Points:* *GH₵ ${Number(senderProfileMeta?.loyaltyBalance || 0).toFixed(2)}*`,
            `• *Credit Facility:* *GH₵ ${Number(senderProfileMeta?.creditLimit || 0).toFixed(2)}*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `⚡ *Quick Actions:*`,
            `• Reply *2* to Top Up via Mobile Money 📲`,
            `• Reply *3* to Buy Wholesale Bundles at Agent Price 🛍️`,
            `• Reply *7* to Request Cashout / Payout 💸`,
            `• Reply *0* to return to Agent Hub.`,
          ].join("\n");
          nextStep = "SELECT_AGENT_SERVICE";
        } else if (input === "2" || input.includes("topup") || input.includes("deposit")) {
          data.authProfile = agentUser;
          data.topupAgentId = agentUserId;
          data.walletBalance = bal;
          reply = [
            `💳 *Instant Agent Wallet Top-Up*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Store: *${storeTitle}*`,
            `Current Balance: *GH₵ ${bal.toFixed(2)}*`,
            ``,
            `⚡ *Please reply with the amount in GH₵ you want to deposit:*`,
            `_Example: 50, 100, 200, 500_`,
            ``,
            `_A secure Mobile Money prompt will be sent instantly to your phone._`,
            `_Reply 0 to cancel._`
          ].join("\n");
          nextStep = "ENTER_WALLET_TOPUP_AMT";
        } else if (input === "3" || input.includes("wholesale") || input.includes("buy")) {
          data.isAgentWholesale = true;
          data.agentBuyerId = agentUserId;
          reply = [
            `🛍️ *Wholesale Data Bundles (Agent Pricing)*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Order data at discounted wholesale cost!`,
            `Available Balance: *GH₵ ${bal.toFixed(2)}*`,
            ``,
            `📶 *Select Network:*`,
            `*1* — MTN (SME, Mashup, Retail)`,
            `*2* — Telecel`,
            `*3* — AirtelTigo`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply 1, 2, or 3 — or 0 to go back_`
          ].join("\n");
          nextStep = "SELECT_NET_DATA";
        } else if (input === "4" || input.includes("report") || input.includes("sales") || input.includes("profit")) {
          reply = await getAgentTodayReport(supabase, agentUserId, storeTitle, bal);
          nextStep = "SELECT_AGENT_SERVICE";
        } else if (input === "5" || input.includes("link") || input.includes("caption") || input.includes("promo") || input.includes("share") || input.includes("code")) {
          const agentCode = (senderProfile?.referral_code || slug || "").toUpperCase();
          reply = getAgentPromoCaptions(storeTitle, slug, agentCode);
          nextStep = "SELECT_AGENT_SERVICE";
        } else if (input === "6" || input.includes("order") || input.includes("customer")) {
          reply = await getAgentRecentOrders(supabase, agentUserId);
          nextStep = "SELECT_AGENT_SERVICE";
        } else if (input === "7" || input.includes("withdraw") || input.includes("payout") || input.includes("cashout")) {
          if (bal < 10) {
            reply = `⚠️ *Insufficient Balance for Payout*\n\nYour balance is *GH₵ ${bal.toFixed(2)}*. Minimum withdrawal is GH₵ 10.00.\n\n_Reply 0 for Agent Hub._`;
            nextStep = "SELECT_AGENT_SERVICE";
          } else {
            reply = [
              `💸 *Request Agent Commission Payout*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Available Wallet Balance: *GH₵ ${bal.toFixed(2)}*`,
              ``,
              `Please enter the amount in GH₵ you wish to withdraw to your Mobile Money:`,
              `_Example: 50 or 100_`,
              ``,
              `_Reply 0 to cancel._`
            ].join("\n");
            nextStep = "AGENT_ENTER_WITHDRAW_AMT";
          }
        } else if (input === "8" || input.includes("customer") || input.includes("retail") || input.includes("shop")) {
          data.viewMode = "customer";
          reply = `🔄 *Switched to Customer Retail Menu!*\n\n_Reply *Hi* or any service to browse._`;
          nextStep = "MENU";
        } else if (input === "0") {
          const agentCode = (senderProfile?.referral_code || slug || "").toUpperCase();
          reply = formatAgentMenu(storeTitle, bal, slug, agentCode);
          nextStep = "SELECT_AGENT_SERVICE";
        } else {
          reply = `⚠️ Please reply with a valid option from *1 to 8*, or reply *0* for Agent Hub.`;
          nextStep = "SELECT_AGENT_SERVICE";
        }
        break;
      }

      case "AGENT_ENTER_WITHDRAW_AMT": {
        if (input === "0") {
          const storeTitle = senderProfile?.store_name || senderProfile?.full_name || "My Store";
          const bal = Number(senderProfileMeta?.walletBalance || 0);
          const slug = senderProfile?.slug || "";
          const agentCode = (senderProfile?.referral_code || slug || "").toUpperCase();
          reply = formatAgentMenu(storeTitle, bal, slug, agentCode);
          nextStep = "SELECT_AGENT_SERVICE";
          break;
        }

        const withdrawAmt = parseFloat(input);
        const currentBal = Number(senderProfileMeta?.walletBalance || 0);

        if (isNaN(withdrawAmt) || withdrawAmt < 10 || withdrawAmt > currentBal) {
          reply = `⚠️ *Invalid Amount:* Must be between *GH₵ 10.00* and your available balance of *GH₵ ${currentBal.toFixed(2)}*.\n\nPlease enter a valid amount or reply *0* to cancel:`;
          break;
        }

        try {
          const { data: wRes, error: wErr } = await supabase.rpc("request_withdrawal", {
            p_agent_id: senderProfile?.user_id,
            p_amount: withdrawAmt
          });

          if (wErr || (wRes && !wRes.success)) {
            reply = `❌ *Withdrawal request could not be processed:* ${wErr?.message || wRes?.error || "Error processing withdrawal"}\n\n_Reply 0 for Agent Hub._`;
          } else {
            reply = [
              `✅ *Payout Request Submitted Successfully!*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `• *Amount:* GH₵ ${withdrawAmt.toFixed(2)}`,
              `• *MoMo Recipient:* \`${from}\``,
              `• *Status:* ⏳ *Pending Approval & Auto-Payout*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `Funds will be transferred directly to your Mobile Money wallet upon review! 🚀`,
              ``,
              `_Reply 0 for Agent Hub._`
            ].join("\n");
          }
        } catch (e: any) {
          reply = `⚠️ Error submitting payout request: ${e?.message || e}\n\n_Reply 0 for Agent Hub._`;
        }
        nextStep = "SELECT_AGENT_SERVICE";
        break;
      }


      // ── Beneficiary Check Phone ──────────────────────────────────────────────
      case "ENTER_BENEFICIARY_CHECK_PHONE": {
        if (input === "0") {
          reply = `_Returned to Menu._`;
          nextStep = "MENU";
          break;
        }
        const cleanPhone = normalizePhone(input);
        if (cleanPhone.length !== 10 || !cleanPhone.startsWith("0")) {
          reply = `⚠️ Please enter a valid 10-digit Ghanaian phone number (e.g. *0244123456*), or reply *0* to cancel:`;
          break;
        }

        const vResult = await verifyBeneficiary(cleanPhone);
        if (vResult.isVerified) {
          reply = [
            `✅ *Beneficiary Verified!*`,
            `────────────────────`,
            `📱 *Number:* \`${cleanPhone}\``,
            `⚡ *Network:* MTN Ghana`,
            `📊 *Status:* *Active & Whitelisted*`,
            ``,
            `This number is whitelisted on the MTN beneficiary list and ready to receive instant *Affordable SME Data Bundles*!`,
            ``,
            `_Reply 1 to Buy Data now, or 0 for Menu._`
          ].join("\n");
        } else {
          reply = [
            `⚠️ *Beneficiary Verification Result*`,
            `────────────────────`,
            `📱 *Number:* \`${cleanPhone}\``,
            `⚡ *Network:* MTN Ghana`,
            `📊 *Status:* *Not Whitelisted for SME*`,
            ``,
            `This number is not yet on the MTN SME beneficiary whitelist.`,
            ``,
            `💡 *Alternative:* You can still purchase Korba / standard retail data bundles and Airtime without any beneficiary whitelisting!`,
            ``,
            `*How to whitelist for Affordable SME Bundles:* `,
            `1. Dial **170#** on your phone`,
            `2. Select *Option 1 (Transfer Money)*`,
            `3. Select *Option 1 (MoMo User)* or *Option 5 (Other Networks)*`,
            `4. Enter *${cleanPhone}* and send a small transfer (e.g. GH₵ 1) to whitelist it.`,
            ``,
            `_Reply 1 to Buy Data, or 0 for Menu._`
          ].join("\n");
        }
        nextStep = "MENU";
        break;
      }

      // ── Water or TV Selection ─────────────────────────────────────────────────
      case "SELECT_WATER_OR_TV": {
        if (input === "1" || input.includes("water") || input.includes("gwcl")) {
          data.isUtility = true;
          data.utilityType = "water";
          data.utilityProvider = "GWCL";
          reply = [
            `💧 *GWCL Water Bill Payment*`,
            ``,
            `Please enter your *GWCL Customer Account Number*:`,
            `_Example: WC-0012345 or your 10-digit account number_`,
            ``,
            `_Reply 0 to go back_`
          ].join("\n");
          nextStep = "ENTER_UTILITY_ACCOUNT";
        } else if (input === "2" || input.includes("tv") || input.includes("dstv") || input.includes("gotv") || input.includes("startimes")) {
          data.isUtility = true;
          data.utilityType = "tv";
          reply = [
            `📺 *Select TV Provider:*`,
            `────────────────────`,
            `*1* — DSTV`,
            `*2* — GOtv`,
            `*3* — StarTimes`,
            `────────────────────`,
            `_Reply 1, 2, or 3 — or 0 to go back_`
          ].join("\n");
          nextStep = "SELECT_UTILITY_PROVIDER";
        } else if (input === "0") {
          reply = `_Returned to Menu._`;
          nextStep = "MENU";
          data = {};
        } else {
          reply = `⚠️ Please reply *1* for Ghana Water (GWCL) or *2* for Pay TV (or *0* for Menu).`;
        }
        break;
      }

      // ── Utility Type Selection ───────────────────────────────────────────────
      case "SELECT_UTILITY_TYPE": {
        if (input === "1" || input.includes("elec") || input.includes("ecg") || input.includes("power") || input.includes("light")) {
          data.isUtility = true;
          data.utilityType = "electricity";
          reply = [
            `⚡ *Select Electricity Provider:* `,
            `────────────────────`,
            `*1* — ECG Prepaid (Alpha / Smart Meters)`,
            `*2* — ECG Postpaid`,
            `*3* — NEDCO`,
            `────────────────────`,
            `_Reply 1, 2, or 3 — or 0 to go back_`
          ].join("\n");
          nextStep = "SELECT_UTILITY_PROVIDER";
        } else if (input === "2" || input.includes("water") || input.includes("gwcl")) {
          data.isUtility = true;
          data.utilityType = "water";
          data.utilityProvider = "GWCL";
          reply = [
            `💧 *GWCL Water Bill Payment*`,
            ``,
            `Please enter your *GWCL Customer Account Number*: `,
            `_Example: WC-0012345 or your 10-digit account number_`,
            ``,
            `_Reply 0 to go back_`
          ].join("\n");
          nextStep = "ENTER_UTILITY_ACCOUNT";
        } else if (input === "3" || input.includes("tv") || input.includes("dstv") || input.includes("gotv") || input.includes("startimes")) {
          data.isUtility = true;
          data.utilityType = "tv";
          reply = [
            `📺 *Select TV Provider:* `,
            `────────────────────`,
            `*1* — DSTV`,
            `*2* — GOtv`,
            `*3* — StarTimes`,
            `────────────────────`,
            `_Reply 1, 2, or 3 — or 0 to go back_`
          ].join("\n");
          nextStep = "SELECT_UTILITY_PROVIDER";
        } else {
          reply = `⚠️ Please select:\n*1* — ⚡ Electricity (ECG/NEDCO)\n*2* — 💧 Water (GWCL)\n*3* — 📺 Pay TV\n\n_Reply 0 for Main Menu_`;
        }
        break;
      }

      // ── Utility Provider Selection ───────────────────────────────────────────
      case "SELECT_UTILITY_PROVIDER": {
        let prov = "";
        if (data.utilityType === "electricity") {
          if (input === "1" || input.includes("prepaid")) prov = "ECG Prepaid";
          else if (input === "2" || input.includes("postpaid")) prov = "ECG Postpaid";
          else if (input === "3" || input.includes("nedco")) prov = "NEDCO";
          if (!prov) { reply = `⚠️ Please pick *1* (ECG Prepaid), *2* (ECG Postpaid), or *3* (NEDCO).`; break; }
          data.utilityProvider = prov;
          reply = [
            `⚡ *${prov} Payment*`,
            ``,
            `Please enter your *Meter Number* or *ECG PowerApp Phone Number*: `,
            `_Example: 04123456789 or 054XXXXXXX_`,
            ``,
            `_Reply 0 to cancel_`
          ].join("\n");
          nextStep = "ENTER_UTILITY_ACCOUNT";
        } else if (data.utilityType === "tv") {
          if (input === "1" || input.includes("dstv")) prov = "DSTV";
          else if (input === "2" || input.includes("gotv")) prov = "GOtv";
          else if (input === "3" || input.includes("star")) prov = "StarTimes";
          if (!prov) { reply = `⚠️ Please pick *1* (DSTV), *2* (GOtv), or *3* (StarTimes).`; break; }
          data.utilityProvider = prov;
          reply = [
            `📺 *${prov} Subscription*`,
            ``,
            `Please enter your *Smartcard / IUC Number*: `,
            `_Example: 1234567890_`,
            ``,
            `_Reply 0 to cancel_`
          ].join("\n");
          nextStep = "ENTER_UTILITY_ACCOUNT";
        } else {
          reply = `_Reply 0 for Main Menu._`;
        }
        break;
      }

      // ── Utility Account / Meter Verification via Korba ──────────────────────
      case "ENTER_UTILITY_ACCOUNT": {
        const cleanAccount = input.trim();
        if (cleanAccount.length < 4) {
          reply = `❌ Please enter a valid account or meter number:`;
          break;
        }
        data.utilityAccount = cleanAccount;

        // Perform meter verification via utility-lookup / Korba endpoint
        let meterName = "";
        let lookupFailed = false;
        let lookupErrMsg = "";

        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
          const lRes = await fetch(`${supabaseUrl}/functions/v1/utility-lookup`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${serviceKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              action: "verify",
              utility_type: data.utilityType,
              provider: data.utilityProvider,
              account_number: cleanAccount,
              phone_number: from
            })
          });
          const lData = await lRes.json().catch(() => ({}));

          if (lData?.success === false) {
            lookupFailed = true;
            lookupErrMsg = lData.error || "Could not verify meter/account.";
          } else if (lData?.accountName || lData?.customer_name || lData?.name) {
            meterName = lData.accountName || lData.customer_name || lData.name;
            data.utilityAccountName = meterName;
            if (lData?.meters && Array.isArray(lData.meters) && lData.meters.length > 0) {
              const m = lData.meters[0];
              data.meterId = m.meter_id || m.id || m.meterId || "";
              data.meterNumber = m.meter_number || m.meter_no || m.meterNumber || cleanAccount;
            }
          }
        } catch (_err) {
          console.warn("[WA Bot] Meter lookup error:", _err);
        }

        if (lookupFailed && data.utilityProvider?.toUpperCase().includes("ECG")) {
          reply = [
            `❌ *Meter Verification Failed*`,
            `⚠️ ${lookupErrMsg}`,
            ``,
            `💡 *Helpful Tip:*`,
            `• For ECG Prepaid, please enter the phone number linked to your *ECG PowerApp* mobile account (e.g. 054XXXXXXX).`,
            `• For ECG Postpaid, enter your official customer account number.`,
            ``,
            `_Please re-enter your meter number or linked phone number (or reply 0 to cancel):_`
          ].join("\n");
          break;
        }

        reply = [
          `📋 *Account Details:*`,
          `• *Service:* ${data.utilityProvider}`,
          `• *Meter/Account:* \`${cleanAccount}\``,
          meterName ? `• *Account Name:* *${meterName}*` : "",
          data.meterNumber ? `• *Verified Meter:* \`${data.meterNumber}\`` : "",
          ``,
          `💳 *Enter the recharge amount in GH₵ to pay:*`,
          `_Minimum: GH₵ 5.00 — Example: 50_`,
          ``,
          `_Reply 0 to go back_`
        ].filter(Boolean).join("\n");
        nextStep = "ENTER_UTILITY_AMT";
        break;
      }

      // ── Utility Amount ───────────────────────────────────────────────────────
      case "ENTER_UTILITY_AMT": {
        const amt = parseFloat(input.replace(/[^0-9.]/g, ""));
        if (isNaN(amt) || amt < 1) {
          reply = `❌ Please enter a valid amount (minimum GH₵ 1.00):`;
          break;
        }
        const fee = feeAmount(amt);
        data.utilityAmount = amt;
        data.totalPrice = parseFloat((amt + fee).toFixed(2));

        const defaultPayer = normalizePhone(from);
        reply = [
          `💳 *Order Summary:*`,
          `────────────────────`,
          `• *Provider:* ${data.utilityProvider}`,
          `• *Account/Meter:* \`${data.utilityAccount}\``,
          data.utilityAccountName ? `• *Name:* ${data.utilityAccountName}` : "",
          `• *Recharge Amount:* GH₵ ${amt.toFixed(2)}`,
          `• *Payment Fee:* GH₵ ${fee.toFixed(2)}`,
          `• *Total to Pay:* *GH₵ ${data.totalPrice.toFixed(2)}*`,
          `────────────────────`,
          ``,
          `📱 *Which MoMo number will pay?*`,
          `_Reply *YES* to use this WhatsApp number (\`${defaultPayer}\`), or type another 10-digit number._`,
          ``,
          `_Reply 0 to cancel_`
        ].filter(Boolean).join("\n");
        nextStep = "ENTER_UTILITY_PAYER_MOMO";
        break;
      }

      // ── Utility Payer MoMo ───────────────────────────────────────────────────
      case "ENTER_UTILITY_PAYER_MOMO": {
        let payerPhone = "";
        if (input === "yes" || input === "y" || input === "1") {
          payerPhone = normalizePhone(from);
        } else {
          payerPhone = normalizePhone(input);
        }

        if (payerPhone.length !== 10 || !payerPhone.startsWith("0")) {
          reply = `❌ Please enter a valid 10-digit phone number (e.g. 0244123456) or reply *YES*:`;
          break;
        }

        data.payerPhone = payerPhone;

        const payRes = await initUtilityPayment(
          supabase,
          payerPhone,
          from,
          agent,
          data.utilityType,
          data.utilityProvider,
          data.utilityAccount,
          data.utilityAccountName || "",
          data.utilityAmount,
          {
            meter_id: data.meterId || "",
            meter_number: data.meterNumber || data.utilityAccount || ""
          }
        );

        if (!payRes || !payRes.orderId) {
          const reason = payRes?.errorMessage || "Payment prompt could not be initiated by carrier.";
          reply = `❌ *Payment Prompt Failed*\n\n${reason}\n\nPlease ensure your Mobile Money wallet (\`${payerPhone}\`) has sufficient balance to pay *GH₵ ${(data.totalPrice || 0).toFixed(2)}*, then try again.\n\n_Reply 0 for Menu._`;
          nextStep = "MENU";
          break;
        }

        data.lastOrderId = payRes.orderId;
        const payerMmoProvider = getPaymentProvider(payerPhone).toUpperCase();

        reply = [
          `📱 *Payment Prompt Dispatched!*`,
          `────────────────────`,
          `Amount: *GH₵ ${(data.totalPrice || 0).toFixed(2)}*`,
          `MoMo Number: *${payerPhone}*`,
          ``,
          `1. Check your phone for the *${payerMmoProvider} MoMo prompt*.`,
          `2. Authorize payment with your PIN.`,
          ``,
          `Once approved, your utility recharge token/credit will be dispatched immediately!`,
          ``,
          `_Reply 0 for Menu._`
        ].join("\n");
        nextStep = "MENU";
        break;
      }

      // ── Network selection (data) ──────────────────────────────────────────────
      case "SELECT_NET_DATA": {
        let net = "";
        if (input === "1" || input.includes("mtn")) net = "MTN";
        else if (input === "2" || input.includes("tele") || input.includes("voda")) net = "Telecel";
        else if (input === "3" || input.includes("at") || input.includes("tigo")) net = "AirtelTigo";

        if (!net) { reply = `❌ Please pick *1*, *2*, or *3* (MTN, Telecel, AirtelTigo).`; break; }
        data.net = net;
        data.isAirtime = false;

        // If MTN, show the 8 categories from reference image
        if (net === "MTN") {
          reply = [
            `🏷️ *Select MTN Package Category:* `,
            `━━━━━━━━━━━━━━━━━━━━`,
            `*1* — 🏷️ *Affordable SME Bundles*`,
            `_Cheaper bulk packages. Delivered in 1-5 mins._`,
            ``,
            `*2* — ⚡ *Instant: Data Bundles*`,
            `_Official retail bundle. Delivered instantly._`,
            ``,
            `*3* — 🌐 *Instant: IDD Bundles*`,
            `_International calling rates._`,
            ``,
            `*4* — ⚡ *Instant: Kokrokoo Bundles*`,
            `_Official retail bundle. Delivered instantly._`,
            ``,
            `*5* — 🕒 *Instant: Midnight Bundles*`,
            `_Midnight usage offers. Super high value._`,
            ``,
            `*6* — 💬 *Instant: Social Media Bundles*`,
            `_Dedicated social media data._`,
            ``,
            `*7* — 🎥 *Instant: Video Bundles*`,
            `_Dedicated streaming bundles._`,
            ``,
            `*8* — ✨ *MTN Mash Up*`,
            `_Popular hybrid voice & data packages._`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply with a number from 1 to 8 — or 0 to go back_`
          ].join("\n");
          nextStep = "SELECT_MTN_CATEGORY";
          break;
        }

        let pkgs: Pkg[] = [];
        try {
          pkgs = await getPackagesForNetwork(supabase, net, agent?.prices || {});
        } catch (err) {
          console.error("[WA Bot] Error in bundle fetch:", err);
          await sendWhatsAppMessage(from, `⚠️ Database query error. Please try again.`);
          return new Response("ok");
        }

        if (pkgs.length === 0) {
          reply = `⚠️ *${net} bundles are currently unavailable.* Our team is working on it.\n\n_Reply 0 to return to the menu._`;
          nextStep = "MENU";
          break;
        }

        data.pkgList = pkgs;
        const lines = pkgs.map((p, i) => `*${i + 1}*. ${p.size} — GH₵ ${p.total.toFixed(2)}`);
        const aiRec = await getAiPackageRecommendation(supabase, from, net, pkgs);
        const aiRecBanner = aiRec ? `${aiRec}\n\n` : "";
        reply = `${aiRecBanner}📦 *${net} Data Bundles:*\n_(prices include payment fee)_\n\n${lines.join("\n")}\n\n_Reply with the bundle number — or 0 to go back_`;
        nextStep = "SELECT_PACKAGE";
        break;
      }

      // ── MTN Category Selection ────────────────────────────────────────────────
      case "SELECT_MTN_CATEGORY": {
        if (input === "0") {
          reply = `📶 *Select Network:*\n\n*1* — MTN\n*2* — Telecel\n*3* — AirtelTigo\n\n_Reply 0 to go back_`;
          nextStep = "SELECT_NET_DATA";
          break;
        }

        const catMap: Record<string, { key: string; label: string }> = {
          "1": { key: "sme", label: "Affordable SME Bundles" },
          "2": { key: "data_bundles", label: "Instant Data Bundles" },
          "3": { key: "idd", label: "Instant IDD Bundles" },
          "4": { key: "kokrokoo", label: "Instant Kokrokoo Bundles" },
          "5": { key: "midnight", label: "Instant Midnight Bundles" },
          "6": { key: "social", label: "Instant Social Media Bundles" },
          "7": { key: "video", label: "Instant Video Bundles" },
          "8": { key: "mashup", label: "MTN Mash Up" },
        };

        const chosen = catMap[input];
        if (!chosen) {
          reply = `❌ Invalid choice. Please reply with a number from *1 to 8* (or *0* to go back):`;
          break;
        }

        data.mtnCategory = chosen.key;
        data.categoryLabel = chosen.label;

        let pkgs: Pkg[] = [];
        try {
          pkgs = await getPackagesForNetwork(supabase, "MTN", agent?.prices || {}, chosen.key);
        } catch (err) {
          console.error("[WA Bot] Error in category bundle fetch:", err);
          await sendWhatsAppMessage(from, `⚠️ Database query error. Please try again.`);
          return new Response("ok");
        }

        if (pkgs.length === 0) {
          reply = `⚠️ *No packages currently available for ${chosen.label}.*\n\n_Please reply 1-8 to pick another category, or 0 to go back._`;
          break;
        }

        data.pkgList = pkgs;
        const lines = pkgs.map((p, i) => `*${i + 1}*. ${p.size} — GH₵ ${p.total.toFixed(2)}`);
        const aiRecCategory = await getAiPackageRecommendation(supabase, from, "MTN", pkgs);
        const aiRecCatBanner = aiRecCategory ? `${aiRecCategory}\n\n` : "";
        reply = `${aiRecCatBanner}📦 *MTN — ${chosen.label}:*\n_(prices include payment fee)_\n\n${lines.join("\n")}\n\n_Reply with the bundle number — or 0 to go back_`;
        nextStep = "SELECT_PACKAGE";
        break;
      }

      // ── Network selection (airtime) ───────────────────────────────────────────
      case "SELECT_NET_AIRTIME": {
        let net = "";
        if (input === "1" || input.includes("mtn")) net = "MTN";
        else if (input === "2" || input.includes("tele") || input.includes("voda")) net = "Telecel";
        else if (input === "3" || input.includes("at") || input.includes("tigo")) net = "AirtelTigo";

        if (!net) { reply = `❌ Please pick *1*, *2*, or *3* (MTN, Telecel, AirtelTigo).`; break; }
        data.net = net;
        data.isAirtime = true;
        reply = `💰 *Enter airtime amount in GH₵:*\n_Minimum: GH₵ 1.00 — Example: 5_`;
        nextStep = "ENTER_AIRTIME_AMT";
        break;
      }

      // ── Package selection ─────────────────────────────────────────────────────
      case "SELECT_PACKAGE": {
        const pkgs: Pkg[] = data.pkgList || [];
        const idx = parseInt(input) - 1;
        if (isNaN(idx) || idx < 0 || idx >= pkgs.length) {
          reply = `❌ Invalid choice. Pick a number from *1 to ${pkgs.length}*.`;
          break;
        }
        data.pkg = pkgs[idx].size;
        data.basePrice = pkgs[idx].basePrice;
        data.totalPrice = pkgs[idx].total;

        reply = [
          `✅ *${data.net} ${data.pkg}* — GH₵ ${data.totalPrice.toFixed(2)}`,
          ``,
          `📱 *Enter the recipient's phone number:*`,
          `_The number that will receive the data (e.g. 0244123456)_`,
        ].join("\n");
        nextStep = "ENTER_RECIPIENT";
        break;
      }

      // ── Airtime amount ────────────────────────────────────────────────────────
      case "ENTER_AIRTIME_AMT": {
        const amt = parseFloat(input.replace(/[^0-9.]/g, ""));
        if (isNaN(amt) || amt < 1) {
          reply = `❌ Minimum airtime is GH₵ 1.00. Enter a valid amount:`;
          break;
        }
        const fee = feeAmount(amt);
        data.airtimeBase = amt;
        data.totalPrice = parseFloat((amt + fee).toFixed(2));

        reply = [
          `✅ *${data.net} Airtime — GH₵ ${amt.toFixed(2)}*`,
          `_Payment fee: +GH₵ ${fee.toFixed(2)} → Total: GH₵ ${data.totalPrice.toFixed(2)}_`,
          ``,
          `📱 *Enter the recipient's phone number:*`,
          `_The number that will receive the airtime (e.g. 0244123456)_`,
        ].join("\n");
        nextStep = "ENTER_RECIPIENT";
        break;
      }

      // ── Recipient phone ───────────────────────────────────────────────────────
      case "ENTER_RECIPIENT": {
        const phone = normalizePhone(input);
        if (phone.length !== 10 || !phone.startsWith("0")) {
          reply = `❌ *Invalid phone number.*\n\nEnter a 10-digit Ghanaian number:\n_Example: 0244123456_`;
          break;
        }
        data.recipient = phone;

        // If sender is an Agent, prompt them to choose between Wallet Balance and Mobile Money!
        if (isSenderAgent || data.isAgentWholesale) {
          const agentBalance = Number(senderProfileMeta?.walletBalance || 0);
          let costPrice = Number(data.basePrice || (data.airtimeBase ? data.airtimeBase : 0));

          if (data.pkg) {
            try {
              const normNet = normalizeNetworkKey(data.net);
              const normPkg = data.pkg.replace(/\s+/g, "").toUpperCase();
              const { data: gRow } = await supabase
                .from("global_package_settings")
                .select("agent_price")
                .ilike("network", normNet)
                .ilike("package_size", normPkg)
                .maybeSingle();

              if (gRow?.agent_price && Number(gRow.agent_price) > 0) {
                costPrice = Number(gRow.agent_price);
              }
            } catch (err) {
              console.warn("[WA Bot] Could not fetch wholesale agent_price:", err);
            }
          }

          const retailTotal = Number(data.totalPrice || (data.basePrice ? addPaystackFee(data.basePrice) : addPaystackFee(costPrice)));

          data.agentBalance = agentBalance;
          data.wholesaleCost = costPrice;
          data.finalCost = costPrice;

          reply = [
            `💳 *Select Payment Method*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `📶 Network:   *${data.net}*`,
            data.pkg ? `📦 Bundle:    *${data.pkg}*` : `📱 Airtime:   *GH₵ ${data.airtimeBase?.toFixed(2)}*`,
            `👤 Recipient: \`${phone}\``,
            `━━━━━━━━━━━━━━━━━━━━`,
            `How would you like to pay?`,
            ``,
            `*1* — 💳 *Wallet Balance* (GH₵ ${costPrice.toFixed(2)} — Available: GH₵ ${agentBalance.toFixed(2)})`,
            `*2* — 📱 *Mobile Money Prompt* (GH₵ ${retailTotal.toFixed(2)})`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply 1 or 2 (or reply 0 to cancel)_`
          ].join("\n");
          nextStep = "SELECT_AGENT_PAYMENT_METHOD";
          break;
        }

        // Retail customer: Prompt for Mobile Money payment number!
        const normFrom = normalizePhone(from);
        const isFromGhana = normFrom && normFrom.length === 10 && normFrom.startsWith("0");

        const momoPromptLines: string[] = [
          `💳 *Payment Mobile Money (MoMo) Number*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Please provide the MoMo number that will make payment of *GH₵ ${(data.totalPrice || 0).toFixed(2)}*:`,
          ``,
          `• Reply *1* to pay with the recipient number (\`${phone}\`)`,
        ];

        if (isFromGhana && normFrom !== phone) {
          momoPromptLines.push(`• Reply *2* to pay with your WhatsApp number (\`${normFrom}\`)`);
        }

        momoPromptLines.push(
          `• Or type any other 10-digit Ghanaian MoMo number (e.g. \`0244123456\`)`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `_Reply 0 to cancel._`
        );

        reply = momoPromptLines.join("\n");
        nextStep = "ENTER_PAYER_MOMO";
        break;
      }

      // ── Select Agent Payment Method ──────────────────────────────────────────
      case "SELECT_AGENT_PAYMENT_METHOD": {
        if (input === "0") {
          reply = `❌ *Order cancelled.* Reply *Hi* for main menu.`;
          data = {};
          nextStep = "MENU";
          break;
        }

        const agentBalance = Number(senderProfileMeta?.walletBalance || 0);
        const costPrice = Number(data.wholesaleCost || data.finalCost || data.basePrice || (data.totalPrice ? data.totalPrice : 0));

        if (input === "1" || input.includes("wallet") || input.includes("bal")) {
          // Check if wallet balance is sufficient
          if (agentBalance < costPrice) {
            reply = [
              `⚠️ *Insufficient Wallet Balance*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `• Required Amount:  *GH₵ ${costPrice.toFixed(2)}*`,
              `• Current Balance:  *GH₵ ${agentBalance.toFixed(2)}*`,
              `• Shortage:         *GH₵ ${(costPrice - agentBalance).toFixed(2)}*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `What would you like to do?`,
              ``,
              `• Reply *2* to pay via Mobile Money instead 📱`,
              `• Reply *TOPUP* to top up your wallet now 💰`,
              `• Reply *0* to cancel ❌`
            ].join("\n");
            break;
          }

          data.paymentMethod = "wallet";
          data.isAgentWholesale = true;
          data.finalCost = costPrice;

          reply = [
            `📋 *Confirm Wallet Payment*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `📶 Network:        *${data.net}*`,
            data.pkg ? `📦 Bundle:         *${data.pkg}*` : `📱 Airtime:        *GH₵ ${data.airtimeBase?.toFixed(2)}*`,
            `👤 Recipient:      \`${data.recipient}\``,
            `💰 Debit Amount:   *GH₵ ${costPrice.toFixed(2)}*`,
            `💳 Wallet Balance: *GH₵ ${agentBalance.toFixed(2)}*`,
            `💵 Balance After:  *GH₵ ${(agentBalance - costPrice).toFixed(2)}*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `Reply *1* to confirm & debit wallet instantly ✅`,
            `Reply *0* to cancel ❌`
          ].join("\n");
          nextStep = "CONFIRM_ORDER";
          break;
        } else if (input === "2" || input.includes("momo") || input.includes("mobile")) {
          data.paymentMethod = "momo";
          data.isAgentWholesale = false;

          const normFrom = normalizePhone(from);
          const isFromGhana = normFrom && normFrom.length === 10 && normFrom.startsWith("0");

          const momoPromptLines: string[] = [
            `💳 *Payment Mobile Money (MoMo) Number*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Please provide the MoMo number that will make payment of *GH₵ ${(data.totalPrice || 0).toFixed(2)}*:`,
            ``,
            `• Reply *1* to pay with the recipient number (\`${data.recipient}\`)`,
          ];

          if (isFromGhana && normFrom !== data.recipient) {
            momoPromptLines.push(`• Reply *2* to pay with your WhatsApp number (\`${normFrom}\`)`);
          }

          momoPromptLines.push(
            `• Or type any other 10-digit Ghanaian MoMo number (e.g. \`0244123456\`)`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply 0 to cancel._`
          );

          reply = momoPromptLines.join("\n");
          nextStep = "ENTER_PAYER_MOMO";
          break;
        } else if (input.includes("topup") || input.includes("top up") || input.includes("deposit")) {
          data.authProfile = senderProfile;
          data.topupAgentId = senderProfile?.user_id;
          data.walletBalance = agentBalance;
          reply = [
            `💳 *Instant Wallet Top-Up*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `Current Balance: *GH₵ ${agentBalance.toFixed(2)}*`,
            ``,
            `⚡ *Please reply with the amount in GH₵ you want to deposit:*`,
            `_Example: 20, 50, 100_`,
            ``,
            `_Reply 0 to cancel._`
          ].join("\n");
          nextStep = "ENTER_WALLET_TOPUP_AMT";
          break;
        } else {
          reply = `⚠️ Please reply *1* for Wallet Balance or *2* for Mobile Money (or reply *0* to cancel).`;
          break;
        }
      }

      // ── Payment MoMo Number ───────────────────────────────────────────────────
      case "ENTER_PAYER_MOMO": {
        if (input === "0") {
          reply = `❌ *Order cancelled.* Reply *Hi* for main menu.`;
          data = {};
          nextStep = "MENU";
          break;
        }

        // Support switching to wallet from MoMo input
        if ((input === "w" || input === "wallet" || input === "bal") && (isSenderAgent || data.isAgentWholesale)) {
          const agentBalance = Number(senderProfileMeta?.walletBalance || 0);
          const costPrice = Number(data.wholesaleCost || data.finalCost || data.basePrice || (data.totalPrice ? data.totalPrice : 0));
          if (agentBalance < costPrice) {
            reply = `⚠️ *Insufficient Wallet Balance:*\n\nRequired: *GH₵ ${costPrice.toFixed(2)}*\nBalance: *GH₵ ${agentBalance.toFixed(2)}*\n\nPlease reply with your MoMo number to continue with MoMo payment, or reply *0* for menu.`;
            break;
          }
          data.paymentMethod = "wallet";
          data.isAgentWholesale = true;
          data.finalCost = costPrice;
          reply = [
            `📋 *Confirm Wallet Payment*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `📶 Network:        *${data.net}*`,
            data.pkg ? `📦 Bundle:         *${data.pkg}*` : `📱 Airtime:        *GH₵ ${data.airtimeBase?.toFixed(2)}*`,
            `👤 Recipient:      \`${data.recipient}\``,
            `💰 Debit Amount:   *GH₵ ${costPrice.toFixed(2)}*`,
            `💳 Wallet Balance: *GH₵ ${agentBalance.toFixed(2)}*`,
            `💵 Balance After:  *GH₵ ${(agentBalance - costPrice).toFixed(2)}*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `Reply *1* to confirm & debit wallet instantly ✅`,
            `Reply *0* to cancel ❌`
          ].join("\n");
          nextStep = "CONFIRM_ORDER";
          break;
        }

        const normFrom = normalizePhone(from);
        const isFromGhana = normFrom && normFrom.length === 10 && normFrom.startsWith("0");
        let payerPhone = "";

        if (input === "1") {
          payerPhone = data.recipient;
        } else if (input === "2" && isFromGhana && normFrom !== data.recipient) {
          payerPhone = normFrom;
        } else if (input === "yes" || input === "y") {
          payerPhone = data.recipient || normFrom || "";
        } else {
          payerPhone = normalizePhone(input);
        }

        if (!payerPhone || payerPhone.length !== 10 || !payerPhone.startsWith("0")) {
          reply = [
            `❌ *Invalid Mobile Money Number.*`,
            ``,
            `Please enter a valid 10-digit Ghanaian number (e.g. \`0244123456\`) or reply *1* to pay with recipient number (\`${data.recipient}\`):`
          ].join("\n");
          break;
        }

        data.payerMoMo = payerPhone;
        const payerMmoProvider = getPaymentProvider(payerPhone).toUpperCase();

        // Smart Duplicate Check (last 60 mins)
        let duplicateWarning = "";
        try {
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const { data: recent } = await supabase
            .from("orders")
            .select("id, status, created_at")
            .eq("customer_phone", data.recipient)
            .in("status", ["fulfilled", "pending", "paid", "processing"])
            .gte("created_at", oneHourAgo)
            .order("created_at", { ascending: false })
            .limit(1);

          if (recent && recent.length > 0) {
            const last = recent[0];
            const timeDiff = Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000);

            if (last.status === "fulfilled") {
              duplicateWarning = `\n⚠️ *Duplicate Warning:* A successful order for *${data.recipient}* was placed ${timeDiff} mins ago.`;
            } else {
              duplicateWarning = `\n⚠️ *Order in Progress:* You have an existing *${last.status}* order for this number from ${timeDiff} mins ago.`;
            }
          }
        } catch (err) {
          console.error("[WA Bot] Duplicate check error:", err);
        }

        const summary: string[] = [
          `📋 *Order Summary & Payment*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📶 Network:        *${data.net}*`,
        ];
        if (data.pkg) {
          summary.push(`📦 Bundle:         *${data.pkg}*`);
        } else {
          summary.push(`📱 Airtime:        *GH₵ ${data.airtimeBase?.toFixed(2)}*`);
        }
        summary.push(`👤 Recipient:      \`${data.recipient}\` (receives bundle)`);
        summary.push(`💳 Payment MoMo:   \`${data.payerMoMo}\` (${payerMmoProvider} MoMo)`);
        summary.push(`💰 Amount to Pay:  *GH₵ ${(data.totalPrice || 0).toFixed(2)}*`);
        summary.push(`_(includes 3% payment processing fee)_`);

        if (duplicateWarning) {
          summary.push(``, duplicateWarning);
        }

        summary.push(``);
        summary.push(`Reply *1* to send MoMo prompt ✅`);
        summary.push(`Reply *0* to cancel ❌`);

        reply = summary.join("\n");
        nextStep = "CONFIRM_ORDER";
        break;
      }

      // ── Order confirmation ────────────────────────────────────────────────────
      case "CONFIRM_ORDER": {
        if (input === "0") {
          reply = `❌ *Order cancelled.* Reply *Hi* to start a new order.`;
          data = {};
          nextStep = "MENU";
          break;
        }
        if (input !== "1") {
          reply = `Reply *1* to confirm or *0* to cancel.`;
          break;
        }

        // Handle Agent Wholesale Direct Wallet Debit Purchase
        const agentId = senderProfileMeta?.profile?.user_id || senderProfile?.user_id || data.agentBuyerId || data.authProfile?.user_id;
        if ((data.paymentMethod === "wallet" || data.isAgentWholesale) && agentId) {
          const cost = Number(data.finalCost || data.wholesaleCost || data.basePrice || (data.airtimeBase ? data.airtimeBase : 0) || data.totalPrice || 0);

          const { data: debitRes, error: debitErr } = await supabase.rpc("debit_wallet", {
            p_agent_id: agentId,
            p_amount: cost,
          });

          if (debitErr || !debitRes?.success) {
            reply = `❌ *Wallet Payment Failed:* ${debitErr?.message || debitRes?.message || "Insufficient wallet balance."}\n\nPlease top up your wallet (Option 2 in Agent Hub) or reply *0* for Agent Hub.`;
            nextStep = "SELECT_AGENT_SERVICE";
            data = {};
            break;
          }

          const orderId = crypto.randomUUID();
          await supabase.from("orders").insert({
            id: orderId,
            agent_id: agentId || ZERO_UUID,
            order_type: data.isAirtime ? "airtime" : "data",
            network: data.net,
            package_size: data.pkg || null,
            customer_phone: data.recipient,
            amount: cost,
            paystack_fee: 0,
            cost_price: cost,
            profit: 0,
            parent_profit: 0,
            status: "paid",
            payment_method: "wallet",
            channel: "whatsapp_agent",
            metadata: {
              source: "whatsapp_agent_wholesale",
              payment_method: "wallet",
              agent_phone: from,
              recipient: data.recipient
            }
          });

          // Trigger instant verification & provider fulfillment
          try {
            fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ reference: orderId })
            }).catch(console.error);
          } catch (_err) {
            console.warn("[WA Bot] Order verify dispatch error:", _err);
          }

          reply = [
            `✅ *Wholesale Order Placed & Paid!*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `• *Network:* ${data.net}`,
            `• *Bundle:* ${data.pkg || `GH₵ ${cost.toFixed(2)} Airtime`}`,
            `• *Recipient:* \`${data.recipient}\``,
            `• *Debited from Wallet:* GH₵ ${cost.toFixed(2)}`,
            `• *Remaining Balance:* GH₵ ${Number(debitRes.new_balance || 0).toFixed(2)}`,
            `• *Status:* ⚙️ *Queued for Instant Carrier Delivery* ⚡`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply 0 to return to Agent Hub._`
          ].join("\n");
          nextStep = "SELECT_AGENT_SERVICE";
          data = {};
          break;
        }

        const payerPhone = data.payerMoMo || normalizePhone(from) || data.recipient;
        let result: PayResult | null = null;
        if (!data.isAirtime && data.pkg) {
          const pkg: Pkg = { size: data.pkg, basePrice: data.basePrice, total: data.totalPrice };
          result = await initDataPayment(supabase, from, agent, pkg, data.net, data.recipient, payerPhone);
        } else {
          result = await initAirtimePayment(supabase, from, agent, data.net, data.airtimeBase, data.recipient, payerPhone);
        }

        if (!result) {
          reply = `❌ *Payment prompt failed.* Please verify your MoMo number (\`${payerPhone}\`) has an active mobile money account or reply *0* for menu.`;
          nextStep = "MENU";
          data = {};
          break;
        }

        data.lastOrderId = result.orderId;
        if (result.status === "send_otp") {
          data.otpMessage = result.otpMessage || "Please enter the OTP sent to your phone";
          reply = [
            `🔑 *OTP Verification Required*`,
            ``,
            `Paystack has sent a verification code (OTP) to \`${payerPhone}\`.`,
            ``,
            `💬 *Please reply with the OTP code here to complete your payment:*`,
            ``,
            `_Reply 0 to cancel._`,
          ].join("\n");
          nextStep = "AWAIT_OTP";
        } else {
          reply = [
            `📲 *MoMo Prompt Sent to ${payerPhone}!*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `*Step 1* — Please check the phone (\`${payerPhone}\`) for the Mobile Money PIN prompt.`,
            ``,
            `*Step 2* — Enter your PIN **on that phone** to approve the payment of *GH₵ ${(data.totalPrice || 0).toFixed(2)}*.`,
            ``,
            `*Step 3* — Reply *Done* here once payment is complete.`,
            ``,
            `⚠️ *Safety Note:* Do NOT send your MoMo PIN or any codes to this chat. Only enter it on the secure prompt that appears on your phone screen.`,
            ``,
            `_Your order is processed instantly after payment._`,
            `_Reply 0 to cancel._`,
          ].join("\n");
          nextStep = "AWAIT_PAYMENT";
        }
        break;
      }

      // ── Wallet Top-Up Amount ─────────────────────────────────────────────────
      case "ENTER_WALLET_TOPUP_AMT": {
        if (input === "0") {
          reply = `❌ *Top-up cancelled.* Reply *Hi* for menu.`;
          data = {};
          nextStep = "MENU";
          break;
        }
        const amt = parseFloat(input.replace(/[^0-9.]/g, ""));
        if (isNaN(amt) || amt < 1) {
          reply = `❌ Please enter a valid top-up amount in GH₵ (minimum GH₵ 1.00):`;
          break;
        }
        const fee = feeAmount(amt);
        const total = parseFloat((amt + fee).toFixed(2));
        data.topupAmount = amt;
        data.totalPrice = total;

        const defaultPayer = normalizePhone(from);
        reply = [
          `💳 *Wallet Top-Up Summary*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `• *Credit Amount:* GH₵ ${amt.toFixed(2)}`,
          `• *Gateway Fee:*   GH₵ ${fee.toFixed(2)}`,
          `• *Total to Pay:*  *GH₵ ${total.toFixed(2)}*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          ``,
          `📱 *Which MoMo number will pay?*`,
          `_Reply *YES* to use this WhatsApp number (\`${defaultPayer}\`), or type another 10-digit number._`,
          ``,
          `_Reply 0 to cancel_`
        ].join("\n");
        nextStep = "CONFIRM_WALLET_TOPUP";
        break;
      }

      // ── Confirm Wallet Top-Up MoMo ───────────────────────────────────────────
      case "CONFIRM_WALLET_TOPUP": {
        if (input === "0") {
          reply = `❌ *Top-up cancelled.* Reply *Hi* for menu.`;
          data = {};
          nextStep = "MENU";
          break;
        }

        let payerPhone = "";
        if (input === "yes" || input === "y" || input === "1") {
          payerPhone = normalizePhone(from);
        } else {
          payerPhone = normalizePhone(input);
        }

        if (payerPhone.length !== 10 || !payerPhone.startsWith("0")) {
          reply = `❌ Please enter a valid 10-digit phone number (e.g. 0244123456) or reply *YES*:`;
          break;
        }

        const agentUserId = data.topupAgentId || data.authProfile?.user_id;
        if (!agentUserId) {
          reply = `⚠️ User account verification failed. Please reply *0* and try again.`;
          nextStep = "MENU";
          break;
        }

        const amt = data.topupAmount;
        const fee = feeAmount(amt);
        const total = parseFloat((amt + fee).toFixed(2));
        data.totalPrice = total;
        const orderId = crypto.randomUUID();
        data.lastOrderId = orderId;
        data.topupAgentId = agentUserId;

        const paystackKey = await getPaystackSecretKey(supabase);

        if (!paystackKey) {
          reply = `⚠️ Payment gateway temporarily unavailable. Please try again later.\n\n_Reply 0 for Menu._`;
          nextStep = "MENU";
          break;
        }

        // Insert pending top-up order record before charging
        const { error: insErr } = await supabase.from("orders").insert({
          id: orderId,
          agent_id: agentUserId || ZERO_UUID,
          order_type: "wallet_topup",
          amount: amt,
          paystack_fee: fee,
          profit: 0,
          status: "pending",
          customer_phone: payerPhone,
          channel: "whatsapp_bot",
          metadata: {
            order_id: orderId,
            order_type: "wallet_topup",
            agent_id: agentUserId,
            wallet_credit: amt,
            wallet_type: "main",
            channel: "whatsapp_bot",
            phone: payerPhone,
          }
        });

        if (insErr) {
          console.error("[WA Bot] Topup pre-insert error:", insErr);
        }

        const providerCode = getPaymentProvider(payerPhone);

        try {
          const res = await fetch("https://api.paystack.co/charge", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${paystackKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              amount: Math.round(total * 100),
              email: `wa-${payerPhone}@swiftdatagh.shop`,
              currency: "GHS",
              reference: orderId,
              mobile_money: {
                phone: payerPhone,
                provider: providerCode,
              },
              metadata: {
                order_id: orderId,
                order_type: "wallet_topup",
                agent_id: agentUserId,
                wallet_credit: amt,
                wallet_type: "main",
                channel: "whatsapp_bot",
                phone: payerPhone,
              },
            }),
          });

          const j = await res.json();
          if (!j.status) {
            reply = `❌ *Payment prompt failed:* ${j.message || "Please check your MoMo number and try again."}\n\n_Reply 0 for Menu._`;
            nextStep = "MENU";
            break;
          }

          data.lastOrderId = orderId;
          reply = [
            `📲 *MoMo Deposit Prompt Sent!*`,
            ``,
            `*Step 1* — Please check your phone for the Mobile Money PIN prompt.`,
            ``,
            `*Step 2* — Enter your MoMo PIN to authorize *GH₵ ${total.toFixed(2)}* (Deposit: GH₵ ${amt.toFixed(2)}).`,
            ``,
            `*Step 3* — Reply *Done* here once payment is approved. Your wallet balance will be credited instantly! 💰`,
            ``,
            `⚠️ *Safety Note:* Never share your MoMo PIN in this chat.`,
            ``,
            `_Reply 0 to cancel._`
          ].join("\n");
          nextStep = "AWAIT_PAYMENT";
        } catch (err) {
          console.error("[WA Bot] Topup charge error:", err);
          reply = `⚠️ Network error while initiating payment prompt. Please try again.\n\n_Reply 0 for Menu._`;
          nextStep = "MENU";
        }
        break;
      }

      // ── Awaiting payment confirmation ─────────────────────────────────────────
      case "AWAIT_PAYMENT": {
        if (input === "0") {
          reply = `❌ *Order cancelled.* Reply *Hi* to return to the menu.`;
          data = {};
          nextStep = "MENU";
          break;
        }
        // "done" is handled by the global block above
        reply = [
          `⏳ *Waiting for your payment...*`,
          ``,
          `Once you've approved the MoMo prompt on your phone, reply *Done* to confirm.`,
          ``,
          `_Reply 0 to cancel and restart._`,
        ].join("\n");
        break;
      }

      // ── Awaiting OTP submission ───────────────────────────────────────────────
      case "AWAIT_OTP": {
        if (input === "0") {
          reply = `❌ *Order cancelled.* Reply *Hi* to return to the menu.`;
          data = {};
          nextStep = "MENU";
          break;
        }

        const otp = text.trim();
        if (!otp || otp.length < 4) {
          reply = `⚠️ *Invalid OTP format.* Please enter the verification code sent to your phone, or reply *0* to cancel.`;
          break;
        }

        try {
          const paystackKey = await getPaystackSecretKey(supabase);
          console.log(`[WA Bot] Submitting OTP for ${data.lastOrderId}...`);
          const res = await fetch("https://api.paystack.co/charge/submit_otp", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${paystackKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              otp,
              reference: data.lastOrderId,
            }),
          });

          const json = await res.json();
          console.log("[WA Bot] Paystack submit_otp response:", json);

          if (!res.ok || !json.status) {
            reply = `❌ *OTP verification failed:* ${json.message || "Invalid code"}\n\nPlease check the OTP and try again, or reply *0* to cancel.`;
            break;
          }

          reply = [
            `📲 *OTP Verified! MoMo Prompt Sent!*`,
            ``,
            `*Step 1* — Please check your phone for the Mobile Money PIN prompt.`,
            ``,
            `*Step 2* — Enter your PIN **on your phone** to approve the payment of GH₵ ${(data.totalPrice || 0).toFixed(2)}.`,
            ``,
            `*Step 3* — Reply *Done* here once payment is complete.`,
            ``,
            `⚠️ *Safety Note:* Do NOT send your MoMo PIN or any codes to this chat. Only enter it on the secure prompt that appears on your phone screen.`,
            ``,
            `_Your order is processed instantly after payment._`,
            `_Reply 0 to cancel._`,
          ].join("\n");
          nextStep = "AWAIT_PAYMENT";
        } catch (err) {
          console.error("[WA Bot] OTP submission error:", err);
          reply = `⚠️ *Connection Error:* Could not verify OTP right now. Please try again or reply *0* to cancel.`;
        }
        break;
      }

      // ── Order tracking ────────────────────────────────────────────────────────
      case "TRACK_ORDER": {
        const queryInput = text.trim();
        if (input === "0" || input === "menu" || input === "back" || input === "cancel") {
          reply = `Returning to Menu... Reply *Hi* or *0* to begin.`;
          nextStep = "MENU";
          break;
        }

        const isMe = input === "me" || input === "my" || input === "self";
        const targetRaw = isMe ? from : queryInput;
        const digits = targetRaw.replace(/\D/g, "");
        const isPhone = (digits.length >= 9 && digits.length <= 15) || isMe;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(queryInput);
        const isShortId = /^[0-9a-f]{8}$/i.test(queryInput);

        let ordersFound: any[] = [];

        if (isPhone) {
          // Normalize all Ghana phone number format permutations
          const searchPhones = [digits, `+${digits}`];
          if (digits.startsWith("0") && digits.length === 10) {
            searchPhones.push("233" + digits.slice(1));
            searchPhones.push("+233" + digits.slice(1));
            searchPhones.push(digits.slice(1));
          } else if (digits.startsWith("233") && digits.length === 12) {
            searchPhones.push("0" + digits.slice(3));
            searchPhones.push(digits.slice(3));
            searchPhones.push("+" + digits);
          } else if (digits.length === 9) {
            searchPhones.push("0" + digits);
            searchPhones.push("233" + digits);
            searchPhones.push("+233" + digits);
          }

          const { data: byCustomerPhone } = await supabase
            .from("orders")
            .select("id, status, network, package_size, amount, order_type, customer_phone, created_at, failure_reason, metadata")
            .in("customer_phone", searchPhones)
            .order("created_at", { ascending: false })
            .limit(3);

          if (byCustomerPhone && byCustomerPhone.length > 0) {
            ordersFound = byCustomerPhone;
          } else {
            // Check metadata momo_number
            for (const sp of searchPhones.slice(0, 3)) {
              const { data: byMomo } = await supabase
                .from("orders")
                .select("id, status, network, package_size, amount, order_type, customer_phone, created_at, failure_reason, metadata")
                .filter("metadata->>momo_number", "eq", sp)
                .order("created_at", { ascending: false })
                .limit(3);
              if (byMomo && byMomo.length > 0) {
                ordersFound = byMomo;
                break;
              }
            }
          }
        } else if (isUuid) {
          const { data: byId } = await supabase
            .from("orders")
            .select("id, status, network, package_size, amount, order_type, customer_phone, created_at, failure_reason, metadata")
            .eq("id", queryInput)
            .maybeSingle();
          if (byId) ordersFound = [byId];
        } else if (isShortId) {
          const { data: byShortId } = await supabase
            .from("orders")
            .select("id, status, network, package_size, amount, order_type, customer_phone, created_at, failure_reason, metadata")
            .ilike("id", `${queryInput}%`)
            .order("created_at", { ascending: false })
            .limit(3);
          if (byShortId && byShortId.length > 0) ordersFound = byShortId;
        } else {
          // Fallback to client reference or order_id in metadata
          const { data: byMeta } = await supabase
            .from("orders")
            .select("id, status, network, package_size, amount, order_type, customer_phone, created_at, failure_reason, metadata")
            .filter("metadata->>order_id", "eq", queryInput)
            .limit(1);
          if (byMeta && byMeta.length > 0) {
            ordersFound = byMeta;
          }
        }

        if (ordersFound.length === 0) {
          reply = [
            `❌ *No recent orders found for "${queryInput}".*`,
            ``,
            `💡 *Tips:*`,
            `• You can simply reply with the 10-digit phone number (e.g. *0547636024*) that received or made the purchase.`,
            `• Or reply with your Order ID.`,
            ``,
            `_Reply with a phone number to search again, or reply 0 for Menu._`
          ].join("\n");
          nextStep = "TRACK_ORDER";
          break;
        }

        const statusEmoji: Record<string, string> = {
          fulfilled: "✅ Delivered",
          processing: "⚙️ Processing (In Carrier Queue ⚡)",
          paid: "💳 Paid (Awaiting Carrier Dispatch)",
          pending: "⏳ Pending Payment",
          fulfillment_failed: "❌ Failed",
          refunded: "↩️ Refunded to Wallet",
        };

        const formatOrderDate = (isoStr: string) => {
          try {
            return new Date(isoStr).toLocaleString("en-GH", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          } catch {
            return String(isoStr).slice(0, 10);
          }
        };

        if (ordersFound.length === 1) {
          const ord = ordersFound[0];
          const stLabel = statusEmoji[ord.status] || ord.status.toUpperCase();
          const pkg = ord.package_size || `GH₵ ${Number(ord.amount || 0).toFixed(2)} Airtime`;
          const lines = [
            `🔍 *Order Status Diagnostic*`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `• *Order ID:* #${ord.id.slice(0, 8)}`,
            `• *Recipient:* \`${ord.customer_phone || "N/A"}\``,
            `• *Network:* ${ord.network || "N/A"}`,
            `• *Package:* ${pkg}`,
            `• *Amount:* GH₵ ${Number(ord.amount || 0).toFixed(2)}`,
            `• *Placed At:* ${formatOrderDate(ord.created_at)}`,
            `• *Live Status:* *${stLabel}*`,
          ];

          if (ord.status === "fulfillment_failed" && ord.failure_reason) {
            lines.push(
              `━━━━━━━━━━━━━━━━━━━━`,
              `⚠️ *Carrier Note:* ${sanitizePublicFailureReason(ord.failure_reason)}`
            );
          } else if (ord.status === "processing" || ord.status === "paid") {
            lines.push(
              `━━━━━━━━━━━━━━━━━━━━`,
              `⚡ _Carrier is actively broadcasting the data bundle to the SIM. Delivery confirmation usually takes under 60 seconds._`
            );
          } else if (ord.status === "fulfilled") {
            lines.push(
              `━━━━━━━━━━━━━━━━━━━━`,
              `🎉 _Bundle successfully credited to recipient's SIM card by carrier._`
            );
          }

          lines.push(
            ``,
            `_Reply with another phone number to track, or 0 for Menu._`
          );
          reply = lines.join("\n");
        } else {
          const lines = [
            `🔍 *Found ${ordersFound.length} Recent Orders for \`${queryInput}\`*`,
            `━━━━━━━━━━━━━━━━━━━━`,
          ];

          ordersFound.forEach((ord, idx) => {
            const numEmoji = ["1️⃣", "2️⃣", "3️⃣"][idx] || `•`;
            const stLabel = statusEmoji[ord.status] || ord.status.toUpperCase();
            const pkg = ord.package_size || `GH₵ ${Number(ord.amount || 0).toFixed(2)} Airtime`;
            lines.push(
              `${numEmoji} *${ord.network || ""} ${pkg}* (#${ord.id.slice(0, 8)})`,
              `   Status: *${stLabel}*`,
              `   Placed: ${formatOrderDate(ord.created_at)}`,
              `   Recipient: \`${ord.customer_phone}\``,
              ``
            );
          });

          lines.push(
            `━━━━━━━━━━━━━━━━━━━━`,
            `_Reply with another phone number to track, or 0 for Menu._`
          );
          reply = lines.join("\n");
        }
        nextStep = "TRACK_ORDER";
        break;
      }

      // ── Live Support Follow-up ─────────────────────────────────────────────
      case "LIVE_SUPPORT": {
        if (input === "0" || input === "menu" || input === "cancel") {
          reply = `Returning to Main Menu... Reply *Hi* or *0* to begin.`;
          nextStep = "MENU";
          break;
        }

        reply = [
          `👋 *SwiftData Support Desk*`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `We have noted your message regarding order #${(data.lastOrderId || "").slice(0, 8) || "inquiry"}.`,
          ``,
          `• Reply *R* to re-attempt automated delivery 🔄`,
          `• Or chat directly with our official technical support agent on WhatsApp:`,
          `👉 https://wa.me/233598170947`,
          ``,
          `_Reply 0 to return to Menu._`
        ].join("\n");
        nextStep = "LIVE_SUPPORT";
        break;
      }

      // ── Legacy AFA Session Fallback ─────────────────────────────────────────
      case "AFA_ENTER_PHONE":
      case "AFA_ENTER_NAME":
      case "AFA_ENTER_CARD":
      case "AFA_ENTER_DOB":
      case "AFA_ENTER_OCCUPATION":
      case "AFA_ENTER_RESIDENCE":
      case "AFA_ENTER_EMAIL":
      case "AFA_CONFIRM": {
        reply = `ℹ️ *AFA Registration has been discontinued.* Please reply *Hi* to view our available Data Bundles & Services.`;
        nextStep = "MENU";
        data = {};
        break;
      }

      default: {
        reply = `Reply *Hi* to start a new order.`;
        nextStep = "MENU";
        data = {};
        break;
      }
    }

    // Persist session state
    await supabase.from("whatsapp_sessions").upsert({
      phone_number: from,
      agent_id: agentId || "",
      current_step: nextStep,
      order_data: data,
      updated_at: new Date().toISOString(),
    });

    const finalReply = isSenderAdmin ? reply : sanitizePublicFailureReason(reply);
    if (finalReply) await sendWhatsAppMessage(from, finalReply);

    if (isKova) {
      return new Response(JSON.stringify({
        status: "success",
        reply: finalReply,
        message: finalReply,
        text: finalReply,
        data: {
          recipient: from,
          message: finalReply,
          text: finalReply,
        }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (isTwilio) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      });
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("[WA Webhook] Unhandled error:", e);
    if (isTwilio) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
        headers: { "Content-Type": "text/xml" },
        status: 200,
      });
    }
    return new Response("error", { headers: corsHeaders });
  }
});
