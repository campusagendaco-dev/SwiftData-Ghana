import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
    const { storeName, storeUrl, packages, networks, contact } = await req.json();

    if (!storeName) {
      return new Response(JSON.stringify({ error: "Store name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allSizes = new Set<string>();
    Object.values(packages).forEach((pkgs: unknown) => {
      if (Array.isArray(pkgs)) {
        pkgs.forEach((pkg: { size: string }) => allSizes.add(pkg.size));
      }
    });
    const sortedSizes = Array.from(allSizes).sort((a, b) => {
      const aNum = parseFloat(a.replace(/[^\d.]/g, ''));
      const bNum = parseFloat(b.replace(/[^\d.]/g, ''));
      return aNum - bNum;
    });

    const htmlFlyer = buildFlyerHtml(storeName, storeUrl, packages, networks, sortedSizes, contact);

    return new Response(JSON.stringify({ html: htmlFlyer }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Flyer generation error:", error);
    return new Response(JSON.stringify({ error: "Failed to generate flyer" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// deno-lint-ignore no-explicit-any
function buildFlyerHtml(storeName: string, storeUrl: string, packages: any, networks: any[], sortedSizes: string[], contact: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Poppins',sans-serif;background:#111;padding:24px;display:flex;justify-content:center;align-items:center;min-height:100vh}
.flyer{width:100%;max-width:900px;background:#1a1a1a;border-radius:24px;overflow:hidden;border:2px solid #EAB308}
.header{background:linear-gradient(135deg,#EAB308 0%,#CA8A04 100%);padding:32px 24px;text-align:center}
.header h1{font-size:36px;font-weight:900;color:#000;letter-spacing:-0.5px}
.header p{color:#000;opacity:0.7;font-size:14px;margin-top:4px;font-weight:600}
.badge-row{display:flex;justify-content:center;gap:12px;margin-top:16px;flex-wrap:wrap}
.badge{background:rgba(0,0,0,0.2);color:#000;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px}
.content{padding:24px}
.network-section{margin-bottom:24px}
.network-title{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.network-dot{width:14px;height:14px;border-radius:50%}
.network-name{font-size:20px;font-weight:700;color:#fff}
.packages-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.pkg-card{background:#222;border:1px solid #333;border-radius:12px;padding:12px;text-align:center;transition:border-color 0.2s}
.pkg-card:hover{border-color:#EAB308}
.pkg-size{font-size:16px;font-weight:700;color:#fff}
.pkg-price{font-size:18px;font-weight:900;color:#EAB308;margin-top:4px}
.pkg-validity{font-size:10px;color:#888;margin-top:2px}
.pkg-popular{background:#EAB308;color:#000;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;display:inline-block;margin-top:4px}
.footer{background:#111;padding:24px;text-align:center;border-top:1px solid #333}
.cta-btn{display:inline-block;background:#EAB308;color:#000;padding:14px 40px;border-radius:30px;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 4px 20px rgba(234,179,8,0.3)}
.contact-text{color:#888;font-size:13px;margin-top:12px}
.powered{color:#555;font-size:11px;margin-top:16px}
</style>
</head>
<body>
<div class="flyer">
  <div class="header">
    <h1>${storeName}</h1>
    <p>Your Trusted Data Plug 🇬🇭</p>
    <div class="badge-row">
      <span class="badge">⚡ Instant Delivery</span>
      <span class="badge">💰 Best Prices</span>
      <span class="badge">🔒 Secure</span>
    </div>
  </div>
  <div class="content">
    ${networks.map((net: { name: string; color: string }) => {
      const netPkgs = packages[net.name];
      if (!netPkgs || !Array.isArray(netPkgs) || netPkgs.length === 0) return '';
      return `<div class="network-section">
        <div class="network-title">
          <div class="network-dot" style="background:${net.color}"></div>
          <span class="network-name">${net.name}</span>
        </div>
        <div class="packages-grid">
          ${netPkgs.map((pkg: { size: string; price: number; validity?: string; popular?: boolean }) => `
            <div class="pkg-card">
              <div class="pkg-size">${pkg.size}</div>
              <div class="pkg-price">GH₵${pkg.price.toFixed(2)}</div>
              <div class="pkg-validity">${pkg.validity || 'Non-expiry'}</div>
              ${pkg.popular ? '<div class="pkg-popular">🔥 HOT</div>' : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>
  <div class="footer">
    <a href="${storeUrl}" class="cta-btn">🛒 Order Now</a>
    ${contact ? `<p class="contact-text">${contact}</p>` : ''}
    <p class="powered">Powered by DataHive Ghana</p>
  </div>
</div>
</body>
</html>`;
}
