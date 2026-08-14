import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const { storeName, storeUrl, packages, networks, contact, prompt } = payload;

    if (!storeName) {
      return new Response(JSON.stringify({ error: "Store name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allSizes = new Set<string>();
    Object.values(packages || {}).forEach((pkgs: unknown) => {
      if (Array.isArray(pkgs)) {
        pkgs.forEach((pkg: { size: string }) => allSizes.add(pkg.size));
      }
    });

    let aiDesign = {
      primaryColor: "#EAB308",
      secondaryColor: "#111111",
      accentColor: "#EAB308",
      backgroundGradient: "linear-gradient(135deg, #111111 0%, #1e1e1e 100%)",
      customGreetingText: "Official Data Reseller",
      tagline: "Your trusted mobile data plug",
      fontFamily: "Poppins",
      caption: `🔥 Promo Alert from ${storeName}! 🔥\nGet the cheapest data bundles instantly. Fast, secure, and no-expiry plans.\n\n📲 Order here: ${storeUrl}\n\n#SwiftData #Ghanareseller #MobileData`
    };

    if (prompt && GEMINI_API_KEY) {
      console.log(`[AI Flyer] Calling Gemini to generate style for prompt: "${prompt}"`);
      try {
        const systemInstruction = `You are a premium graphic designer and marketing copywriter. Given a store name, networks, and a style prompt, generate matching styling properties and social caption. Output a raw JSON object with: primaryColor (hex), secondaryColor (hex), accentColor (hex), backgroundGradient (CSS gradient), customGreetingText (short banner title), tagline (compelling sales tagline), fontFamily (Poppins, Montserrat, Inter, or Space Grotesk), and caption (marketing post copy). Return only the JSON object. No formatting, no backticks, no comments.`;
        const userMsg = `Store: ${storeName}, Prompt: "${prompt}"`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemInstruction}\n\nInput:\n${userMsg}` }] }]
          })
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          const jsonStart = rawText.indexOf("{");
          const jsonEnd = rawText.lastIndexOf("}");
          if (jsonStart !== -1 && jsonEnd !== -1) {
            const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
            aiDesign = { ...aiDesign, ...parsed };
            console.log("[AI Flyer] Gemini styling parsed successfully:", aiDesign);
          }
        } else {
          console.error("[AI Flyer] Gemini API call failed:", await geminiRes.text());
        }
      } catch (err: any) {
        console.error("[AI Flyer] Failed to fetch or parse AI design:", err.message);
      }
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
      networks || [],
      escapeHtml(contact),
      safeAiDesign
    );

    return new Response(JSON.stringify({ html: htmlFlyer, caption: aiDesign.caption, design: aiDesign }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Flyer generation error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate flyer" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
              <div class="pkg-price">GH₵${pkg.price.toFixed(2)}</div>
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
