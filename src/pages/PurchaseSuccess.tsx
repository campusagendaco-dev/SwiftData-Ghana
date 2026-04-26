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
      "  swiftdataghana.com",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
              <div className="pt-12 pb-8 px-8 text-center space-y-6">
                <div className="relative mx-auto w-24 h-24">
                  <div className="absolute inset-0 bg-emerald-500 rounded-full blur-2xl opacity-20 animate-pulse" />
                  <div className="relative w-full h-full rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_50px_rgba(16,185,129,0.3)]">
                    <CheckCircle2 className="w-12 h-12 text-white" />
                  </div>
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

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    onClick={copyReceipt}
                    variant="outline"
                    className={`h-12 rounded-2xl border-white/10 bg-white/5 hover:bg-white/10 font-bold transition-all ${copied ? "text-emerald-400 border-emerald-500/30" : "text-white/60"}`}
                  >
                    {copied ? <><Check className="w-4 h-4 mr-2" /> Copied</> : <><Copy className="w-4 h-4 mr-2" /> Copy Receipt</>}
                  </Button>
                  <Button asChild variant="outline" className="h-12 rounded-2xl border-white/10 bg-white/5 hover:bg-white/10 text-white/60 font-bold">
                    <Link to="/order-status">
                      <ReceiptText className="w-4 h-4 mr-2" />
                      Track Live
                    </Link>
                  </Button>
                </div>

                <div className="flex items-center justify-center pt-4">
                  <Link to="/" className="text-xs font-bold text-white/20 hover:text-white/60 transition-colors uppercase tracking-widest flex items-center gap-2">
                    <Home className="w-3.5 h-3.5" /> Back to Homepage
                  </Link>
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
