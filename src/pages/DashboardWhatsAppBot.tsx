import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Bot, Copy, Check, MessageSquare, QrCode, Share2,
  Smartphone, Download, ExternalLink, Zap, Users,
  TrendingUp, ShieldCheck, Clock, ChevronRight, Sparkles,
  Star, Globe, Lock
} from "lucide-react";

const PLATFORM_WA_NUMBER = "146427142025";

const steps = [
  {
    num: "01",
    icon: Smartphone,
    title: "Customer Scans or Clicks",
    desc: "They scan your QR code or click your personal WhatsApp link shared on social media.",
    color: "from-blue-500 to-indigo-600",
    glow: "shadow-blue-500/20",
    border: "border-blue-500/20",
    bg: "bg-blue-500/5",
  },
  {
    num: "02",
    icon: MessageSquare,
    title: "Bot Greets & Guides",
    desc: "Our intelligent bot opens a chat, shows your store's prices and available bundles instantly.",
    color: "from-green-500 to-emerald-600",
    glow: "shadow-green-500/20",
    border: "border-green-500/20",
    bg: "bg-green-500/5",
  },
  {
    num: "03",
    icon: Zap,
    title: "Order Fulfilled Instantly",
    desc: "Customer pays, data is delivered automatically. You earn — even while you sleep.",
    color: "from-amber-500 to-orange-600",
    glow: "shadow-amber-500/20",
    border: "border-amber-500/20",
    bg: "bg-amber-500/5",
  },
];

const perks = [
  { icon: Clock, label: "24/7 Automation", desc: "Sells while you sleep" },
  { icon: ShieldCheck, label: "Zero Missed Sales", desc: "Always responds instantly" },
  { icon: TrendingUp, label: "Scale Effortlessly", desc: "Handle unlimited orders" },
  { icon: Users, label: "Customer-Friendly", desc: "WhatsApp they already use" },
];

const DashboardWhatsAppBot = () => {
  const { profile } = useAuth();
  const { isDark } = useAppTheme();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const slug = profile?.slug || "";
  const storeName = (profile as any)?.store_name || profile?.full_name || "My Store";

  const waLink = `https://wa.me/${PLATFORM_WA_NUMBER}?text=${encodeURIComponent(`Hi ${slug}`)}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(waLink)}`;
  const shareMessage = `Buy cheap data & airtime from ${storeName}! 📶📱\n\nScan our QR code or click to order via WhatsApp:\n${waLink}`;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied to clipboard!" });
  };

  const isPaidAgent = Boolean(profile?.agent_approved || (profile as any)?.sub_agent_approved);

  if (!isPaidAgent) {
    return (
      <div className="p-6 md:p-10 flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-green-500/30">
            <Lock className="w-9 h-9 text-white" />
          </div>
          <h2 className="text-2xl font-black mb-3">WhatsApp Bot</h2>
          <p className={cn("text-sm leading-relaxed", isDark ? "text-white/50" : "text-gray-500")}>
            Become an approved agent to unlock the WhatsApp Bot and start selling data automatically — 24/7.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-700">

      {/* ── Header ── */}
      <div>
        <h1 className={cn("text-3xl font-black tracking-tight flex items-center gap-3", isDark ? "text-white" : "text-gray-900")}>
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shrink-0 shadow-lg shadow-green-500/30">
            <Bot className="w-5 h-5 text-white" />
          </div>
          WhatsApp Bot
        </h1>
        <p className={cn("text-sm mt-1.5 ml-[52px]", isDark ? "text-white/35" : "text-gray-500")}>
          Your fully automated store — selling data & airtime around the clock.
        </p>
      </div>

      {/* ── Hero: QR Code + CTA ── */}
      <div className="rounded-[2.5rem] bg-gradient-to-br from-green-600 via-emerald-600 to-teal-700 p-8 md:p-12 relative overflow-hidden shadow-2xl shadow-green-600/25">
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/10 rounded-full blur-[80px] -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-black/10 rounded-full blur-[60px] translate-y-1/3 -translate-x-1/4 pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-center gap-10">
          {/* QR Card */}
          <div className="shrink-0">
            <div className="relative group">
              <div className="absolute -inset-3 bg-white/20 rounded-[2.5rem] blur-xl group-hover:bg-white/30 transition-all duration-700" />
              <div className="relative bg-white rounded-[2rem] p-6 shadow-2xl shadow-black/20">
                <img
                  src={qrCodeUrl}
                  alt="WhatsApp Bot QR Code"
                  className="w-48 h-48 md:w-56 md:h-56 block"
                />
                <div className="mt-4 text-center">
                  <div className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400 mb-0.5">Store ID</div>
                  <div className="text-base font-black text-gray-900 tracking-tight">{slug || "your-slug"}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Copy + Actions */}
          <div className="flex-1 text-white text-center lg:text-left">
            <div className="flex items-center justify-center lg:justify-start gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-yellow-300" />
              <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Your Automated Store</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-black leading-tight mb-4">
              Scan. Chat.<br />Order. Done.
            </h2>
            <p className="text-white/70 text-sm leading-relaxed mb-8 max-w-sm mx-auto lg:mx-0">
              Customers scan your personal QR code, the bot handles everything — pricing, orders, and delivery — automatically.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Button
                type="button"
                onClick={() => window.open(qrCodeUrl, "_blank")}
                className="w-full sm:w-auto bg-white text-green-700 hover:bg-white/90 rounded-2xl h-12 px-7 font-black shadow-lg"
              >
                <Download className="w-4 h-4 mr-2" />
                Download QR
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => window.open(waLink, "_blank")}
                className="w-full sm:w-auto text-white border border-white/30 hover:bg-white/10 rounded-2xl h-12 px-7 font-bold"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Test Bot
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Perks row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {perks.map(({ icon: Icon, label, desc }) => (
          <div
            key={label}
            className={cn(
              "rounded-2xl p-4 border flex flex-col gap-2 transition-all duration-300 hover:-translate-y-0.5",
              isDark
                ? "bg-white/[0.03] border-white/8 hover:bg-white/[0.06]"
                : "bg-white border-gray-100 hover:border-green-100 hover:bg-green-50/30 shadow-sm"
            )}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-md shadow-green-500/20">
              <Icon className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs font-black">{label}</p>
              <p className={cn("text-[11px]", isDark ? "text-white/40" : "text-gray-400")}>{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── How It Works ── */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <Star className="w-4 h-4 text-amber-400" />
          <h2 className="text-base font-black uppercase tracking-wider">How It Works</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map(({ num, icon: Icon, title, desc, color, glow, border, bg }) => (
            <div
              key={num}
              className={cn(
                "rounded-[1.5rem] p-5 border relative overflow-hidden transition-all duration-300 hover:-translate-y-1",
                isDark ? "bg-white/[0.03] border-white/8" : `bg-white shadow-sm`,
                border
              )}
            >
              <div className={cn("absolute top-0 right-0 w-32 h-32 rounded-full blur-2xl opacity-20 -translate-y-1/2 translate-x-1/2", bg)} />
              <div className="relative">
                <div className="flex items-start justify-between mb-4">
                  <div className={cn("w-11 h-11 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-lg", color, glow)}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <span className={cn("text-3xl font-black opacity-10", isDark ? "text-white" : "text-gray-900")}>{num}</span>
                </div>
                <h3 className="text-sm font-black mb-1.5">{title}</h3>
                <p className={cn("text-xs leading-relaxed", isDark ? "text-white/45" : "text-gray-500")}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Marketing Toolkit ── */}
      <div className={cn(
        "rounded-[2rem] border p-6 md:p-8",
        isDark ? "bg-white/[0.03] border-white/8" : "bg-white border-gray-100 shadow-sm"
      )}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md shadow-violet-500/20">
            <Share2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-black text-sm">Marketing Toolkit</h3>
            <p className={cn("text-[11px]", isDark ? "text-white/40" : "text-gray-400")}>Ready-made assets to promote your store</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Bot link */}
          <div className={cn("rounded-2xl border p-4", isDark ? "border-white/8 bg-white/[0.02]" : "border-gray-100 bg-gray-50")}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] font-black uppercase tracking-wider text-blue-500">Your Bot Link</span>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(waLink, "link")}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all",
                  copiedId === "link"
                    ? "bg-green-500 text-white"
                    : isDark
                      ? "bg-white/10 hover:bg-white/20 text-white"
                      : "bg-white hover:bg-gray-100 text-gray-700 border border-gray-200"
                )}
              >
                {copiedId === "link" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
              </button>
            </div>
            <p className={cn("text-xs font-mono break-all leading-relaxed", isDark ? "text-white/60" : "text-gray-600")}>
              {waLink}
            </p>
          </div>

          {/* Share message */}
          <div className={cn("rounded-2xl border p-4", isDark ? "border-white/8 bg-white/[0.02]" : "border-gray-100 bg-gray-50")}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-green-500" />
                <span className="text-[11px] font-black uppercase tracking-wider text-green-500">Ready-Made Caption</span>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(shareMessage, "msg")}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all",
                  copiedId === "msg"
                    ? "bg-green-500 text-white"
                    : isDark
                      ? "bg-white/10 hover:bg-white/20 text-white"
                      : "bg-white hover:bg-gray-100 text-gray-700 border border-gray-200"
                )}
              >
                {copiedId === "msg" ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
              </button>
            </div>
            <p className={cn("text-xs leading-relaxed whitespace-pre-line italic", isDark ? "text-white/55" : "text-gray-600")}>
              {shareMessage}
            </p>
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => window.open(qrCodeUrl, "_blank")}
          className={cn(
            "flex items-center gap-4 p-5 rounded-2xl border text-left group transition-all duration-300 hover:-translate-y-0.5",
            isDark
              ? "bg-white/[0.03] border-white/8 hover:bg-white/[0.06]"
              : "bg-white border-gray-100 shadow-sm hover:border-green-200 hover:shadow-md"
          )}
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20 shrink-0">
            <QrCode className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm">Download QR Code</p>
            <p className={cn("text-xs mt-0.5", isDark ? "text-white/40" : "text-gray-400")}>Print and paste anywhere for walk-in customers</p>
          </div>
          <ChevronRight className={cn("w-4 h-4 shrink-0 transition-transform group-hover:translate-x-1", isDark ? "text-white/20" : "text-gray-300")} />
        </button>

        <button
          type="button"
          onClick={() => window.open(waLink, "_blank")}
          className={cn(
            "flex items-center gap-4 p-5 rounded-2xl border text-left group transition-all duration-300 hover:-translate-y-0.5",
            isDark
              ? "bg-white/[0.03] border-white/8 hover:bg-white/[0.06]"
              : "bg-white border-gray-100 shadow-sm hover:border-green-200 hover:shadow-md"
          )}
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
            <ExternalLink className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm">Test Your Bot</p>
            <p className={cn("text-xs mt-0.5", isDark ? "text-white/40" : "text-gray-400")}>Open a live chat to experience it as a customer</p>
          </div>
          <ChevronRight className={cn("w-4 h-4 shrink-0 transition-transform group-hover:translate-x-1", isDark ? "text-white/20" : "text-gray-300")} />
        </button>
      </div>

      {/* ── Pro Tip ── */}
      <div className={cn(
        "rounded-2xl border p-5 flex gap-4 items-start",
        isDark ? "bg-amber-400/5 border-amber-400/15" : "bg-amber-50 border-amber-200/60"
      )}>
        <div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center shrink-0 shadow-md shadow-amber-400/20">
          <Sparkles className="w-4 h-4 text-black" />
        </div>
        <div>
          <p className="text-sm font-black text-amber-600 mb-0.5">Pro Tip</p>
          <p className={cn("text-xs leading-relaxed", isDark ? "text-white/50" : "text-gray-600")}>
            Print your QR code on a banner, paste it in your shop, or use it as your WhatsApp status. Every scan is a potential sale — make it visible everywhere!
          </p>
        </div>
      </div>

    </div>
  );
};

export default DashboardWhatsAppBot;
