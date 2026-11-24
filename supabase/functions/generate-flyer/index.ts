import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/gateway-security.ts";

// The generated flyer HTML is returned to the client and rendered via
// innerHTML/document.write (outside JSX's auto-escaping), and both the
// client-supplied fields (storeName/storeUrl/contact) and the AI's own
// output (customGreetingText/tagline/etc, reachable via the user-supplied
// `prompt`) end up interpolated into it — escape everything before it's built in.
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authenticateCaller(req: Request): Promise<{ ok: boolean; userId?: string; error?: string; status?: number }> {
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const token = userToken || authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return { ok: false, error: "Unauthorized: Missing authentication token", status: 401 };
  }

  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (serviceRoleKey && timingSafeEqual(token, serviceRoleKey)) {
    return { ok: true, userId: "service-role" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, error: "Server auth configuration missing", status: 500 };
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, error: "Unauthorized: Invalid session token", status: 401 };
    }
    return { ok: true, userId: data.user.id };
  } catch (err) {
    console.error("[AI Flyer] Auth error:", err);
    return { ok: false, error: "Unauthorized", status: 401 };
  }
}

interface AiFlyerDesign {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundGradient: string;
  customGreetingText: string;
  tagline: string;
  fontFamily: string;
  caption: string;
  whatsappStatus: string;
  promoBroadcast: string;
  variants?: string[];
}

function extractJsonObject(rawText: string): Record<string, unknown> | null {
  const trimmed = (rawText || "").trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;
  try {
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }
}

async function generateWithOpenAI(
  apiKey: string,
  systemInstruction: string,
  userMsg: string
): Promise<{ parsed: Record<string, unknown> | null; model: string }> {
  const model = "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userMsg },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI Chat API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content || "";
  return { parsed: extractJsonObject(rawText), model };
}

async function generateWithGemini(
  apiKey: string,
  systemInstruction: string,
  userMsg: string
): Promise<{ parsed: Record<string, unknown> | null; model: string }> {
  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
  let lastErr = "Gemini request failed";

  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemInstruction}\n\nInput:\n${userMsg}` }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (res.ok) {
      const geminiData = await res.json();
      const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      return { parsed: extractJsonObject(rawText), model };
    }
    lastErr = `Gemini ${model} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`;
  }

  throw new Error(lastErr);
}

async function generatePromoImage(
  apiKey: string,
  storeName: string,
  prompt: string,
  imageSize: string
): Promise<{ imageUrl?: string; imageBase64?: string; imageModel?: string; imageError?: string }> {
  const imagePrompt = `Modern, vibrant Ghanaian mobile data bundle promotional flyer background graphic for "${storeName}". Clean bold commercial aesthetic, warm gold and deep emerald/dark accents, high contrast, no gibberish text. Theme: ${prompt || "Affordable MTN, Telecel, AirtelTigo instant data deals in Ghana"}.`;

  const allowedSizes = new Set(["1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"]);
  const safeSize = allowedSizes.has(imageSize) ? imageSize : "1024x1024";

  // Primary: gpt-image-1
  try {
    const primaryRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: imagePrompt,
        n: 1,
        size: safeSize === "1024x1792" || safeSize === "1792x1024" ? "1024x1024" : safeSize,
      }),
    });

    if (primaryRes.ok) {
      const data = await primaryRes.json();
      const item = data?.data?.[0];
      if (item?.b64_json || item?.url) {
        return {
          imageBase64: item.b64_json,
          imageUrl: item.url,
          imageModel: "gpt-image-1",
        };
      }
    } else {
      const errText = await primaryRes.text().catch(() => "");
      console.warn(`[AI Flyer] gpt-image-1 failed (${primaryRes.status}), falling back to dall-e-3: ${errText.slice(0, 200)}`);
    }
  } catch (err: any) {
    console.warn("[AI Flyer] gpt-image-1 exception, falling back to dall-e-3:", err?.message || err);
  }

  // Fallback: dall-e-3
  try {
    const dalleSize = safeSize === "1024x1536" || safeSize === "1536x1024" ? "1024x1024" : safeSize;
    const fallbackRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: imagePrompt,
        n: 1,
        size: dalleSize,
        response_format: "url",
      }),
    });

    if (fallbackRes.ok) {
      const data = await fallbackRes.json();
      const item = data?.data?.[0];
      if (item?.url || item?.b64_json) {
        return {
          imageUrl: item.url,
          imageBase64: item.b64_json,
          imageModel: "dall-e-3",
        };
      }
    }

    const errText = await fallbackRes.text().catch(() => "");
    return { imageError: `Image generation failed (${fallbackRes.status}): ${errText.slice(0, 200)}` };
  } catch (err: any) {
    return { imageError: `Image generation error: ${err?.message || String(err)}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await authenticateCaller(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error || "Unauthorized" }, auth.status || 401);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const {
      storeName,
      storeUrl = "",
      packages = {},
      networks = [],
      contact = "",
      prompt = "",
      mode = "flyer",
      category = "daily",
      network = "",
      generateImage = false,
      imageSize = "1024x1024",
    } = payload;

    if (!storeName) {
      return jsonResponse({ error: "Store name is required" }, 400);
    }

    const OPENAI_API_KEY = (Deno.env.get("OPENAI_API_KEY") || "").trim();
    const GEMINI_API_KEY = (Deno.env.get("GEMINI_API_KEY") || "").trim();

    const defaultCaption = `🔥 Promo Alert from ${storeName}! 🔥\nGet the cheapest MTN, Telecel & AirtelTigo data bundles in Ghana instantly — pay with MoMo, no wahala! ⚡\n\n📲 Order here: ${storeUrl || "swiftdatagh.shop"}\n\n#SwiftData #GhanaDataPlug #MobileDataGH`;

    let aiDesign: AiFlyerDesign = {
      primaryColor: "#EAB308",
      secondaryColor: "#111111",
      accentColor: "#EAB308",
      backgroundGradient: "linear-gradient(135deg, #111111 0%, #1e1e1e 100%)",
      customGreetingText: "Official Data Reseller",
      tagline: "Your trusted mobile data plug",
      fontFamily: "Poppins",
      caption: defaultCaption,
      whatsappStatus: defaultCaption,
      promoBroadcast: `🇬🇭 ${storeName} Daily Data Drop!\n\n✅ MTN, Telecel & AirtelTigo bundles at unbeatable GH₵ prices\n⚡ Instant MoMo checkout & fast delivery\n\nTap to order now 👉 ${storeUrl || "swiftdatagh.shop"}${contact ? `\n📞 Support: ${contact}` : ""}`,
      variants: [defaultCaption],
    };

    let aiProvider: "openai" | "gemini" | "default" = "default";
    let aiModel = "template-default";

    const effectivePrompt = String(prompt || "").trim() ||
      (mode === "promo_copy"
        ? `Create punchy Ghanaian WhatsApp status captions and a promo broadcast for category "${category}"${network ? ` focusing on ${network} bundles` : " covering MTN, Telecel, and AirtelTigo"}.`
        : "");

    const shouldInvokeAi = Boolean(effectivePrompt) && (Boolean(OPENAI_API_KEY) || Boolean(GEMINI_API_KEY));

    if (shouldInvokeAi) {
      const systemInstruction = `You are a top Ghanaian digital marketing copywriter and graphic designer specializing in mobile data resellers (MTN, Telecel, AirtelTigo, MoMo payments, GH₵ pricing).
Write authentic, high-converting Ghanaian WhatsApp marketing copy (warm, energetic, concise, natural Ghanaian phrasing like "no wahala", "sharp delivery", "your trusted data plug", without overdoing slang) plus matching flyer design tokens.
Return ONLY a valid raw JSON object with these exact keys:
- primaryColor: hex color string (e.g. "#EAB308")
- secondaryColor: dark hex background color string (e.g. "#111111")
- accentColor: hex color string
- backgroundGradient: valid CSS linear-gradient string
- customGreetingText: short punchy banner badge (max 5 words)
- tagline: compelling sales tagline (max 10 words)
- fontFamily: one of "Poppins", "Montserrat", "Inter", or "Space Grotesk"
- caption: ready-to-post WhatsApp Status caption with emojis, GH₵ value pitch, and the store URL
- whatsappStatus: concise 4-6 line WhatsApp Status post (optimized for mobile status screen) including the store URL
- promoBroadcast: slightly richer WhatsApp broadcast / group promo message with bullet points and clear CTA including the store URL
- variants: array of 2 additional distinct short Ghanaian WhatsApp Status caption variations (strings) including the store URL`;

      const networkNames = Array.isArray(networks)
        ? networks.map((n: any) => (typeof n === "string" ? n : n?.name)).filter(Boolean).join(", ")
        : "";
      const userMsg = [
        `Store Name: ${storeName}`,
        `Store URL: ${storeUrl || "swiftdatagh.shop"}`,
        contact ? `Contact/MoMo: ${contact}` : "",
        network ? `Featured Network: ${network}` : "",
        networkNames ? `Networks: ${networkNames}` : "",
        `Mode: ${mode}`,
        `Category: ${category}`,
        `Style/Promo Prompt: "${effectivePrompt}"`,
      ].filter(Boolean).join("\n");

      // Primary: OpenAI (gpt-4o-mini)
      if (OPENAI_API_KEY) {
        try {
          const { parsed, model } = await generateWithOpenAI(OPENAI_API_KEY, systemInstruction, userMsg);
          if (parsed) {
            aiDesign = {
              ...aiDesign,
              ...parsed,
              caption: String(parsed.caption || parsed.whatsappStatus || aiDesign.caption),
              whatsappStatus: String(parsed.whatsappStatus || parsed.caption || aiDesign.whatsappStatus),
              promoBroadcast: String(parsed.promoBroadcast || parsed.caption || aiDesign.promoBroadcast),
              variants: Array.isArray(parsed.variants)
                ? parsed.variants.map((v) => String(v)).filter(Boolean)
                : aiDesign.variants,
            };
            aiProvider = "openai";
            aiModel = model;
          }
        } catch (err: any) {
          console.error("[AI Flyer] OpenAI call failed:", err?.message || err);
        }
      }

      // Fallback: Gemini (only if OpenAI wasn't configured or failed)
      if (aiProvider === "default" && GEMINI_API_KEY) {
        try {
          const { parsed, model } = await generateWithGemini(GEMINI_API_KEY, systemInstruction, userMsg);
          if (parsed) {
            aiDesign = {
              ...aiDesign,
              ...parsed,
              caption: String(parsed.caption || parsed.whatsappStatus || aiDesign.caption),
              whatsappStatus: String(parsed.whatsappStatus || parsed.caption || aiDesign.whatsappStatus),
              promoBroadcast: String(parsed.promoBroadcast || parsed.caption || aiDesign.promoBroadcast),
              variants: Array.isArray(parsed.variants)
                ? parsed.variants.map((v) => String(v)).filter(Boolean)
                : aiDesign.variants,
            };
            aiProvider = "gemini";
            aiModel = model;
          }
        } catch (err: any) {
          console.error("[AI Flyer] Gemini fallback failed:", err?.message || err);
        }
      }
    }

    // Optional AI Flyer Image Generation (gpt-image-1 -> dall-e-3 fallback)
    let imageResult: { imageUrl?: string; imageBase64?: string; imageModel?: string; imageError?: string } = {};
    if (generateImage && OPENAI_API_KEY) {
      imageResult = await generatePromoImage(OPENAI_API_KEY, String(storeName), effectivePrompt, String(imageSize));
    } else if (generateImage && !OPENAI_API_KEY) {
      imageResult = { imageError: "OPENAI_API_KEY is not configured for image generation." };
    }

    const safeAiDesign = {
      ...aiDesign,
      customGreetingText: escapeHtml(aiDesign.customGreetingText),
      tagline: escapeHtml(aiDesign.tagline),
      fontFamily: escapeHtml(aiDesign.fontFamily),
      primaryColor: escapeHtml(aiDesign.primaryColor),
      secondaryColor: escapeHtml(aiDesign.secondaryColor),
      accentColor: escapeHtml(aiDesign.accentColor),
      backgroundGradient: escapeHtml(aiDesign.backgroundGradient),
    };

    const htmlFlyer = buildFlyerHtml(
      escapeHtml(storeName),
      escapeHtml(storeUrl),
      packages || {},
      Array.isArray(networks) ? networks : [],
      escapeHtml(contact),
      safeAiDesign
    );

    return jsonResponse({
      html: htmlFlyer,
      caption: aiDesign.caption,
      whatsappStatus: aiDesign.whatsappStatus,
      promoBroadcast: aiDesign.promoBroadcast,
      variants: aiDesign.variants || [],
      design: aiDesign,
      provider: aiProvider,
      model: aiModel,
      ...imageResult,
    });
  } catch (error: any) {
    console.error("Flyer generation error:", error);
    return jsonResponse({ error: "Failed to generate flyer" }, 500);
  }
});

// deno-lint-ignore no-explicit-any
function buildFlyerHtml(storeName: string, storeUrl: string, packages: any, networks: any[], contact: string, design: any): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&family=Montserrat:wght@400;600;700;900&family=Inter:wght@400;600;700;900&family=Space+Grotesk:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box }
body { font-family:'${design.fontFamily || 'Poppins'}', sans-serif; background:#111; padding:24px; display:flex; justify-content:center; align-items:center; min-height:100vh }
.flyer { width:100%; max-width:900px; background:${design.secondaryColor || '#1a1a1a'}; background-image:${design.backgroundGradient}; border-radius:24px; overflow:hidden; border:2px solid ${design.primaryColor || '#EAB308'} }
.header { padding:36px 24px; text-align:center }
.header h1 { font-size:38px; font-weight:900; color:#fff; letter-spacing:-0.5px; text-shadow:0 2px 10px rgba(0,0,0,0.5) }
.header p { color:rgba(255,255,255,0.7); font-size:14px; margin-top:4px; font-weight:600 }
.badge-row { display:flex; justify-content:center; gap:12px; margin-top:16px; flex-wrap:wrap }
.badge { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#fff; padding:6px 16px; border-radius:20px; font-size:12px; font-weight:700; display:flex; align-items:center; gap:6px }
.content { padding:24px }
.network-section { margin-bottom:24px }
.network-title { display:flex; align-items:center; gap:10px; margin-bottom:12px }
.network-dot { width:14px; height:14px; border-radius:50% }
.network-name { font-size:20px; font-weight:700; color:#fff }
.packages-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:8px }
.pkg-card { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:12px; text-align:center }
.pkg-size { font-size:16px; font-weight:700; color:#fff }
.pkg-price { font-size:18px; font-weight:900; color:${design.accentColor || '#EAB308'}; margin-top:4px }
.pkg-validity { font-size:10px; color:#888; margin-top:2px }
.pkg-popular { background:${design.primaryColor || '#EAB308'}; color:#000; font-size:9px; font-weight:700; padding:2px 8px; border-radius:10px; display:inline-block; margin-top:4px }
.footer { background:rgba(0,0,0,0.3); padding:24px; text-align:center; border-top:1px solid rgba(255,255,255,0.06) }
.cta-btn { display:inline-block; background:${design.primaryColor || '#EAB308'}; color:#000; padding:14px 40px; border-radius:30px; font-weight:700; font-size:16px; text-decoration:none; box-shadow:0 4px 20px rgba(0,0,0,0.3) }
.contact-text { color:#aaa; font-size:13px; margin-top:12px }
.powered { color:#555; font-size:11px; margin-top:16px }
</style>
</head>
<body>
<div class="flyer">
  <div class="header">
    <h1>${storeName}</h1>
    <p>${design.tagline || 'Your Trusted Data Plug 🇬🇭'}</p>
    <div class="badge-row">
      <span class="badge">⚡ ${design.customGreetingText || 'Instant Delivery'}</span>
      <span class="badge">💰 Best Prices</span>
      <span class="badge">🔒 Secure</span>
    </div>
  </div>
  <div class="content">
    ${networks.map((net: { name: string; color: string }) => {
      // Networks/packages are also client-supplied request-body data, not
      // just the flyer owner's own store settings — escape before interpolating.
      const netPkgs = packages[net.name];
      if (!netPkgs || !Array.isArray(netPkgs) || netPkgs.length === 0) return '';
      return `<div class="network-section">
        <div class="network-title">
          <div class="network-dot" style="background:${escapeHtml(net.color)}"></div>
          <span class="network-name">${escapeHtml(net.name)}</span>
        </div>
        <div class="packages-grid">
          ${netPkgs.map((pkg: { size: string; price: number; validity?: string; popular?: boolean }) => `
            <div class="pkg-card">
              <div class="pkg-size">${escapeHtml(pkg.size)}</div>
              <div class="pkg-price">GH₵${Number(pkg.price || 0).toFixed(2)}</div>
              <div class="pkg-validity">${escapeHtml(pkg.validity || 'Non-expiry')}</div>
              ${pkg.popular ? `<div class="pkg-popular" style="background:${design.primaryColor}; color:${design.primaryColor === '#ffffff' ? '#000000' : '#ffffff'}">🔥 HOT</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>
  <div class="footer">
    <a href="${storeUrl}" class="cta-btn" style="background:${design.primaryColor}; color:${design.primaryColor === '#ffffff' ? '#000000' : '#ffffff'}">🛒 Order Now</a>
    ${contact ? `<p class="contact-text">${contact}</p>` : ''}
    <p class="powered">Powered by DataHive Ghana</p>
  </div>
</div>
</body>
</html>`;
}
