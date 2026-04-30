import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendWhatsAppMessage } from "../_shared/whatsapp.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://swiftdatagh.com";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

// const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PAYSTACK_FEE_RATE = 0.03;
const PAYSTACK_FEE_CAP = 100; // GHS

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("233") && d.length === 12) d = "0" + d.slice(3);
  if (d.length === 9) d = "0" + d;
  return d;
}

function normalizeNetworkKey(network: string): "MTN" | "Telecel" | "AirtelTigo" {
  const n = network.trim().toUpperCase();
  if (n === "AT" || n === "AIRTELTIGO" || n === "AIRTEL TIGO") return "AirtelTigo";
  if (n === "VODAFONE" || n === "TELECEL") return "Telecel";
  return "MTN";
}

function addPaystackFee(base: number): number {
  return parseFloat((base + Math.min(base * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP)).toFixed(2));
}

function feeAmount(base: number): number {
  return parseFloat(Math.min(base * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP).toFixed(2));
}

async function callGemini(prompt: string) {
  if (!GEMINI_API_KEY) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
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

// ── WaSender payload parser ───────────────────────────────────────────────────

function parseMessage(payload: any): { from: string; text: string; fromMe: boolean } {
  const m = payload?.data?.messages;
  if (!m) return { from: "", text: "", fromMe: false };
  const from = m.key?.cleanedSenderPn || m.key?.remoteJid?.split("@")[0] || "";
  const text = m.messageBody || m.message?.conversation || m.message?.extendedTextMessage?.text || "";
  return { from: from.trim(), text: text.trim(), fromMe: Boolean(m.key?.fromMe) };
}

// ── Data access ───────────────────────────────────────────────────────────────

type Agent = {
  id: string;
  name: string;
  prices: Record<string, Record<string, number>>;
  wa: string | null;
  isSubAgent: boolean;
  parentAgentId: string | null;
};

async function getAgent(supabase: any, val: string, byId = false): Promise<Agent | null> {
  const q = supabase.from("profiles").select(
    "user_id, store_name, full_name, agent_prices, slug, agent_approved, sub_agent_approved, whatsapp_number, is_sub_agent, parent_agent_id"
  );
  const { data: p } = await (byId ? q.eq("user_id", val) : q.eq("slug", val.toLowerCase())).maybeSingle();
  if (!p) return null;
  if (!byId && !p.agent_approved && !p.sub_agent_approved) return null;
  return {
    id: p.user_id,
    name: p.store_name || p.full_name || "SwiftData",
    prices: (p.agent_prices || {}) as Record<string, Record<string, number>>,
    wa: p.whatsapp_number || null,
    isSubAgent: Boolean(p.is_sub_agent),
    parentAgentId: p.parent_agent_id || null,
  };
}

type Pkg = { size: string; basePrice: number; total: number };

async function getPackagesForNetwork(supabase: any, network: string, agentPrices: Record<string, Record<string, number>>): Promise<Pkg[]> {
  const pkgs: Pkg[] = [];

  // 1. Use agent's custom selling prices if configured (case-insensitive)
  const custom = (agentPrices?.[network] || agentPrices?.[network.toUpperCase()] || agentPrices?.[network.toLowerCase()] || {}) as Record<string, number>;
  for (const [size, price] of Object.entries(custom)) {
    const base = Number(price);
    if (base > 0) pkgs.push({ size, basePrice: base, total: addPaystackFee(base) });
  }
  if (pkgs.length > 0) return pkgs.sort((a, b) => a.total - b.total);

  // 2. Fall back to global public prices
  const { data: rows, error } = await supabase
    .from("global_package_settings")
    .select("package_size, public_price, agent_price")
    .or(`network.eq.${network.toUpperCase()},network.eq.${network.toLowerCase()},network.eq.${network}`)
    .eq("is_unavailable", false)
    .order("public_price", { ascending: true });

  if (error) {
    console.error("[WA Bot] DB Error fetching bundles:", error);
    throw error;
  }

  for (const row of rows || []) {
    const base = Number(row.public_price || row.agent_price || 0);
    if (base > 0) pkgs.push({ size: row.package_size, basePrice: base, total: addPaystackFee(base) });
  }
  return pkgs;
}

// ── Profit resolution (mirrors initialize-payment logic) ─────────────────────

type ProfitInfo = { profit: number; parentProfit: number; parentAgentId: string | null; costPrice: number };

async function resolveProfit(
  supabase: any,
  network: string,
  packageSize: string,
  agent: Agent,
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

type PayResult = { orderId: string };

async function initDataPayment(
  supabase: any,
  from: string,
  agent: Agent,
  pkg: Pkg,
  network: string,
  recipient: string
): Promise<PayResult | null> {
  const orderId = crypto.randomUUID();
  const fee = feeAmount(pkg.basePrice);
  const { profit, parentProfit, parentAgentId, costPrice } = await resolveProfit(supabase, network, pkg.size, agent, pkg.basePrice);

  const providerMap: Record<string, string> = { "MTN": "mtn", "Telecel": "vod", "AirtelTigo": "tgo" };
  const provider = providerMap[network];

  const metadata = {
    order_id: orderId,
    order_type: "data",
    agent_id: agent.id,
    network,
    package_size: pkg.size,
    customer_phone: recipient,
    channel: "whatsapp",
    wa_from: from,
    base_price: pkg.basePrice,
    cost_price: costPrice,
    profit,
    parent_profit: parentProfit,
    parent_agent_id: parentAgentId,
  };

  try {
    const res = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `wa-${from}@swiftdatagh.com`,
        amount: Math.round(pkg.total * 100),
        reference: orderId,
        metadata,
        currency: "GHS",
        mobile_money: {
          phone: normalizePhone(from),
          provider,
        }
      }),
    });
    const json = await res.json();
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
    agent_id: agent.id,
    parent_agent_id: parentAgentId || null,
    order_type: "data",
    network,
    package_size: pkg.size,
    customer_phone: recipient,
    amount: pkg.basePrice,
    paystack_fee: fee,
    cost_price: costPrice,
    profit,
    parent_profit: parentProfit,
    status: "pending",
    failure_reason: null,
  });
  if (error) { console.error("[WA Bot] Order insert error:", error); return null; }

  return { orderId };
}

async function initAirtimePayment(
  supabase: any,
  from: string,
  agent: Agent,
  network: string,
  airtimeBase: number,
  recipient: string
): Promise<PayResult | null> {
  const orderId = crypto.randomUUID();
  const fee = feeAmount(airtimeBase);
  const total = parseFloat((airtimeBase + fee).toFixed(2));

  const providerMap: Record<string, string> = { "MTN": "mtn", "Telecel": "vod", "AirtelTigo": "tgo" };
  const provider = providerMap[network];

  const metadata = {
    order_id: orderId,
    order_type: "airtime",
    agent_id: agent.id,
    network,
    customer_phone: recipient,
    base_price: airtimeBase,
    channel: "whatsapp",
    wa_from: from,
    profit: 0,
    parent_profit: 0,
  };

  try {
    const res = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `wa-${from}@swiftdatagh.com`,
        amount: Math.round(total * 100),
        reference: orderId,
        metadata,
        currency: "GHS",
        mobile_money: {
          phone: normalizePhone(from),
          provider,
        }
      }),
    });
    const json = await res.json();
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
    agent_id: agent.id,
    order_type: "airtime",
    network,
    package_size: null,
    customer_phone: recipient,
    amount: airtimeBase,
    paystack_fee: fee,
    cost_price: null,
    profit: 0,
    parent_profit: 0,
    status: "pending",
    failure_reason: null,
  });
  if (error) { console.error("[WA Bot] Airtime order insert error:", error); return null; }

  return { orderId };
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabase = supabaseAdmin;

  try {
    const payload = await req.json();
    const { from, text, fromMe } = parseMessage(payload);

    if (!payload?.event?.includes("message") || !from || !text || fromMe) {
      return new Response("ok");
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

    // ── GLOBAL: "done" — verify payment ──────────────────────────────────────
    if (input === "done" && data.lastOrderId) {
      sendWhatsAppMessage(from, `⏳ _Checking payment status..._`).catch(console.error);
      try {
        const vRes = await fetch(`https://api.paystack.co/transaction/verify/${data.lastOrderId}`, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        });
        const vJson = await vRes.json();
        
        if (vJson.status && vJson.data?.status === "success") {
          // Force DB update so dashboard tracks it instantly
          await supabase.from("orders").update({ status: "paid" }).eq("id", data.lastOrderId);

          // Clear session — fulfillment is handled by the Paystack webhook automatically
          await supabase.from("whatsapp_sessions").delete().eq("phone_number", from);
          await sendWhatsAppMessage(from, [
            `✅ *Payment Confirmed!*`,
            ``,
            `Your *${data.net || ""} ${data.pkg || "airtime"}* order is being processed and will arrive shortly. 🚀`,
            ``,
            `_Reply *Hi* anytime to place a new order._`,
          ].join("\n"));
          
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

    // ── GLOBAL: reset commands ────────────────────────────────────────────────
    if (["0", "hi", "hello", "start", "cancel", "menu"].includes(input)) {
      step = "MENU";
      data = {};
    }

    // ── Agent detection on first contact ─────────────────────────────────────
    if (step === "MENU" && !agentId) {
      for (const word of text.split(/\s+/)) {
        const found = await getAgent(supabase, word);
        if (found) { agentId = found.id; break; }
      }
    }

    // ── AI Intent Parsing (Training Like a Pro) ─────────────────────────────
    if (step === "MENU" && !["1","2","3","4"].includes(input)) {
      let customPrompt = SYSTEM_PROMPT;
      try {
        const { data: settingsData } = await supabase
          .from("system_settings")
          .select("whatsapp_bot_prompt")
          .eq("id", 1)
          .maybeSingle();
        if (settingsData && settingsData.whatsapp_bot_prompt && settingsData.whatsapp_bot_prompt.trim().length > 0) {
          customPrompt = settingsData.whatsapp_bot_prompt;
        }
      } catch (err) {
        console.error("Failed to fetch custom bot prompt:", err);
      }

      const agent = agentId ? await getAgent(supabase, agentId, true) : null;
      const storeName = agent?.name || "SwiftData";
      const aiResponse = await callGemini(`${customPrompt.replace("{{storeName}}", storeName)}\n\nUser Message: "${text}"\n\nAnalyze the intent and respond with a friendly message or identify the service needed.`);
      if (aiResponse) {
        if (aiResponse.includes("BUY_DATA") || text.toLowerCase().includes("data")) {
          step = "SELECT_SERVICE";
          input = "1";
        } else if (aiResponse.includes("BUY_AIRTIME") || text.toLowerCase().includes("airtime")) {
          step = "SELECT_SERVICE";
          input = "2";
        } else if (aiResponse.includes("TRACK") || text.toLowerCase().includes("track")) {
          step = "SELECT_SERVICE";
          input = "3";
        } else {
          await sendWhatsAppMessage(from, aiResponse);
          return new Response("ok");
        }
      }
    }

    const agent = agentId ? await getAgent(supabase, agentId, true) : null;
    const storeName = agent?.name || "SwiftData";

    let reply = "";
    let nextStep = step;

    // ── State machine ─────────────────────────────────────────────────────────
    switch (step) {
      // ── MENU ─────────────────────────────────────────────────────────────────
      case "MENU": {
        reply = [
          `👋 *Welcome to ${storeName}!*`,
          ``,
          `What would you like?`,
          ``,
          `*1* — Buy Data 📶`,
          `*2* — Buy Airtime 📱`,
          `*3* — Track Order 🔍`,
          `*4* — Talk to Agent 👨‍💼`,
          ``,
          `_Reply with 1, 2, 3 or 4_`,
        ].join("\n");
        nextStep = "SELECT_SERVICE";
        break;
      }

      // ── Service selection ─────────────────────────────────────────────────────
      case "SELECT_SERVICE": {
        if (input === "1" || input.includes("data")) {
          reply = `📶 *Select Network:*\n\n*1* — MTN\n*2* — Telecel\n*3* — AirtelTigo\n\n_Reply 0 to go back_`;
          nextStep = "SELECT_NET_DATA";
        } else if (input === "2" || input.includes("airtime")) {
          reply = `📱 *Select Network for Airtime:*\n\n*1* — MTN\n*2* — Telecel\n*3* — AirtelTigo\n\n_Reply 0 to go back_`;
          nextStep = "SELECT_NET_AIRTIME";
        } else if (input === "3" || input.includes("track")) {
          reply = `🔍 *Enter your Order ID:*\n\n_It was shown in your receipt message._`;
          nextStep = "TRACK_ORDER";
        } else if (input === "4") {
          const waNum = agent?.wa?.replace(/[^0-9]/g, "");
          reply = waNum
            ? `👨‍💼 *Agent Support:*\n\nhttps://wa.me/${waNum}\n\n_Tap the link to message your agent directly._`
            : `👨‍💼 *Agent support is currently unavailable.*\n\n_Reply 0 to return to menu._`;
          nextStep = "MENU";
        } else {
          reply = `⚠️ Please reply with *1*, *2*, *3*, or *4*.`;
        }
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

        await sendWhatsAppMessage(from, `⏳ _Fetching ${net} bundles..._`);
        let pkgs: Pkg[] = [];
        try {
          console.log(`[WA Bot] Fetching ${net} bundles for agent:`, agentId || "SwiftData");
          pkgs = await getPackagesForNetwork(supabase, net, agent?.prices || {});
        } catch (err) {
          console.error("[WA Bot] Error fetching bundles:", err);
          await sendWhatsAppMessage(from, `⚠️ *Technical Error:* Could not connect to the database. Our team has been notified. Please try again in a few minutes.`);
          return new Response("ok");
        }

        if (pkgs.length === 0) {
          reply = `⚠️ *${net} bundles are currently unavailable.* Our team is working on it.\n\n_Reply 0 to return to the menu._`;
          nextStep = "MENU";
          break;
        }

        data.pkgList = pkgs;
        const lines = pkgs.map((p, i) => `*${i + 1}*. ${p.size} — GH₵ ${p.total.toFixed(2)}`);
        reply = `📦 *${net} Data Bundles:*\n_(prices include payment fee)_\n\n${lines.join("\n")}\n\n_Reply with the bundle number — or 0 to go back_`;
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

        const summary: string[] = [
          `📋 *Order Summary*`,
          ``,
          `Network:   *${data.net}*`,
        ];
        if (data.pkg) {
          summary.push(`Bundle:    *${data.pkg}*`);
        } else {
          summary.push(`Airtime:   *GH₵ ${data.airtimeBase?.toFixed(2)}*`);
        }
        summary.push(`Recipient: *${phone}*`);
        summary.push(`You Pay:   *GH₵ ${(data.totalPrice || 0).toFixed(2)}*`);
        summary.push(`_(includes 3% payment processing fee)_`);
        summary.push(``);
        summary.push(`Reply *1* to confirm ✅`);
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

        if (!agent) {
          reply = `⚠️ *Store error.* Please restart by sending *Hi*.`;
          nextStep = "MENU";
          data = {};
          break;
        }

        sendWhatsAppMessage(from, `⏳ _Pushing payment prompt to your phone..._`).catch(console.error);

        let result: PayResult | null = null;
        if (!data.isAirtime && data.pkg) {
          const pkg: Pkg = { size: data.pkg, basePrice: data.basePrice, total: data.totalPrice };
          result = await initDataPayment(supabase, from, agent, pkg, data.net, data.recipient);
        } else {
          result = await initAirtimePayment(supabase, from, agent, data.net, data.airtimeBase, data.recipient);
        }

        if (!result) {
          reply = `❌ *Payment prompt failed.* Please try again or reply *0* for the menu.`;
          nextStep = "MENU";
          data = {};
          break;
        }

        data.lastOrderId = result.orderId;
        reply = [
          `📲 *MoMo Prompt Sent!*`,
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
        break;
      }

      // ── Awaiting payment confirmation ─────────────────────────────────────────
      case "AWAIT_PAYMENT": {
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

      // ── Order tracking ────────────────────────────────────────────────────────
      case "TRACK_ORDER": {
        const orderId = text.trim();
        const { data: order } = await supabase
          .from("orders")
          .select("status, network, package_size, amount, order_type, created_at, failure_reason")
          .eq("id", orderId)
          .maybeSingle();

        if (!order) {
          reply = `❌ *Order not found.*\n\nCheck the ID and try again, or reply *0* for the menu.`;
          break;
        }

        const statusEmoji: Record<string, string> = {
          pending: "⏳ Pending",
          paid: "💳 Paid",
          processing: "⚙️ Processing",
          fulfilled: "✅ Delivered",
          fulfillment_failed: "❌ Failed",
        };
        const statusLabel = statusEmoji[order.status] || order.status.toUpperCase();
        const date = new Date(order.created_at).toLocaleDateString("en-GH", {
          day: "numeric", month: "short", year: "numeric",
        });

        const lines = [
          `🔍 *Order Status*`,
          ``,
          `Network: *${order.network || "N/A"}*`,
          order.package_size
            ? `Bundle:  *${order.package_size}*`
            : `Amount:  *GH₵ ${Number(order.amount).toFixed(2)}*`,
          `Date:    ${date}`,
          `Status:  *${statusLabel}*`,
        ];
        if (order.status === "fulfillment_failed" && order.failure_reason) {
          lines.push(``, `_${String(order.failure_reason).slice(0, 120)}_`);
        }
        lines.push(``, `_Reply 0 to return to the menu._`);
        reply = lines.join("\n");
        nextStep = "MENU";
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
      agent_id: agentId,
      current_step: nextStep,
      order_data: data,
      updated_at: new Date().toISOString(),
    });

    if (reply) await sendWhatsAppMessage(from, reply);
    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("[WA Webhook] Unhandled error:", e);
    return new Response("error", { headers: corsHeaders });
  }
});
