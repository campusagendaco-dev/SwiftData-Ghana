import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Store, Share2, Copy, Check, QrCode, ExternalLink, Sparkles, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function StoreShareCard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const slug = profile?.store_slug || profile?.store_name?.toLowerCase().replace(/[^a-z0-9]/g, "-") || "";
  if (!profile?.is_agent || !slug) return null;

  const origin = window.location.origin;
  const storeUrl = `${origin}/store/${slug}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(storeUrl)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(storeUrl);
    setCopied(true);
    toast({ title: "Store Link Copied! 🔗", description: storeUrl });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWhatsAppStatus = () => {
    const text = `🔥 BUY CHEAP & INSTANT DATA BUNDLES 24/7! 🔥\n\n` +
      `MTN, Telecel, and AT Bundles delivered in 15 seconds at wholesale rates!\n\n` +
      `👉 Order Now on My Official Store:\n${storeUrl}`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/60 to-purple-950/20 p-5 sm:p-6 border border-white/10 backdrop-blur-2xl shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-3 rounded-2xl bg-purple-500/15 border border-purple-500/30 text-purple-400 shrink-0">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                Your Online Storefront
              </span>
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[9px] font-bold">
                Live & Accepting Orders
              </Badge>
            </div>
            <h3 className="text-base font-black text-white mt-1">
              {profile.store_name || "My Store"}
            </h3>
            <p className="text-xs text-slate-300 font-mono mt-0.5 truncate max-w-sm">
              {storeUrl}
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyLink}
            className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-xs h-9 gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy Link"}
          </Button>

          <Button
            size="sm"
            onClick={handleShareWhatsAppStatus}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs h-9 gap-1.5 shadow-md border-0"
          >
            <MessageCircle className="w-3.5 h-3.5 fill-white" /> Post on WhatsApp Status
          </Button>

          <Button
            size="sm"
            onClick={() => window.open(storeUrl, "_blank")}
            className="rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 font-bold text-xs h-9 gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Visit Store
          </Button>
        </div>
      </div>
    </div>
  );
}
