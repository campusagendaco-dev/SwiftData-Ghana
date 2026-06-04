import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle, Copy, Check, Share2,
  Zap, Gift,
  ExternalLink, QrCode, ArrowRight
} from "lucide-react";
import { basePackages } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useAppTheme } from "@/contexts/ThemeContext";

// ── WhatsApp Status Kit data ───────────────────────────────────────────────────

const STATUS_CATEGORIES = [
  { id: "daily",    label: "🌅 Daily Promo" },
  { id: "network",  label: "📡 Network Deal" },
  { id: "referral", label: "💰 Referral Push" },
  { id: "trust",    label: "✅ Trust Builder" },
  { id: "flash",    label: "🔥 Flash Sale" },
];

const STATUS_TEMPLATES: Record<string, { title: string; text: string }[]> = {
  daily: [
    {
      title: "Morning Boost",
      text: `🌅 Good morning Ghana! 🇬🇭\n\nStarting your day right with {storeName} 📱\n\n✅ MTN data from GH₵3.00\n✅ Telecel bundles available\n✅ AirtelTigo deals ready\n\nInstant delivery, no wahala 💪\n\n👉 Order now: {storeUrl}`,
    },
    {
      title: "Today's Deals",
      text: `📊 Today's best deals are LIVE!\n\n💰 Affordable data for everyone in Ghana\n⚡ Pay with MoMo — instant delivery\n🔒 100% safe & secure\n\nDon't suffer no data 😂\n\n👇 Shop here: {storeUrl}`,
    },
  ],
  network: [
    {
      title: "MTN Special",
      text: `📡 MTN DATA DEALS 📡\n\nBest MTN bundles at the lowest prices in Ghana! 💥\n\n⚡ Instant activation\n💰 Prices nobody can beat\n📲 Order from {storeName}\n\n🔥 Shop now 👉 {storeUrl}`,
    },
    {
      title: "Telecel Deal",
      text: `🟣 TELECEL DATA DEALS 🟣\n\nTop Telecel bundles available NOW!\n\n💸 Super affordable prices\n⚡ Instant delivery\n✅ From your trusted plug — {storeName}\n\n👉 {storeUrl}`,
    },
    {
      title: "AirtelTigo Offer",
      text: `🔴 AIRTELTIGO BUNDLES 🔴\n\nGet AirtelTigo data at the best price in Ghana!\n\n⚡ Instant delivery\n💰 Lowest prices guaranteed\n📲 Order from {storeName}\n\n👉 {storeUrl}`,
    },
  ],
  referral: [
    {
      title: "Earn Money",
      text: `💰 Want to earn FREE money? 💰\n\nHere's how:\n\n1️⃣ Buy data from my store\n2️⃣ Get your referral link\n3️⃣ Share with friends\n4️⃣ Earn GH₵2+ per friend who buys!\n\nNo limit on earnings 🔥\n\n👇 Start here: {storeUrl}`,
    },
    {
      title: "Friend Discount",
      text: `🎁 Tell a friend about {storeName}!\n\n✅ They get the best data prices in Ghana\n✅ You earn wallet credit every time they buy\n\nForward this to 5 friends now 📤\n\nOur store: {storeUrl} 👈`,
    },
  ],
  trust: [
    {
      title: "Verified Plug",
      text: `✅ VERIFIED DATA PLUG 🇬🇭\n\n{storeName} — serving Ghana daily:\n\n📲 Instant delivery every time\n💰 Prices nobody can beat\n🔒 Safe MoMo payment\n⭐ Hundreds of happy customers\n\nTry us today 👉 {storeUrl}`,
    },
    {
      title: "Trust Signal",
      text: `🙌 Why customers choose {storeName}:\n\n⚡ Data arrives in seconds\n💸 Always the lowest price\n📞 Responsive support\n🇬🇭 Proudly Ghanaian\n\nJoin thousands of happy customers\n👉 {storeUrl}`,
    },
  ],
  flash: [
    {
      title: "Flash Sale",
      text: `🚨 FLASH SALE — LIMITED TIME! 🚨\n\nGet data before it's gone 👇\n\n⚡ Instant delivery 24/7\n💸 Lowest prices TODAY\n✅ All networks covered\n\n📱 Order NOW: {storeUrl}\n\n⏰ Don't wait!`,
    },
    {
      title: "Weekend Deal",
      text: `🎉 WEEKEND SPECIAL from {storeName}! 🎉\n\nTreat yourself to affordable data 🇬🇭\n\n📡 All networks available\n⚡ Instant MoMo payment\n💰 Best prices guaranteed\n\n👉 Order now: {storeUrl}`,
    },
  ],
};

const MOCKUP_BGS = [
  { class: "from-teal-600 to-emerald-700", label: "Teal" },
  { class: "from-purple-600 to-indigo-700", label: "Purple" },
  { class: "from-rose-500 to-red-600", label: "Rose" },
  { class: "from-amber-500 to-orange-600", label: "Amber" },
  { class: "from-slate-800 to-slate-950", label: "Slate" },
];

const DashboardMarketing = () => {
  const { profile } = useAuth();
  const { isDark } = useAppTheme();
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [statusCategory, setStatusCategory] = useState("daily");
  const [selectedNetwork, setSelectedNetwork] = useState<"MTN" | "Telecel" | "AirtelTigo">("MTN");
  const [selectedStatusText, setSelectedStatusText] = useState("");
  const [mockupBg, setMockupBg] = useState("from-teal-600 to-emerald-700");

  const storeUrl = profile?.slug
    ? `${window.location.origin}/store/${profile.slug}`
    : `${window.location.origin}/agent-program`;

  const packages = basePackages[selectedNetwork] || [];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast({ title: "Copied to clipboard!" });
    setTimeout(() => setCopied(null), 2000);
  };

  const generateWhatsAppLink = (pkgSize: string) => {
    const text = `Hi, I want to buy ${selectedNetwork} ${pkgSize} data bundle from your store: ${storeUrl}?pkg=${pkgSize}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const hydrateMsg = (text: string) =>
    text
      .replace(/\{storeName\}/g, profile?.store_name || "My Store")
      .replace(/\{storeUrl\}/g, storeUrl);

  const currentMessages = STATUS_TEMPLATES[statusCategory] ?? [];

  useEffect(() => {
    if (currentMessages.length > 0) {
      setSelectedStatusText(hydrateMsg(currentMessages[0].text));
    }
  }, [statusCategory, profile]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700">
      <div>
        <h1 className={cn("text-3xl font-black tracking-tight flex items-center gap-3", isDark ? "text-white" : "text-gray-900")}>
          <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shrink-0">
            <Share2 className="w-5 h-5 text-white" />
          </div>
          Marketing Tools
        </h1>
        <p className={cn("text-sm mt-1.5 ml-[52px]", isDark ? "text-white/35" : "text-gray-500")}>
          Generate smart links, flyers, and status posts to sell faster.
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
                    type="button"
                    onClick={() => handleCopy(storeUrl, "store")}
                    className="flex-1 sm:flex-none h-12 px-6 rounded-2xl bg-white text-black font-black text-xs flex items-center justify-center gap-2 hover:bg-white/90 transition-all"
                  >
                    {copied === "store" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied === "store" ? "Copied" : "Copy Link"}
                  </button>
                  <a
                    href={storeUrl} target="_blank" rel="noreferrer"
                    aria-label="Open store in new tab"
                    className="h-12 w-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-all"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── WhatsApp Status Kit ──────────────────────────────────────── */}
        <div className="lg:col-span-12">
          <div className="rounded-3xl bg-green-500/8 border border-green-500/20 p-8 space-y-6">
            {/* Header + category tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <h3 className={cn("text-lg font-black", isDark ? "text-white" : "text-gray-900")}>WhatsApp Status Kit</h3>
                  <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Copy · post to Status · sell more</p>
                </div>
              </div>
              <div className={cn("flex gap-1.5 flex-wrap p-1 rounded-2xl border", isDark ? "bg-black/30 border-white/8" : "bg-gray-100 border-gray-200")}>
                {STATUS_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setStatusCategory(cat.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap",
                      statusCategory === cat.id
                        ? "bg-green-500 text-white shadow"
                        : isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700",
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Mockup split layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Message cards */}
              <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-4 h-fit">
                {currentMessages.map((msg, i) => {
                  const hydrated = hydrateMsg(msg.text);
                  const cardId = `status-${statusCategory}-${i}`;
                  const isSelected = selectedStatusText === hydrated;
                  return (
                    <div
                      key={cardId}
                      onClick={() => setSelectedStatusText(hydrated)}
                      className={cn(
                        "group rounded-2xl border p-5 space-y-4 transition-all cursor-pointer",
                        isSelected 
                          ? "bg-green-500/10 border-green-500 shadow-md shadow-green-500/5"
                          : isDark ? "bg-black/20 border-white/8 hover:border-green-500/25" : "bg-white border-gray-200 hover:border-green-200",
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <p className={cn("text-[10px] font-black uppercase tracking-widest", isDark ? "text-white/30" : "text-gray-400")}>{msg.title}</p>
                        {isSelected && <span className="text-[9px] font-black text-green-400 uppercase bg-green-500/10 px-2 py-0.5 rounded-full">Viewing Preview</span>}
                      </div>
                      <p className={cn("text-xs leading-relaxed whitespace-pre-line line-clamp-6", isDark ? "text-white/65" : "text-gray-600")}>
                        {hydrated}
                      </p>
                      <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleCopy(hydrated, cardId)}
                          className={cn(
                            "flex-1 h-9 rounded-xl border text-[10px] font-black flex items-center justify-center gap-1.5 transition-all active:scale-95",
                            copied === cardId
                              ? "bg-green-500/15 border-green-500/30 text-green-400"
                              : isDark
                              ? "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                              : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100",
                          )}
                        >
                          {copied === cardId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          {copied === cardId ? "Copied!" : "Copy"}
                        </button>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(hydrated)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 h-9 rounded-xl bg-green-500/15 border border-green-500/25 text-[10px] font-black text-green-400 hover:bg-green-500/25 transition-all flex items-center justify-center gap-1.5 active:scale-95"
                        >
                          <MessageCircle className="w-3 h-3" />
                          WhatsApp
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Phone Mockup Preview */}
              <div className="lg:col-span-4 flex flex-col items-center gap-4">
                <p className={cn("text-xs font-black uppercase tracking-wider", isDark ? "text-white/50" : "text-gray-500")}>Live Status Preview</p>
                
                {/* Phone container */}
                <div className="relative border-4 border-slate-800 dark:border-slate-700 rounded-[2.5rem] h-[480px] w-[240px] bg-slate-950 shadow-2xl overflow-hidden flex flex-col">
                  {/* Speaker and Notch */}
                  <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-24 h-3.5 bg-slate-800 rounded-full z-40 flex items-center justify-center">
                    <span className="w-8 h-1 bg-slate-900 rounded-full" />
                  </div>

                  {/* Status Screen Header Mock */}
                  <div className="pt-6 pb-2 px-3 bg-black/40 backdrop-blur-md flex items-center justify-between text-white border-b border-white/5 shrink-0 z-10">
                    <div className="flex items-center gap-2">
                      {/* Avatar */}
                      <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300 ring-1 ring-white/20">
                        {profile?.store_name?.slice(0, 2).toUpperCase() || "ST"}
                      </div>
                      <div className="leading-none">
                        <p className="text-[10px] font-black truncate max-w-[100px]">{profile?.store_name || "My Store"}</p>
                        <span className="text-[8px] text-white/60 text-left block">Today, 10:07 AM</span>
                      </div>
                    </div>
                    {/* Mock close */}
                    <div className="flex items-center gap-1 opacity-70">
                      <span className="w-1 h-1 rounded-full bg-white" />
                      <span className="w-1 h-1 rounded-full bg-white" />
                      <span className="w-1 h-1 rounded-full bg-white" />
                    </div>
                  </div>

                  {/* Status text background */}
                  <div className={cn("flex-1 flex flex-col items-center justify-center p-4 text-center text-white text-[11px] font-medium leading-relaxed whitespace-pre-line overflow-y-auto break-words select-none bg-gradient-to-br transition-all duration-300", mockupBg)}>
                    {selectedStatusText || "Select a status template to preview"}
                  </div>

                  {/* Mock status footer */}
                  <div className="py-2.5 bg-black/40 text-center text-white/50 text-[8px] font-black uppercase tracking-wider border-t border-white/5 shrink-0 z-10">
                    ▲ Swipe Up to Reply
                  </div>
                </div>

                {/* Color picker for preview bg */}
                <div className="flex items-center gap-1.5 mt-1 bg-black/10 dark:bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
                  {MOCKUP_BGS.map(bg => (
                    <button
                      key={bg.label}
                      type="button"
                      onClick={() => setMockupBg(bg.class)}
                      className={cn(
                        "w-5 h-5 rounded-full bg-gradient-to-br border transition-all hover:scale-110",
                        bg.class,
                        mockupBg === bg.class ? "border-white scale-105" : "border-transparent"
                      )}
                      title={bg.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <p className={cn("text-[10px]", isDark ? "text-white/20" : "text-gray-400")}>
              💡 Tip: Post one message per day to your WhatsApp Status at 7am, 12pm and 7pm for maximum reach.
            </p>
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
                <h3 className={cn("text-lg font-black", isDark ? "text-white" : "text-gray-900")}>Loyalty Announcement</h3>
                <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Copy & Share with Customers</p>
              </div>
            </div>
            <div className="relative group">
              <div className={cn(
                "p-5 rounded-2xl border font-medium text-sm leading-relaxed italic transition-all",
                isDark ? "bg-black/40 border-white/5 text-white/70" : "bg-white border-emerald-100 text-gray-700"
              )}>
                "🚀 BIG NEWS! We just launched **SwiftPoints**! 💎 Earn points every time you buy data or airtime on our platform. 💰 Get 1 Point for every GHS 10 spent. 🎁 Redeem points for FREE Wallet Cash! Start earning today: {storeUrl}"
              </div>
              <button
                type="button"
                onClick={() => handleCopy(`🚀 BIG NEWS! We just launched SwiftPoints! 💎 Earn points every time you buy data or airtime on our platform. 💰 Get 1 Point for every GHS 10 spent. 🎁 Redeem points for FREE Wallet Cash! Start earning today: ${storeUrl}`, "announcement")}
                className="absolute top-4 right-4 h-10 px-4 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-emerald-600 transition-all shadow-xl"
              >
                {copied === "announcement" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === "announcement" ? "Copied" : "Copy Ad Text"}
              </button>
            </div>
          </div>

          <div className={cn(
            "rounded-3xl border p-8 space-y-6",
            isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-100 shadow-sm"
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-sky-400" />
                </div>
                <h3 className={cn("text-lg font-black", isDark ? "text-white" : "text-gray-900")}>Smart Bundle Links</h3>
              </div>
              <div className={cn("flex gap-2 p-1 rounded-xl border", isDark ? "bg-black/40 border-white/5" : "bg-gray-100 border-gray-200")}>
                {(["MTN", "Telecel", "AirtelTigo"] as const).map(net => (
                  <button
                    key={net}
                    type="button"
                    onClick={() => setSelectedNetwork(net)}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                      selectedNetwork === net
                        ? (isDark ? "bg-white/10 text-white" : "bg-white text-gray-900 shadow-sm")
                        : (isDark ? "text-white/30 hover:text-white/50" : "text-gray-400 hover:text-gray-600")
                    }`}
                  >
                    {net}
                  </button>
                ))}
              </div>
            </div>
            <p className={cn("text-sm", isDark ? "text-white/40" : "text-gray-500")}>Generate links for specific bundles. When clicked, these pre-fill the order for your customer.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {packages.map(p => {
                const pkgLink = `${storeUrl}?pkg=${p.size}`;
                const waLink = generateWhatsAppLink(p.size);
                return (
                  <div key={p.size} className={cn(
                    "group p-5 rounded-2xl border transition-all space-y-4",
                    isDark ? "bg-black/20 border-white/5 hover:border-white/10" : "bg-gray-50 border-gray-200 hover:border-gray-300"
                  )}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className={cn("text-[10px] font-black uppercase tracking-widest", isDark ? "text-white/20" : "text-gray-400")}>{selectedNetwork}</p>
                        <p className={cn("text-xl font-black", isDark ? "text-white" : "text-gray-900")}>{p.size}</p>
                      </div>
                      <span className="text-lg font-black text-sky-400">₵{p.price.toFixed(2)}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopy(pkgLink, p.size)}
                        className={cn(
                          "flex-1 h-10 rounded-xl border text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2",
                          isDark ? "bg-white/5 border-white/10 text-white hover:bg-white/10" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm"
                        )}
                      >
                        {copied === p.size ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        Copy Link
                      </button>
                      <a
                        href={waLink} target="_blank" rel="noreferrer"
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
                { title: "Post Status Daily", text: "Use the Status Kit above — post at 7am, 12pm, and 7pm for 3× more reach." },
                { title: "Offer Bulk Rates", text: "Tell corporate clients you can handle 100+ employees via the Bulk Disbursement tool." },
                { title: "Points Rewards", text: "Remind customers they earn SwiftPoints for every purchase which can be redeemed for free data." },
              ].map((tip, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest opacity-40">Tip {i + 1}</p>
                  <p className="font-bold text-sm">{tip.title}</p>
                  <p className="text-xs opacity-70 leading-relaxed">{tip.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={cn(
            "rounded-3xl border p-6 flex items-center gap-4 group cursor-pointer transition-all",
            isDark ? "bg-white/5 border-white/10 hover:bg-white/10" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
          )}>
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border transition-all",
              isDark ? "bg-white/5 border-white/10 group-hover:border-white/20" : "bg-white border-gray-200 shadow-sm"
            )}>
              <QrCode className={cn("w-6 h-6 transition-colors", isDark ? "text-white/40 group-hover:text-white" : "text-gray-400 group-hover:text-gray-900")} />
            </div>
            <div>
              <p className={cn("text-sm font-black", isDark ? "text-white" : "text-gray-900")}>Generate QR Code</p>
              <p className={cn("text-[10px] font-bold uppercase tracking-widest mt-0.5", isDark ? "text-white/30" : "text-gray-400")}>For offline posters</p>
            </div>
            <ArrowRight className={cn("w-4 h-4 ml-auto", isDark ? "text-white/20" : "text-gray-300")} />
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
