import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { 
  MessageCircle, Copy, Check, Share2, 
  Smartphone, Zap, Gift, ShoppingCart,
  ExternalLink, QrCode
} from "lucide-react";
import { basePackages } from "@/lib/data";
import { getAppBaseUrl } from "@/lib/app-base-url";

const DashboardMarketing = () => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const [selectedNetwork, setSelectedNetwork] = useState<"MTN" | "Telecel" | "AirtelTigo">("MTN");
  
  const storeUrl = profile?.store_slug 
    ? `${window.location.origin}/store/${profile.store_slug}`
    : `${window.location.origin}/agent-program`;

  const packages = basePackages[selectedNetwork] || [];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast({ title: "Link copied to clipboard!" });
    setTimeout(() => setCopied(null), 2000);
  };

  const generateWhatsAppLink = (pkgSize: string) => {
    const text = `Hi, I want to buy ${selectedNetwork} ${pkgSize} data bundle from your store: ${storeUrl}?pkg=${pkgSize}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700">
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shrink-0">
            <Share2 className="w-5 h-5 text-white" />
          </div>
          Marketing Tools
        </h1>
        <p className="text-white/35 text-sm mt-1.5 ml-[52px]">
          Generate smart links to sell faster on WhatsApp and Social Media.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Main Store Link */}
        <div className="lg:col-span-12">
          <div className="rounded-[2.5rem] bg-gradient-to-br from-indigo-600 to-violet-700 p-8 md:p-12 relative overflow-hidden shadow-2xl shadow-indigo-500/20">
            <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
            
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="space-y-4 text-center md:text-left">
                <Badge className="bg-white/20 text-white border-none px-3 py-1 text-[10px] font-black uppercase tracking-widest">Your Public Storefront</Badge>
                <h2 className="text-4xl font-black text-white">Share Your Store</h2>
                <p className="text-white/70 max-w-md text-sm leading-relaxed">
                  Your customers can visit this link to buy data directly. Your agent commission is automatically added to your wallet.
                </p>
              </div>

              <div className="w-full md:w-auto bg-black/20 backdrop-blur-md p-2 rounded-3xl border border-white/10 flex flex-col sm:flex-row items-center gap-2">
                <div className="px-4 py-3 font-mono text-sm text-white/80 truncate max-w-[250px]">
                  {storeUrl}
                </div>
                <div className="flex w-full sm:w-auto gap-2">
                  <button 
                    onClick={() => handleCopy(storeUrl, "store")}
                    className="flex-1 sm:flex-none h-12 px-6 rounded-2xl bg-white text-black font-black text-xs flex items-center justify-center gap-2 hover:bg-white/90 transition-all"
                  >
                    {copied === "store" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied === "store" ? "Copied" : "Copy Link"}
                  </button>
                  <a 
                    href={storeUrl} 
                    target="_blank" 
                    rel="noreferrer"
                    className="h-12 w-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-all"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Smart Bundle Links */}
        <div className="lg:col-span-8 space-y-6">
          <div className="rounded-3xl bg-emerald-500/10 border border-emerald-500/20 p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Gift className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white">Loyalty Announcement</h3>
                <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Copy & Share with Customers</p>
              </div>
            </div>
            
            <div className="relative group">
              <div className="p-5 rounded-2xl bg-black/40 border border-white/5 font-medium text-sm text-white/70 leading-relaxed italic">
                "🚀 BIG NEWS! We just launched **SwiftPoints**! 💎 Earn points every time you buy data or airtime on our platform. 💰 Get 1 Point for every GHS 10 spent. 🎁 Redeem points for FREE Wallet Cash! Start earning today: {storeUrl}"
              </div>
              <button 
                onClick={() => handleCopy(`🚀 BIG NEWS! We just launched SwiftPoints! 💎 Earn points every time you buy data or airtime on our platform. 💰 Get 1 Point for every GHS 10 spent. 🎁 Redeem points for FREE Wallet Cash! Start earning today: ${storeUrl}`, "announcement")}
                className="absolute top-4 right-4 h-10 px-4 rounded-xl bg-white text-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-emerald-400 transition-all shadow-xl"
              >
                {copied === "announcement" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === "announcement" ? "Copied" : "Copy Ad Text"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl bg-white/5 border border-white/10 p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-sky-400" />
                </div>
                <h3 className="text-lg font-black text-white">Smart Bundle Links</h3>
              </div>
              
              <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/5">
                {(["MTN", "Telecel", "AirtelTigo"] as const).map(net => (
                  <button
                    key={net}
                    onClick={() => setSelectedNetwork(net)}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                      selectedNetwork === net ? "bg-white/10 text-white" : "text-white/30 hover:text-white/50"
                    }`}
                  >
                    {net}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-sm text-white/40">Generate links for specific bundles. When clicked, these pre-fill the order for your customer.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {packages.map(p => {
                const pkgLink = `${storeUrl}?pkg=${p.size}`;
                const waLink = generateWhatsAppLink(p.size);
                return (
                  <div key={p.size} className="group p-5 rounded-2xl bg-black/20 border border-white/5 hover:border-white/10 transition-all space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">{selectedNetwork}</p>
                        <p className="text-xl font-black text-white">{p.size}</p>
                      </div>
                      <span className="text-lg font-black text-sky-400">₵{p.price.toFixed(2)}</span>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleCopy(pkgLink, p.size)}
                        className="flex-1 h-10 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase text-white hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                      >
                        {copied === p.size ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        Copy Link
                      </button>
                      <a 
                        href={waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-black uppercase text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-2"
                      >
                        <MessageCircle className="w-3 h-3" />
                        WhatsApp
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Marketing Tips Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <div className="rounded-3xl bg-amber-400 p-8 space-y-6 text-black shadow-2xl shadow-amber-400/20">
            <div className="w-12 h-12 rounded-2xl bg-black/10 flex items-center justify-center">
              <Gift className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-black leading-tight">Pro Agent Selling Tips</h3>
            <div className="space-y-4">
              {[
                { title: "Use Status Updates", text: "Post your 'Smart Bundle Link' on your WhatsApp Status every morning." },
                { title: "Offer Bulk Rates", text: "Tell corporate clients you can handle 100+ employees via the Bulk Disbursement tool." },
                { title: "Points Rewards", text: "Remind customers they earn 'SwiftPoints' for every purchase which can be redeemed for free data." }
              ].map((tip, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest opacity-40">Tip {i+1}</p>
                  <p className="font-bold text-sm">{tip.title}</p>
                  <p className="text-xs opacity-70 leading-relaxed">{tip.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white/5 border border-white/10 p-6 flex items-center gap-4 group cursor-pointer hover:bg-white/10 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center shrink-0 border border-white/10 group-hover:border-white/20 transition-all">
              <QrCode className="w-6 h-6 text-white/40 group-hover:text-white transition-colors" />
            </div>
            <div>
              <p className="text-sm font-black text-white">Generate QR Code</p>
              <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest mt-0.5">For offline posters</p>
            </div>
            <ArrowRight className="w-4 h-4 ml-auto text-white/20" />
          </div>
        </div>

      </div>
    </div>
  );
};

const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}>
    {children}
  </span>
);

export default DashboardMarketing;
