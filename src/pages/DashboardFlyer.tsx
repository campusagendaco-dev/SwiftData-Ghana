import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { basePackages, networks } from "@/lib/data";
import { escapeHtml } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, Sparkles, Loader2, Eye, MessageCircle, RefreshCw, Check, QrCode, Copy } from "lucide-react";
import html2canvas from "html2canvas";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";

interface AgentPrices { [network: string]: { [size: string]: string } }
interface DisabledPackages { [network: string]: string[] }
type Template = "black-gold" | "royal-blue" | "ghana-pride" | "ai-generated";

interface FlyerInfo {
  storeName: string;
  storeUrl: string;
  contact: string;
  packages: Record<string, { size: string; price: number; validity?: string; popular?: boolean }[]>;
}

const TEMPLATES: { id: Template; name: string; desc: string; bg: string; accent: string; text: string }[] = [
  { id: "black-gold",  name: "Black Gold",   desc: "Premium luxury",      bg: "#080808",  accent: "#EAB308", text: "#ffffff" },
  { id: "royal-blue",  name: "Royal Blue",   desc: "Corporate clean",     bg: "#06122b",  accent: "#60A5FA", text: "#ffffff" },
  { id: "ghana-pride", name: "Ghana Pride",  desc: "Bold & vibrant",      bg: "#0d1a0e",  accent: "#FCD116", text: "#ffffff" },
  { id: "ai-generated", name: "AI Designer", desc: "AI custom theme",     bg: "linear-gradient(135deg, #a855f7 0%, #6366f1 100%)", accent: "#f43f5e", text: "#ffffff" },
];

// ─── Template builders ────────────────────────────────────────────────────────

function packagesSection(pkgs: FlyerInfo["packages"], cardStyle: string, priceColor: string, headerColor: string): string {
  return networks
    .filter(net => pkgs[net.name]?.length)
    .map(net => {
      const list = pkgs[net.name];
      return `
      <div style="margin-bottom:28px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="width:28px;height:28px;border-radius:7px;background:${net.color};display:flex;align-items:center;justify-content:center">
            <div style="width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.9)"></div>
          </div>
          <span style="font-size:17px;font-weight:800;color:${headerColor};font-family:Montserrat,sans-serif;letter-spacing:-0.3px">${net.name}</span>
          <span style="color:rgba(255,255,255,0.28);font-size:11px;font-weight:500">${list.length} packages</span>
          <div style="flex:1;height:1px;background:rgba(255,255,255,0.07)"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:8px">
          ${list.map(pkg => `
            <div style="position:relative;${cardStyle};border-radius:10px;padding:13px 8px;text-align:center">
              ${pkg.popular ? `<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:${priceColor};color:#000;font-size:8px;font-weight:900;padding:2px 9px;border-radius:10px;white-space:nowrap;font-family:Montserrat,sans-serif">🔥 HOT</div>` : ""}
              <div style="font-size:14px;font-weight:800;color:#fff;font-family:Montserrat,sans-serif">${pkg.size}</div>
              <div style="font-size:20px;font-weight:900;color:${priceColor};margin:5px 0 3px;line-height:1;font-family:Montserrat,sans-serif">GH₵${pkg.price.toFixed(2)}</div>
              <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.5px;font-family:Inter,sans-serif">${pkg.validity || "No-Expiry"}</div>
            </div>
          `).join("")}
        </div>
      </div>`;
    }).join("");
}

function qrSection(qrDataUrl: string, accentColor: string, storeUrl: string): string {
  if (!qrDataUrl) return "";
  return `
  <div style="display:flex;align-items:center;gap:14px;margin-top:16px;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07)">
    <img src="${qrDataUrl}" width="64" height="64" style="border-radius:8px;flex-shrink:0;display:block" alt="" />
    <div>
      <div style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px;font-family:Inter,sans-serif">📱 Scan to order instantly</div>
      <div style="font-size:13px;font-weight:800;color:${accentColor};font-family:Montserrat,sans-serif">${storeUrl}</div>
      <div style="font-size:9px;color:rgba(255,255,255,0.2);margin-top:3px;font-family:Inter,sans-serif">Point your camera · No app needed</div>
    </div>
  </div>`;
}

function buildBlackGold(info: FlyerInfo, qrDataUrl = ""): string {
  const { storeName, storeUrl, contact, packages } = info;
  const nets = packagesSection(
    packages,
    "background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.08)",
    "#EAB308",
    "#ffffff"
  );
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;justify-content:center;padding:0}</style>
</head><body>
<div style="width:800px;background:#080808;font-family:Montserrat,sans-serif;position:relative;overflow:hidden">

  <!-- top accent bar -->
  <div style="height:3px;background:linear-gradient(90deg,transparent 0%,#EAB308 30%,#CA8A04 70%,transparent 100%)"></div>

  <!-- decorative glow -->
  <div style="position:absolute;top:-80px;right:-80px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(234,179,8,0.1) 0%,transparent 65%);pointer-events:none"></div>
  <div style="position:absolute;bottom:80px;left:-100px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(234,179,8,0.06) 0%,transparent 65%);pointer-events:none"></div>

  <!-- header -->
  <div style="padding:44px 44px 36px;position:relative">
    <div style="display:inline-flex;align-items:center;gap:7px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.22);padding:5px 14px;border-radius:30px;margin-bottom:14px">
      <span style="width:6px;height:6px;border-radius:50%;background:#EAB308;display:inline-block"></span>
      <span style="color:#EAB308;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Official Data Reseller · Ghana</span>
    </div>
    <div style="font-size:50px;font-weight:900;color:#fff;line-height:1.0;letter-spacing:-1.5px">${storeName}</div>
    <div style="color:rgba(255,255,255,0.4);font-size:13px;font-weight:500;margin-top:10px;letter-spacing:0.3px">Your trusted data plug 🇬🇭 · Fast · Affordable · Reliable</div>
    <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
      ${["⚡ Instant Delivery","💰 Lowest Prices","🔒 100% Secure","📲 All Networks"].map(b =>
        `<span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);padding:6px 13px;border-radius:7px;color:rgba(255,255,255,0.6);font-size:11px;font-weight:600;font-family:Inter,sans-serif">${b}</span>`
      ).join("")}
    </div>
  </div>

  <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(234,179,8,0.18),transparent);margin:0 44px"></div>

  <!-- packages -->
  <div style="padding:28px 44px">${nets}</div>

  <!-- footer -->
  <div style="background:rgba(0,0,0,0.55);border-top:1px solid rgba(255,255,255,0.05);padding:26px 44px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <a href="https://${storeUrl}" style="display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#EAB308 0%,#CA8A04 100%);color:#000;padding:13px 30px;border-radius:50px;font-weight:900;font-size:14px;text-decoration:none;font-family:Montserrat,sans-serif;letter-spacing:0.3px;box-shadow:0 4px 24px rgba(234,179,8,0.3)">
        🛒 Order Now
      </a>
      <div style="text-align:right">
        ${contact ? `<div style="color:rgba(255,255,255,0.3);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;font-family:Inter,sans-serif">WhatsApp / Call</div>
        <div style="color:#fff;font-size:18px;font-weight:800;margin-top:2px">${contact}</div>` : ""}
        <div style="color:rgba(234,179,8,0.55);font-size:10px;margin-top:4px;font-family:Inter,sans-serif">${storeUrl}</div>
      </div>
    </div>
    ${qrSection(qrDataUrl, "#EAB308", storeUrl)}
    <div style="text-align:center;color:rgba(255,255,255,0.13);font-size:9px;margin-top:18px;letter-spacing:2px;text-transform:uppercase;font-family:Inter,sans-serif">Powered by SwiftData Ghana</div>
  </div>
</div>
</body></html>`;
}

function buildRoyalBlue(info: FlyerInfo, qrDataUrl = ""): string {
  const { storeName, storeUrl, contact, packages } = info;
  const nets = packagesSection(
    packages,
    "background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2)",
    "#60A5FA",
    "#ffffff"
  );
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#06122b;display:flex;justify-content:center;padding:0}</style>
</head><body>
<div style="width:800px;background:#06122b;font-family:Montserrat,sans-serif;position:relative;overflow:hidden">

  <!-- header gradient band -->
  <div style="background:linear-gradient(135deg,#1E3A8A 0%,#1D4ED8 50%,#2563EB 100%);padding:44px 44px 36px;position:relative;overflow:hidden">
    <div style="position:absolute;top:-60px;right:-60px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,0.05)"></div>
    <div style="position:absolute;bottom:-40px;left:30%;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.04)"></div>
    <div style="display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);padding:5px 14px;border-radius:30px;margin-bottom:14px">
      <span style="width:6px;height:6px;border-radius:50%;background:#fff;display:inline-block"></span>
      <span style="color:#fff;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Official Data Reseller · Ghana</span>
    </div>
    <div style="font-size:50px;font-weight:900;color:#fff;line-height:1.0;letter-spacing:-1.5px;text-shadow:0 2px 20px rgba(0,0,0,0.3)">${storeName}</div>
    <div style="color:rgba(255,255,255,0.65);font-size:13px;font-weight:500;margin-top:10px">Your trusted data plug 🇬🇭 · Fast · Affordable · Reliable</div>
    <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
      ${["⚡ Instant Delivery","💰 Lowest Prices","🔒 100% Secure","📲 All Networks"].map(b =>
        `<span style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);padding:6px 13px;border-radius:7px;color:rgba(255,255,255,0.85);font-size:11px;font-weight:600;font-family:Inter,sans-serif">${b}</span>`
      ).join("")}
    </div>
  </div>

  <!-- packages -->
  <div style="padding:32px 44px">${nets}</div>

  <!-- footer -->
  <div style="background:rgba(0,0,0,0.4);border-top:1px solid rgba(59,130,246,0.15);padding:26px 44px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <a href="https://${storeUrl}" style="display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#3B82F6 0%,#1D4ED8 100%);color:#fff;padding:13px 30px;border-radius:50px;font-weight:900;font-size:14px;text-decoration:none;font-family:Montserrat,sans-serif;box-shadow:0 4px 24px rgba(59,130,246,0.35)">
        🛒 Order Now
      </a>
      <div style="text-align:right">
        ${contact ? `<div style="color:rgba(255,255,255,0.3);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;font-family:Inter,sans-serif">WhatsApp / Call</div>
        <div style="color:#fff;font-size:18px;font-weight:800;margin-top:2px">${contact}</div>` : ""}
        <div style="color:rgba(96,165,250,0.65);font-size:10px;margin-top:4px;font-family:Inter,sans-serif">${storeUrl}</div>
      </div>
    </div>
    ${qrSection(qrDataUrl, "#60A5FA", storeUrl)}
    <div style="text-align:center;color:rgba(255,255,255,0.13);font-size:9px;margin-top:18px;letter-spacing:2px;text-transform:uppercase;font-family:Inter,sans-serif">Powered by SwiftData Ghana</div>
  </div>
</div>
</body></html>`;
}

function buildGhanaPride(info: FlyerInfo, qrDataUrl = ""): string {
  const { storeName, storeUrl, contact, packages } = info;
  const nets = packagesSection(
    packages,
    "background:rgba(252,209,22,0.07);border:1px solid rgba(252,209,22,0.2)",
    "#FCD116",
    "#ffffff"
  );
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1a0e;display:flex;justify-content:center;padding:0}</style>
</head><body>
<div style="width:800px;background:#0d1a0e;font-family:Montserrat,sans-serif;position:relative;overflow:hidden">

  <!-- Ghana flag stripe at top -->
  <div style="display:flex;height:4px">
    <div style="flex:1;background:#CE1126"></div>
    <div style="flex:1;background:#FCD116"></div>
    <div style="flex:1;background:#006B3F"></div>
  </div>

  <!-- decorative shapes -->
  <div style="position:absolute;top:-40px;right:40px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(252,209,22,0.12) 0%,transparent 65%);pointer-events:none"></div>

  <!-- header -->
  <div style="padding:44px 44px 36px;position:relative">
    <div style="display:flex;gap:6px;margin-bottom:16px">
      <span style="background:#CE1126;color:#fff;font-size:9px;font-weight:800;padding:4px 10px;border-radius:5px;letter-spacing:1px;text-transform:uppercase">Data</span>
      <span style="background:#FCD116;color:#000;font-size:9px;font-weight:800;padding:4px 10px;border-radius:5px;letter-spacing:1px;text-transform:uppercase">Reseller</span>
      <span style="background:#006B3F;color:#fff;font-size:9px;font-weight:800;padding:4px 10px;border-radius:5px;letter-spacing:1px;text-transform:uppercase">Ghana 🇬🇭</span>
    </div>
    <div style="font-size:50px;font-weight:900;color:#fff;line-height:1.0;letter-spacing:-1.5px">${storeName}</div>
    <div style="color:rgba(255,255,255,0.4);font-size:13px;font-weight:500;margin-top:10px">Your trusted data plug · Fast · Affordable · Reliable</div>
    <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
      ${["⚡ Instant Delivery","💰 Lowest Prices","🔒 100% Secure","📲 All Networks"].map(b =>
        `<span style="background:rgba(252,209,22,0.08);border:1px solid rgba(252,209,22,0.18);padding:6px 13px;border-radius:7px;color:rgba(255,255,255,0.65);font-size:11px;font-weight:600;font-family:Inter,sans-serif">${b}</span>`
      ).join("")}
    </div>
  </div>

  <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(252,209,22,0.18),transparent);margin:0 44px"></div>

  <!-- packages -->
  <div style="padding:28px 44px">${nets}</div>

  <!-- footer -->
  <div style="border-top:1px solid rgba(255,255,255,0.05);padding:26px 44px">
    <div style="display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <a href="https://${storeUrl}" style="display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#FCD116 0%,#CA8A04 100%);color:#000;padding:13px 30px;border-radius:50px;font-weight:900;font-size:14px;text-decoration:none;font-family:Montserrat,sans-serif;box-shadow:0 4px 24px rgba(252,209,22,0.3)">
        🛒 Order Now
      </a>
      <div style="text-align:right">
        ${contact ? `<div style="color:rgba(255,255,255,0.3);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;font-family:Inter,sans-serif">WhatsApp / Call</div>
        <div style="color:#fff;font-size:18px;font-weight:800;margin-top:2px">${contact}</div>` : ""}
        <div style="color:rgba(252,209,22,0.55);font-size:10px;margin-top:4px;font-family:Inter,sans-serif">${storeUrl}</div>
      </div>
    </div>
    ${qrSection(qrDataUrl, "#FCD116", storeUrl)}
    <div style="display:flex;height:3px;margin-top:18px;border-radius:2px;overflow:hidden">
      <div style="flex:1;background:#CE1126"></div>
      <div style="flex:1;background:#FCD116"></div>
      <div style="flex:1;background:#006B3F"></div>
    </div>
    <div style="text-align:center;color:rgba(255,255,255,0.13);font-size:9px;margin-top:10px;letter-spacing:2px;text-transform:uppercase;font-family:Inter,sans-serif">Powered by SwiftData Ghana</div>
  </div>
</div>
</body></html>`;
}

function buildFlyerHtml(template: Template, info: FlyerInfo, qrDataUrl = ""): string {
  if (template === "royal-blue") return buildRoyalBlue(info, qrDataUrl);
  if (template === "ghana-pride") return buildGhanaPride(info, qrDataUrl);
  return buildBlackGold(info, qrDataUrl);
}

// ─── Component ────────────────────────────────────────────────────────────────

const FLYER_W = 800;

const DashboardFlyer = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [template, setTemplate] = useState<Template>("black-gold");
  const [aiPrompt, setAiPrompt] = useState("");
  const [caption, setCaption] = useState("");
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [flyerHtml, setFlyerHtml] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharingStatus, setSharingStatus] = useState(false);
  const [copied, setCopied] = useState(false);
  const [includeQr, setIncludeQr] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [agentPrices, setAgentPrices] = useState<AgentPrices>({});
  const [disabledPackages, setDisabledPackages] = useState<DisabledPackages>({});
  const hiddenRef = useRef<HTMLDivElement>(null);
  const qrContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (profile) {
      setAgentPrices((profile.agent_prices as AgentPrices) || {});
      setDisabledPackages((profile.disabled_packages as DisabledPackages) || {});
    }
  }, [profile]);

  // Capture QR canvas data URL after QRCodeCanvas renders
  useEffect(() => {
    if (!profile?.slug || !includeQr) {
      setQrDataUrl("");
      return;
    }
    const timer = setTimeout(() => {
      const canvas = qrContainerRef.current?.querySelector("canvas");
      if (canvas) setQrDataUrl(canvas.toDataURL("image/png"));
    }, 400);
    return () => clearTimeout(timer);
  }, [profile?.slug, includeQr]);

  const getAgentPrice = (network: string, size: string): number => {
    const price = agentPrices[network]?.[size];
    if (price && !isNaN(Number(price))) return Number(price);
    return basePackages[network]?.find(p => p.size === size)?.price ?? 0;
  };

  const isEnabled = (network: string, size: string) =>
    !disabledPackages[network]?.includes(size);

  const totalPackages = networks.reduce((sum, net) =>
    sum + (basePackages[net.name]?.filter(p => isEnabled(net.name, p.size)).length ?? 0), 0);

  const buildInfo = (): FlyerInfo => {
    const packages: FlyerInfo["packages"] = {};
    for (const net of networks) {
      const enabled = (basePackages[net.name] || [])
        .filter(p => isEnabled(net.name, p.size))
        .map(p => ({ size: p.size, price: getAgentPrice(net.name, p.size), validity: p.validity, popular: p.popular }));
      if (enabled.length) packages[net.name] = enabled;
    }
    return {
      // Escaped here, once, since these flow unescaped into raw HTML strings
      // (innerHTML/document.write) below — not through JSX's auto-escaping.
      storeName: escapeHtml(profile?.store_name || "My Store"),
      storeUrl: escapeHtml(profile?.slug ? `swiftdatagh.shop/store/${profile.slug}` : "swiftdatagh.shop"),
      contact: escapeHtml(profile?.momo_number || ""),
      packages,
    };
  };

  const generateFlyer = async () => {
    if (!profile?.store_name) {
      toast({ title: "Store name required", description: "Set up your store name in Settings first.", variant: "destructive" });
      return;
    }
    setGenerating(true);

    if (template === "ai-generated") {
      try {
        const { data, error } = await supabase.functions.invoke("generate-flyer", {
          body: {
            storeName: profile.store_name,
            storeUrl: profile.slug ? `swiftdatagh.shop/store/${profile.slug}` : "swiftdatagh.shop",
            packages: buildInfo().packages,
            networks,
            contact: profile.momo_number || "",
            prompt: aiPrompt
          }
        });
        if (error || !data?.html) throw new Error(error?.message || "Failed to generate AI flyer");
        setFlyerHtml(data.html);
        if (data.caption) setCaption(data.caption);
        toast({ title: "AI Flyer Generated!", description: "Dynamic styles successfully compiled." });
      } catch (err: any) {
        toast({ title: "AI Design failed", description: err.message, variant: "destructive" });
      } finally {
        setGenerating(false);
      }
      return;
    }

    setTimeout(() => {
      try {
        const html = buildFlyerHtml(template, buildInfo(), includeQr ? qrDataUrl : "");
        setFlyerHtml(html);
        toast({ title: "Flyer ready!", description: "Your flyer is ready to download or share." });
      } catch {
        toast({ title: "Generation failed", variant: "destructive" });
      } finally {
        setGenerating(false);
      }
    }, 400);
  };

  const captureFlyerBlob = useCallback(async (): Promise<Blob | null> => {
    if (!flyerHtml || !hiddenRef.current) return null;
    hiddenRef.current.innerHTML = flyerHtml;
    const el = hiddenRef.current.firstElementChild as HTMLElement;
    if (!el) return null;
    const canvas = await html2canvas(el, {
      width: FLYER_W, scale: 2.5, useCORS: true, allowTaint: true,
      backgroundColor: null, logging: false,
    });
    hiddenRef.current.innerHTML = "";
    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png", 0.97)
    );
  }, [flyerHtml]);

  const downloadFlyer = async () => {
    setDownloading(true);
    try {
      const blob = await captureFlyerBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), {
        href: url,
        download: `${profile?.store_name || "flyer"}-${template}.png`,
      }).click();
      URL.revokeObjectURL(url);
      toast({ title: "Saved!", description: "Flyer saved as PNG." });
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const shareToStatus = async () => {
    setSharingStatus(true);
    try {
      const blob = await captureFlyerBlob();
      if (!blob) return;
      const file = new File([blob], `${profile?.store_name || "flyer"}.png`, { type: "image/png" });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${profile?.store_name} — Data Bundles`,
          text: `🛒 Order data from ${profile?.store_name}!\n\nhttps://swiftdatagh.shop/store/${profile?.slug}`,

        });
      } else {
        // Fallback: download then open WhatsApp
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement("a"), {
          href: url,
          download: `${profile?.store_name || "flyer"}.png`,
        }).click();
        URL.revokeObjectURL(url);
        const caption = encodeURIComponent(
          `🛒 Order affordable data from ${profile?.store_name}!\n\n` +
          `⚡ Instant delivery · All networks · Best prices 🇬🇭\n\n` +
          `👇 Shop now:\nhttps://swiftdatagh.shop/store/${profile?.slug}`

        );
        setTimeout(() => window.open(`https://wa.me/?text=${caption}`, "_blank"), 600);
        toast({
          title: "Flyer downloaded!",
          description: "Open WhatsApp → Status → upload this image.",
        });
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast({ title: "Share failed", variant: "destructive" });
      }
    } finally {
      setSharingStatus(false);
    }
  };

  const shareWhatsApp = () => {
    if (!profile?.slug) { toast({ title: "Store URL not set" }); return; }
    const text = encodeURIComponent(`🛒 Order affordable data from ${profile.store_name}!\n\nVisit: https://swiftdatagh.shop/store/${profile.slug}\n\n⚡ Instant delivery · All networks · Best prices`);

    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const copyLink = async () => {
    if (!profile?.slug) return;
    await navigator.clipboard.writeText(`https://swiftdatagh.shop/store/${profile.slug}`);

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Link copied!" });
  };

  const openFull = () => {
    if (!flyerHtml) return;
    const w = window.open("", "_blank");
    if (w) { w.document.write(flyerHtml); w.document.close(); }
  };

  return (
    <div className="min-h-screen pb-20 px-4 md:px-8 pt-6 max-w-5xl mx-auto space-y-8">

      {/* Hidden QR canvas for data URL capture */}
      <div
        ref={qrContainerRef}
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{ left: -9999, top: -9999, width: 120, height: 120 }}
      >
        {profile?.slug && includeQr && (
          <QRCodeCanvas
            value={`https://swiftdatagh.shop/store/${profile.slug}`}

            size={120}
            bgColor="#000000"
            fgColor="#ffffff"
            level="M"
          />
        )}
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-amber-400/10 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight text-foreground">Flyer Generator</h1>
          <p className="text-sm text-muted-foreground">Create pro marketing flyers for your store</p>
        </div>
      </div>

      {/* Template selector */}
      <div>
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/70 mb-3">Choose Template</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTemplate(t.id as Template); setFlyerHtml(null); setCaption(""); }}
              className={`relative rounded-2xl p-4 text-left transition-all border ${
                template === t.id
                  ? "border-amber-500/50 bg-amber-500/10 dark:bg-amber-400/5"
                  : "border-border bg-card hover:border-border/80 shadow-sm"
              }`}
            >
              {/* mini color preview */}
              <div className="flex gap-1 mb-3">
                <div className="h-8 flex-1 rounded-lg shadow-inner" style={{ background: t.bg }} />
                <div className="h-8 w-8 rounded-lg shadow-sm" style={{ background: t.accent }} />
              </div>
              <p className="text-sm font-black text-foreground">{t.name}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</p>
              {template === t.id && (
                <div className="absolute top-2.5 right-2.5 w-5 h-5 bg-amber-500 dark:bg-amber-400 rounded-full flex items-center justify-center shadow-sm">
                  <Check className="w-3 h-3 text-black" strokeWidth={3} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {template === "ai-generated" && (
        <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-3 animate-in slide-in-from-top-2 duration-300">
          <p className="text-[10px] font-black uppercase tracking-widest text-purple-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> AI Design Co-Pilot Prompt
          </p>
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="e.g., Cyberpunk neon pink layout with a tagline: Speed is everything"
            className="w-full h-11 rounded-2xl px-4 text-sm font-medium border border-purple-500/30 focus:border-purple-500 outline-none bg-card text-foreground placeholder:text-muted-foreground/30"
          />
        </div>
      )}

      {/* Store summary + QR toggle */}
      <div className="rounded-2xl bg-card border border-border shadow-sm p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {[
            { label: "Store Name", value: profile?.store_name || "Not set", highlight: !!profile?.store_name },
            { label: "Contact", value: profile?.momo_number || "Not set", highlight: !!profile?.momo_number },
            { label: "Store URL", value: profile?.slug ? `…/${profile.slug}` : "Not set", highlight: !!profile?.slug },
            { label: "Packages", value: `${totalPackages} active`, highlight: totalPackages > 0 },
          ].map(({ label, value, highlight }) => (
            <div key={label}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
              <p className={`font-bold text-sm truncate ${highlight ? "text-foreground" : "text-muted-foreground/50"}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* QR code toggle */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex items-center gap-2.5">
            <QrCode className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-bold text-foreground/80">Include QR Code</p>
              <p className="text-[11px] text-muted-foreground/70">Embed scan-to-order QR in flyer footer</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={includeQr ? "Disable QR code in flyer" : "Enable QR code in flyer"}
            onClick={() => { setIncludeQr(v => !v); setFlyerHtml(null); }}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${includeQr ? "bg-amber-500 dark:bg-amber-400" : "bg-muted"}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${includeQr ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
      </div>

      {/* Generate button */}
      <Button
        onClick={flyerHtml ? () => { setFlyerHtml(null); setTimeout(generateFlyer, 50); } : generateFlyer}
        disabled={generating || !profile?.store_name}
        className="w-full h-12 text-base font-black rounded-2xl bg-amber-400 hover:bg-amber-300 text-black gap-2"
      >
        {generating
          ? <><Loader2 className="w-5 h-5 animate-spin" /> Generating…</>
          : flyerHtml
          ? <><RefreshCw className="w-5 h-5" /> Regenerate Flyer</>
          : <><Sparkles className="w-5 h-5" /> Generate Flyer</>
        }
      </Button>

      {/* Flyer preview */}
      {flyerHtml && (
        <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Preview</p>

          {/* Scaled preview — 800×1200 flyer at 54% = 432×648px visible */}
          <div className="mx-auto rounded-2xl overflow-hidden border border-border shadow-2xl bg-background" style={{ width: 432, height: 648 }}>
            <div style={{ width: 800, transformOrigin: "top left", transform: "scale(0.54)" }}>
              <iframe
                srcDoc={flyerHtml}
                title="Flyer preview"
                style={{ width: 800, height: 1200, border: "none", display: "block" }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Button
              onClick={downloadFlyer}
              disabled={downloading || sharingStatus}
              className="h-11 gap-2 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl shadow-lg shadow-amber-500/20"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {downloading ? "Saving…" : "Download PNG"}
            </Button>
            <Button
              onClick={shareToStatus}
              disabled={downloading || sharingStatus}
              className="h-11 gap-2 bg-green-600 hover:bg-green-700 text-white font-black rounded-xl shadow-lg shadow-green-600/20"
            >
              {sharingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              {sharingStatus ? "Sharing…" : "WhatsApp Status"}
            </Button>
            <Button
              onClick={shareWhatsApp}
              variant="outline"
              className="h-11 gap-2 border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400 hover:bg-green-500/10 rounded-xl font-bold"
            >
              <MessageCircle className="w-4 h-4" />
              Share Link
            </Button>
            <Button
              onClick={copyLink}
              variant="outline"
              className="h-11 gap-2 border-border text-foreground/70 hover:text-foreground rounded-xl font-bold"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Eye className="w-4 h-4" />}
              {copied ? "Copied!" : "Full Size"}
            </Button>
          </div>

          {/* AI Generated Caption */}
          {caption && (
            <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-purple-400 flex items-center gap-1.5">
                  📝 AI Copywriting Caption
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(caption);
                    setCopiedCaption(true);
                    setTimeout(() => setCopiedCaption(false), 2000);
                  }}
                  className="h-7 text-[10px] font-black text-purple-400 hover:bg-purple-500/10 gap-1"
                >
                  {copiedCaption ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedCaption ? "Copied!" : "Copy Caption"}
                </Button>
              </div>
              <pre className="text-xs text-foreground/80 font-medium font-sans whitespace-pre-wrap leading-relaxed select-all">
                {caption}
              </pre>
            </div>
          )}

          {/* Secondary actions row */}
          <div className="flex gap-3">
            <Button
              onClick={openFull}
              variant="outline"
              className="h-9 gap-2 border-border text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl font-bold text-xs flex-1"
            >
              <Eye className="w-3.5 h-3.5" />
              Open Full Size
            </Button>
          </div>
        </div>
      )}

      {/* Hidden render target for html2canvas */}
      <div
        ref={hiddenRef}
        className="absolute pointer-events-none"
        style={{ left: -9999, top: -9999, width: FLYER_W }}
        aria-hidden="true"
      />
    </div>
  );
};

export default DashboardFlyer;
