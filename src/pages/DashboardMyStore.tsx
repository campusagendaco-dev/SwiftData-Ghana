import { useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
// Fallback component if QRCodeSVG fails to load in some environments
const SafeQRCodeSVG = (props: any) => {
  try {
    return <QRCodeSVG {...props} />;
  } catch (e) {
    console.error("QRCodeSVG render error:", e);
    return <div className="w-[180px] h-[180px] bg-secondary flex items-center justify-center text-[10px] text-muted-foreground text-center p-4">QR Code unavailable</div>;
  }
};

import { Store, ExternalLink, Copy, Download, Settings, QrCode, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const DashboardMyStore = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qrRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  const storeUrl = profile?.slug ? `${window.location.origin}/store/${profile.slug}` : null;

  const copyLink = () => {
    if (!storeUrl) return;
    navigator.clipboard.writeText(storeUrl);
    setCopied(true);
    toast({ title: "Link copied!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadQR = () => {
    if (!qrRef.current) return;
    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;

    const canvas = document.createElement("canvas");
    const size = 400;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);

    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 20, 20, size - 40, size - 40);
      const a = document.createElement("a");
      a.download = `${profile?.slug || "store"}-qr.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  };

  if (!isPaidAgent) {
    return (
      <div className="p-6 md:p-8 max-w-xl space-y-6">
        <h1 className="font-black text-3xl tracking-tight">My Store</h1>
        <div className="rounded-3xl border border-border bg-card/60 p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8 text-primary" />
          </div>
          <h2 className="font-black text-xl">Unlock Your Store</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Pay GHS 80 once to become a reseller and get your own branded store, cheaper prices, and more.
          </p>
          <Button asChild className="rounded-2xl">
            <Link to="/agent-program">Become a Reseller (GHS 80)</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="font-black text-3xl tracking-tight mb-1">My Store</h1>
        <p className="text-muted-foreground text-sm">Share your store link or QR code with customers.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Store link card */}
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Store className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-black text-base">Store Link</h2>
              <p className="text-xs text-muted-foreground">Share this link with customers</p>
            </div>
          </div>

          {storeUrl ? (
            <>
              <div className="rounded-2xl bg-secondary/60 border border-border px-4 py-3">
                <p className="text-xs text-muted-foreground mb-1">Your live store URL</p>
                <p className="text-sm font-medium break-all text-foreground">{storeUrl}</p>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={copyLink}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-all",
                    copied
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-secondary border-border text-foreground hover:bg-secondary/80",
                  )}
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied!" : "Copy Link"}
                </button>
                <Button asChild variant="outline" className="rounded-xl gap-2">
                  <a href={storeUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="w-4 h-4" />
                    Open Store
                  </a>
                </Button>
                <Button asChild variant="outline" className="rounded-xl gap-2">
                  <Link to="/dashboard/store-settings">
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-amber-400/8 border border-amber-400/20 p-4 text-sm text-amber-600 dark:text-amber-400">
              Set your store name in Store Settings to generate your custom URL.
            </div>
          )}

          {/* Store name badge */}
          {profile?.store_name && (
            <div className="flex items-center gap-2 pt-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-emerald-500">
                {profile.store_name} · Live
              </span>
            </div>
          )}
        </div>

        {/* QR Code card */}
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <QrCode className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-black text-base">QR Code</h2>
              <p className="text-xs text-muted-foreground">Print or share — customers scan to buy</p>
            </div>
          </div>

          {storeUrl ? (
            <>
              {/* QR code display */}
              <div
                ref={qrRef}
                className="flex items-center justify-center p-5 rounded-2xl bg-white mx-auto"
                style={{ width: "fit-content" }}
              >
                <SafeQRCodeSVG
                  value={storeUrl}
                  size={180}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              </div>

              <button
                onClick={downloadQR}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black text-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                <Download className="w-4 h-4" />
                Download QR Code (PNG)
              </button>

              <p className="text-xs text-muted-foreground text-center">
                Print on flyers, receipts, or WhatsApp to let customers scan and buy instantly.
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
              <QrCode className="w-12 h-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">Set your store slug to generate a QR code.</p>
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link to="/dashboard/store-settings">Go to Store Settings</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardMyStore;
