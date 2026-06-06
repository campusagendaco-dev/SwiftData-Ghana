import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Home, ReceiptText, Wallet, ShoppingBag, Copy, Check, Package as PackageIcon, Phone as PhoneIcon, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ConfettiPiece = {
  id: number;
  left: number;
  size: number;
  delay: number;
  duration: number;
  rotation: number;
  color: string;
};

const CONFETTI_COLORS = [
  "#ffd43b",
  "#ff9f1c",
  "#22c55e",
  "#0ea5e9",
  "#f97316",
  "#e11d48",
];

const formatPhone = (value: string) => {
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("233")) return `0${digits.slice(3)}`;
  return value;
};

const PurchaseSuccess = () => {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || "";
  const network = searchParams.get("network") || "";
  const packageSize = searchParams.get("package") || "";
  const customerPhone = formatPhone(searchParams.get("phone") || "");
  const source = searchParams.get("source") || "";
  const slug = searchParams.get("slug") || "";
  const [copied, setCopied] = useState(false);

  // Play success sound on mount
  useState(() => {
    const audio = new Audio("/sounds/success.mp3");
    audio.volume = 0.5;
    audio.play().catch(() => console.log("[PurchaseSuccess] Audio blocked"));
  });

  const fromStore = Boolean(slug);
  const storeUrl = fromStore ? `/store/${slug}` : null;

  const copyReceipt = () => {
    const now = new Date().toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "    SwiftData Ghana — Receipt",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Ref       : ${reference.slice(0, 12).toUpperCase()}`,
      `Date      : ${now}`,
      "─────────────────────────────────",
      ...(network ? [`Network   : ${network}`] : []),
      ...(packageSize ? [`Package   : ${packageSize}`] : []),
      ...(customerPhone ? [`Recipient : ${customerPhone}`] : []),
      `Status    : ✅ Delivered`,
      "─────────────────────────────────",
      "  swiftdatagh.shop",

      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    const text = lines.join("\n");
    
    if (navigator.share) {
      navigator.share({
        title: 'SwiftData Receipt',
        text: text,
      }).catch(() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const confetti = useMemo<ConfettiPiece[]>(
    () =>
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        left: Math.random() * 100,
        size: 8 + Math.random() * 10,
        delay: Math.random() * 1.5,
        duration: 2.5 + Math.random() * 2,
        rotation: Math.random() * 360,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      })),
    [],
  );

  return (
    <div className="min-h-screen bg-[#030305] text-white overflow-hidden flex flex-col relative">
      {/* ── Background Mesh ── */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-emerald-500/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-500/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
      </div>

      <div className="purchase-success-confetti z-10" aria-hidden="true">
        {confetti.map((piece) => (
          <span
            key={piece.id}
            className="purchase-success-confetti-piece"
            style={{
              left: `${piece.left}%`,
              width: `${piece.size}px`,
              height: `${piece.size * 0.45}px`,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
              transform: `rotate(${piece.rotation}deg)`,
              backgroundColor: piece.color,
            }}
          />
        ))}
      </div>

      <div className="relative z-20 flex-1 flex items-center justify-center p-6 md:p-8">
        <div className="w-full max-w-xl animate-in zoom-in-95 fade-in duration-1000">
          
          <div className="relative group">
            {/* Outer Glow */}
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 via-primary/20 to-blue-500/20 rounded-[3.5rem] blur-2xl opacity-100 transition duration-1000 group-hover:opacity-100" />
            
            <div className="relative bg-[#0A0A0C]/80 backdrop-blur-3xl border border-white/10 rounded-[3rem] overflow-hidden shadow-3xl">
              
              {/* Header */}
              <div className="pt-12 pb-6 px-8 text-center space-y-6">
                {/* SVG Illustration */}
                <div className="relative mx-auto w-48 h-48">
                  <div className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl opacity-10 animate-pulse" />
                  <svg className="w-full h-full drop-shadow-[0_8px_24px_rgba(16,185,129,0.2)] animate-bounce-subtle relative z-10" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Phone Body */}
                    <rect x="55" y="25" width="90" height="150" rx="16" fill="url(#phoneGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
                    {/* Phone Screen */}
                    <rect x="62" y="32" width="76" height="136" rx="10" fill="#0A0A0C"/>
                    {/* Phone Notch */}
                    <rect x="90" y="35" width="20" height="4" rx="2" fill="rgba(255,255,255,0.2)"/>
                    
                    {/* Decorative Data Waves/Grid */}
                    <path d="M 65 100 Q 100 85 135 100" stroke="rgba(16,185,129,0.3)" strokeWidth="2" fill="none"/>
                    <path d="M 65 120 Q 100 105 135 120" stroke="rgba(16,185,129,0.15)" strokeWidth="2" fill="none"/>
                    
                    {/* Success Badge */}
                    <circle cx="100" cy="90" r="32" fill="url(#badgeGrad)" filter="url(#shadow)"/>
                    <circle cx="100" cy="90" r="26" fill="#0A0A0C"/>
                    
                    {/* Success Checkmark */}
                    <path d="M 90 90 L 97 97 L 112 82" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                    
                    {/* Sparkles/Stars */}
                    <path d="M 45 60 L 48 65 L 53 66 L 49 70 L 50 75 L 45 72 L 40 75 L 41 70 L 37 66 L 42 65 Z" fill="#ffd43b" opacity="0.8"/>
                    <path d="M 155 120 L 157 123 L 161 124 L 158 127 L 159 131 L 155 129 L 151 131 L 152 127 L 149 124 L 153 123 Z" fill="#ff9f1c" opacity="0.8"/>
                    <circle cx="145" cy="55" r="4" fill="#0ea5e9"/>
                    <circle cx="50" cy="130" r="3" fill="#10B981"/>
                    
                    {/* Gradients */}
                    <defs>
                      <linearGradient id="phoneGrad" x1="55" y1="25" x2="145" y2="175" gradientUnits="userSpaceOnUse">
                        <stop stopColor="rgba(255,255,255,0.08)"/>
                        <stop offset="1" stopColor="rgba(255,255,255,0.02)"/>
                      </linearGradient>
                      <linearGradient id="badgeGrad" x1="68" y1="58" x2="132" y2="122" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#10B981"/>
                        <stop offset="1" stopColor="#059669"/>
                      </linearGradient>
                      <filter id="shadow" x="64" y="58" width="72" height="72" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                        <feFlood floodOpacity="0" result="BackgroundImageFix"/>
                        <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                        <feOffset dy="4"/>
                        <feGaussianBlur stdDeviation="2"/>
                        <feComposite in2="hardAlpha" operator="out"/>
                        <feColorMatrix type="matrix" values="0 0 0 0 0.0627451 0 0 0 0 0.72549 0 0 0 0 0.505882 0 0 0 0.3 0"/>
                        <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1"/>
                        <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1" result="shape"/>
                      </filter>
                    </defs>
                  </svg>
                </div>

                <div className="space-y-2">
                  <h1 className="text-4xl md:text-5xl font-black tracking-tighter leading-none">
                    Purchase <br /> <span className="text-emerald-400">Successful</span>
                  </h1>
                  <p className="text-white/40 text-sm font-medium leading-relaxed max-w-xs mx-auto">
                    Your order has been processed and your bundle is on its way to your device.
                  </p>
                </div>
              </div>

              {/* Order Info Grid */}
              <div className="px-8 pb-4">
                <div className="grid grid-cols-2 gap-px bg-white/5 rounded-3xl overflow-hidden border border-white/5">
                  {[
                    { label: "Network", value: network, icon: ShoppingBag },
                    { label: "Package", value: packageSize, icon: PackageIcon },
                    { label: "Recipient", value: customerPhone, icon: PhoneIcon },
                    { label: "Reference", value: reference.slice(0, 12).toUpperCase(), icon: ReceiptText },
                  ].map((item, i) => (
                    <div key={i} className="bg-white/[0.02] p-5 space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/20 flex items-center gap-1.5">
                        <item.icon className="w-3 h-3" /> {item.label}
                      </p>
                      <p className="text-sm font-bold text-white truncate">{item.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Section */}
              <div className="p-8 space-y-4">
                {storeUrl && (
                  <Button asChild className="w-full h-14 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black text-base shadow-xl shadow-amber-400/20 group">
                    <Link to={storeUrl}>
                      <ShoppingBag className="w-5 h-5 mr-2 group-hover:rotate-12 transition-transform" />
                      Buy Another Bundle
                    </Link>
                  </Button>
                )}

                {/* Track order — prominent, passes reference so it pre-fills */}
                <Button asChild className="w-full h-12 rounded-2xl bg-white/8 hover:bg-white/14 border border-white/10 text-white/80 hover:text-white font-bold transition-all">
                  <Link to={`/order-status?ref=${encodeURIComponent(reference)}`}>
                    <ReceiptText className="w-4 h-4 mr-2 text-sky-400" />
                    Track Your Order Live
                  </Link>
                </Button>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    onClick={copyReceipt}
                    variant="outline"
                    className={`h-12 rounded-2xl border-white/10 bg-white/5 hover:bg-white/10 font-bold transition-all ${copied ? "text-emerald-400 border-emerald-500/30" : "text-white/60"}`}
                  >
                    {copied ? <><Check className="w-4 h-4 mr-2" /> Copied</> : <><Copy className="w-4 h-4 mr-2" /> Copy Receipt</>}
                  </Button>
                  <Button asChild variant="outline" className="h-12 rounded-2xl border-white/10 bg-white/5 hover:bg-white/10 text-white/60 font-bold">
                    <Link to="/">
                      <Home className="w-4 h-4 mr-2" />
                      Home
                    </Link>
                  </Button>
                </div>

              </div>

              {/* Footer Banner */}
              <div className="bg-emerald-500/10 border-t border-white/5 py-4 px-8 text-center">
                <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Instant Delivery Active
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      <style>{`
        .purchase-success-confetti {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          overflow: hidden;
        }
        .purchase-success-confetti-piece {
          position: absolute;
          top: -20px;
          opacity: 0;
          animation: confetti-fall linear forwards;
        }
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default PurchaseSuccess;
