import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { basePackages, getPublicPrice } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Zap, Copy, Share2, MessageCircle, Info, CheckCircle2, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const DashboardMarketing = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [includeLink, setIncludeLink] = useState(true);

  const storeUrl = profile?.slug
    ? `${window.location.origin}/store/${profile.slug}`
    : null;

  const getPrice = (network: string, size: string, basePrice: number) => {
    const custom = profile?.agent_prices?.[network]?.[size];
    if (custom && Number(custom) > 0) return Number(custom);
    return getPublicPrice(basePrice);
  };

  const generatePriceListText = () => {
    let text = `🚀 *${profile?.store_name || "SwiftData GH"} - Data Bundle Prices* 🚀\n\n`;
    text += `✅ *Fast Delivery* | ✅ *Non-Expiry* | ✅ *24/7*\n\n`;

    Object.entries(basePackages).forEach(([network, packages]) => {
      text += `--- *${network.toUpperCase()} DATA* ---\n`;
      // Take only top 6 packages to keep it concise for WhatsApp
      packages.slice(0, 8).forEach((pkg) => {
        const price = getPrice(network, pkg.size, pkg.price);
        text += `🔹 ${pkg.size} - *GHS ${price.toFixed(2)}*\n`;
      });
      text += `\n`;
    });

    if (includeLink && storeUrl) {
      text += `🛒 *Order instantly here:* \n${storeUrl}\n\n`;
    }

    text += `📲 *Contact support:* ${profile?.whatsapp_number || "Our WhatsApp"}\n`;
    text += `\n_Powered by SwiftData Ghana_`;
    
    return text;
  };

  const handleCopy = () => {
    const text = generatePriceListText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied to clipboard!", description: "You can now paste it on WhatsApp or social media." });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(generatePriceListText());
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  return (
    <div className="p-6 md:p-8 space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Zap className="w-8 h-8 text-primary" />
            Marketing Tools
          </h1>
          <p className="text-white/40 text-sm mt-1">Boost your sales by sharing professional price lists and promotional content.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Generator Controls */}
        <div className="space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 backdrop-blur-xl space-y-6">
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white leading-tight">Price List Automator</h2>
                <p className="text-white/40 text-xs">Instantly generate an optimized WhatsApp message.</p>
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                <div>
                  <p className="text-white font-bold text-sm">Include Store Link</p>
                  <p className="text-white/30 text-xs mt-0.5">Let customers buy directly from your URL.</p>
                </div>
                <button
                  onClick={() => setIncludeLink(!includeLink)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${includeLink ? 'bg-primary' : 'bg-white/10'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${includeLink ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex gap-3">
                <Info className="w-5 h-5 text-blue-400 shrink-0" />
                <p className="text-xs text-blue-100/60 leading-relaxed">
                  The prices shown here include your custom markups. If you haven't set custom prices, the default public rates will be used.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
                <Button 
                  onClick={handleCopy}
                  variant="outline"
                  className="h-14 rounded-2xl border-white/10 hover:bg-white/5 gap-2 text-white"
                >
                  {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                  {copied ? "Copied!" : "Copy Text"}
                </Button>
                <Button 
                  onClick={handleShareWhatsApp}
                  className="h-14 rounded-2xl bg-[#25D366] hover:bg-[#128C7E] text-white border-none gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  Share on WhatsApp
                </Button>
              </div>
            </div>
          </div>

          {/* Marketing Tip Card */}
          <div className="bg-gradient-to-br from-amber-400/10 to-blue-500/10 border border-white/10 rounded-[2.5rem] p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Share2 className="w-24 h-24" />
            </div>
            <div className="relative z-10">
              <Badge className="bg-amber-400 text-black font-black text-[9px] uppercase tracking-widest mb-4">Pro Tip</Badge>
              <h3 className="text-lg font-bold text-white mb-2">Grow Your Business</h3>
              <p className="text-white/40 text-sm leading-relaxed">
                Consistent sharing is key! Post your price list to your WhatsApp Status every morning between 7 AM and 9 AM for maximum engagement.
              </p>
            </div>
          </div>
        </div>

        {/* Preview Panel */}
        <div className="bg-[#0a0a0c] border border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
          <div className="px-6 py-4 bg-white/5 border-b border-white/5 flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">WhatsApp Preview</p>
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500/40" />
              <div className="w-2 h-2 rounded-full bg-amber-500/40" />
              <div className="w-2 h-2 rounded-full bg-emerald-500/40" />
            </div>
          </div>
          <div className="p-6 flex-1 overflow-y-auto max-h-[500px]">
            <div className="bg-[#075e54] rounded-2xl p-4 max-w-[90%] relative shadow-xl">
              {/* WhatsApp Bubble Tail */}
              <div className="absolute top-0 -left-2 w-4 h-4 bg-[#075e54] [clip-path:polygon(100%_0,0_0,100%_100%)]" />
              <pre className="text-[13px] text-white whitespace-pre-wrap font-sans leading-relaxed">
                {generatePriceListText()}
              </pre>
              <div className="flex justify-end mt-1">
                <span className="text-[10px] text-white/40">12:00 PM ✓✓</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardMarketing;
