import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu, X, ArrowLeft, MapPin, Users, TrendingUp,
  Phone, MessageCircle, Store,
  ShoppingBag, Zap, HelpCircle, BadgeCheck,
  Sparkles, Clock, Shield, ChevronRight,
} from "lucide-react";

const openTutorial = () => window.dispatchEvent(new CustomEvent("open-tutorial"));


const NETWORK_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  MTN:        { bg: "rgba(255,204,0,0.15)", text: "#FFCC00", dot: "#FFCC00" },
  Telecel:    { bg: "rgba(230,0,0,0.15)",  text: "#E60000", dot: "#E60000" },
  AirtelTigo: { bg: "rgba(0,82,155,0.15)", text: "#00529B", dot: "#00529B" },
};

export interface StoreNavbarProps {
  storeName: string;
  agentSlug?: string;
  networkAccent?: string;
  whatsappNumber?: string;
  whatsappGroupLink?: string;
  supportNumber?: string;
  email?: string;
  showSubAgentLink?: boolean;
  backMode?: boolean;
  backLabel?: string;
  backHref?: string;
  stepLabel?: string;
  logoUrl?: string;
  onOpenAuth?: () => void;
  customerBalance?: number | null;
  isCustomerLoggedIn?: boolean;
  customerName?: string | null;
  onSignOut?: () => void;
}

const StoreNavbar = ({
  storeName,
  agentSlug,
  networkAccent = "#f59e0b",
  whatsappNumber,
  whatsappGroupLink,
  supportNumber,
  email,
  showSubAgentLink = false,
  backMode = false,
  backLabel,
  backHref,
  stepLabel,
  logoUrl,
  onOpenAuth,
  customerBalance,
  isCustomerLoggedIn = false,
  customerName,
  onSignOut,
}: StoreNavbarProps) => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll when side drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const waHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D+/g, "")}`
    : null;

  return (
    <nav
      ref={menuRef}
      className="sticky top-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.88)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        borderBottom: "1px solid rgba(15,23,42,0.08)",
        boxShadow: scrolled ? `0 12px 32px -14px rgba(15,23,42,0.25), 0 0 0 1px ${networkAccent || "#f59e0b"}20` : "none",
      }}
    >
      {/* Thin ambient gradient accent bar */}
      <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${networkAccent}, transparent)` }} />

      {/* ── Main bar ── */}
      <div className="container mx-auto max-w-4xl flex items-center justify-between px-4 h-16">

        {/* Left */}
        <div className="flex items-center gap-3 min-w-0">
          {backMode && backHref ? (
            <button
              onClick={() => navigate(backHref)}
              className="flex items-center gap-1.5 text-slate-400 hover:text-slate-900 transition-colors text-sm font-medium shrink-0 mr-1"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{backLabel || "Back"}</span>
            </button>
          ) : (
            agentSlug && (
              <Link to={`/store/${agentSlug}`} className="text-slate-300 hover:text-slate-600 transition-colors shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            )
          )}

          <Link to={agentSlug ? `/store/${agentSlug}` : "/"} className="flex items-center gap-3 min-w-0 group">
            <div className="relative shrink-0">
              <div 
                className="w-9 h-9 rounded-2xl flex items-center justify-center overflow-hidden transition-transform duration-300 group-hover:scale-105 shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
                style={{ 
                  background: logoUrl ? 'white' : `${networkAccent}18`, 
                  border: `1px solid ${networkAccent}40` 
                }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt={storeName} className="w-full h-full object-contain" />
                ) : (
                  <Store className="w-4.5 h-4.5" style={{ color: networkAccent }} />
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="text-slate-900 font-black text-sm tracking-tight truncate max-w-[140px] sm:max-w-[240px] group-hover:text-amber-600 transition-colors">
                {storeName}
              </p>
              <p className="text-[10px] font-extrabold uppercase tracking-widest mt-0.5 leading-none opacity-80" style={{ color: networkAccent }}>
                {backMode ? (stepLabel || "Sub-Agent Signup") : "Verified Data Store"}
              </p>
            </div>
          </Link>
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-2.5">
          {!backMode && (
            <>
              {isCustomerLoggedIn ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-2xl px-3.5 py-1.5 shrink-0">
                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Wallet:</span>
                    <span className="text-xs font-mono font-black text-emerald-600">GHS {Number(customerBalance || 0).toFixed(2)}</span>
                  </div>
                  <button
                    onClick={onSignOut}
                    className="text-xs font-black text-red-500/80 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-xl transition-all"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenAuth}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-black transition-all duration-300 active:scale-95 border-0 hover:brightness-110 shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
                  style={{ 
                    background: `linear-gradient(135deg, ${networkAccent}, ${networkAccent}dd)`,
                    color: "#000000",
                    boxShadow: `0 4px 18px ${networkAccent}35`
                  }}
                >
                  Sign In / Register
                </button>
              )}

              <Link to={agentSlug ? `/store/${agentSlug}/order-status` : "/order-status"}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all border border-transparent hover:border-slate-200">
                <MapPin className="w-3.5 h-3.5 text-slate-400" /> Track Order
              </Link>
              {showSubAgentLink && agentSlug && (
                <Link to={`/store/${agentSlug}/sub-agent`}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold transition-all hover:scale-105"
                  style={{ color: networkAccent, background: `${networkAccent}12`, border: `1px solid ${networkAccent}30` }}>
                  <TrendingUp className="w-3.5 h-3.5" /> Become Sub-Agent
                </Link>
              )}
              <button onClick={openTutorial}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all">
                <HelpCircle className="w-3.5 h-3.5 text-slate-400" /> Help
              </button>
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-white text-xs font-black px-4 py-2 rounded-2xl transition-all duration-300 hover:scale-105 active:scale-95 shadow-[0_4px_18px_rgba(37,211,102,0.3)]"
                  style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
                  <MessageCircle className="w-4 h-4 fill-black/20" /> Chat
                </a>
              )}
            </>
          )}
          {backMode && waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-white text-xs font-bold px-4 py-2 rounded-2xl hover:scale-105 transition-all shadow-[0_4px_18px_rgba(37,211,102,0.3)]"
              style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          )}
        </div>
        {/* Mobile right */}
        <div className="md:hidden flex items-center gap-2">
          {isCustomerLoggedIn && (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 shrink-0">
              <span className="text-[8px] text-slate-400 font-black uppercase">Bal:</span>
              <span className="text-[10px] font-black text-slate-900">GHS {Number(customerBalance || 0).toFixed(0)}</span>
            </div>
          )}
          {waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shrink-0"
              style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
              <MessageCircle className="w-4 h-4" /><span className="hidden xs:inline">Chat</span>
            </a>
          )}
          {!backMode && (
            <button
              onClick={() => setOpen(true)}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Premium Side Drawer & Backdrop ── */}
      {!backMode && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 z-[99998] bg-black/75 backdrop-blur-[3px] transition-all duration-300 ${
              open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
            onClick={() => setOpen(false)}
          />

          {/* Sidebar Drawer */}
          <div
            className="fixed top-0 right-0 bottom-0 h-full w-[290px] sm:w-[320px] z-[99999] shadow-[0_0_50px_rgba(0,0,0,0.85)] border-l border-white/8 transition-transform duration-300 ease-out flex flex-col overflow-y-auto"
            style={{
              transform: open ? "translateX(0)" : "translateX(100%)",
              background: "rgba(5,5,15,0.98)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            {/* Top row with Store Name and Close button */}
            <div className="flex items-center justify-between p-4 border-b border-white/6 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden shrink-0" style={{ background: logoUrl ? 'white' : `${networkAccent}20`, border: `1px solid ${networkAccent}30` }}>
                  {logoUrl ? (
                    <img src={logoUrl} alt={storeName} className="w-full h-full object-contain" />
                  ) : (
                    <Store className="w-3.5 h-3.5" style={{ color: networkAccent }} />
                  )}
                </div>
                <span className="text-white font-bold text-xs leading-none truncate max-w-[130px]">
                  {storeName}
                </span>
              </div>
              
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable content body */}
            <div className="flex-1 px-3.5 py-4 space-y-4">
              {/* ── Customer Account Card (Mobile Drawer) ── */}
              {isCustomerLoggedIn ? (
                <div className="bg-white/5 border border-white/8 rounded-2xl p-4">
                  <p className="text-[9px] font-black text-white/30 uppercase tracking-widest">Active Customer Session</p>
                  <p className="text-white text-sm font-black mt-0.5 truncate">{customerName || "Customer Account"}</p>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                    <div>
                      <p className="text-[9px] text-white/40 font-bold uppercase">Store Wallet Balance</p>
                      <p className="text-base font-black text-white">GHS {Number(customerBalance || 0).toFixed(2)}</p>
                    </div>
                    <button 
                      onClick={() => { setOpen(false); onSignOut?.(); }} 
                      className="text-xs font-black text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl transition-all"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setOpen(false); onOpenAuth?.(); }}
                  className="w-full h-11 flex items-center justify-center gap-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border-0 hover:brightness-110 shrink-0"
                  style={{ backgroundColor: networkAccent, color: "#000000" }}
                >
                  <Users className="w-4 h-4" />
                  <span>Customer Sign In</span>
                </button>
              )}

              {/* ── Store Hero Card ── */}
              <div className="relative rounded-2xl overflow-hidden p-4"
                style={{ background: `linear-gradient(135deg, ${networkAccent}18, ${networkAccent}06)`, border: `1.5px solid ${networkAccent}25` }}>
                <div className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl pointer-events-none" style={{ background: `${networkAccent}20` }} />
                <div className="relative flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg overflow-hidden" style={{ background: logoUrl ? 'white' : `${networkAccent}25`, border: `1px solid ${networkAccent}50` }}>
                    {logoUrl ? (
                      <img src={logoUrl} alt={storeName} className="w-full h-full object-contain" />
                    ) : (
                      <Store className="w-5 h-5" style={{ color: networkAccent }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-white font-black text-sm leading-none truncate">{storeName}</p>
                      <BadgeCheck className="w-3.5 h-3.5 shrink-0" style={{ color: networkAccent }} />
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-widest mt-1" style={{ color: networkAccent }}>Official Reseller</p>
                  </div>
                </div>
                {/* Feature pills */}
                <div className="relative flex flex-wrap gap-1 mt-3">
                  {[
                    { icon: Zap, label: "Instant" },
                    { icon: Shield, label: "Secure" },
                    { icon: Clock, label: "No Expiry" },
                  ].map((f) => (
                    <div key={f.label} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}>
                      <f.icon className="w-2 h-2" style={{ color: networkAccent }} />
                      {f.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Quick Actions ── */}
              <div className="grid grid-cols-2 gap-2">
                <Link to={agentSlug ? `/store/${agentSlug}` : "/"} onClick={() => setOpen(false)}
                  className="flex flex-col items-start gap-1 p-3 rounded-xl transition-all active:scale-95"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${networkAccent}15` }}>
                    <ShoppingBag className="w-3.5 h-3.5" style={{ color: networkAccent }} />
                  </div>
                  <div className="mt-1">
                    <p className="text-white text-xs font-bold leading-none">Buy Data</p>
                    <p className="text-white/40 text-[9px] mt-0.5">Shop bundles</p>
                  </div>
                </Link>

                <Link to={agentSlug ? `/store/${agentSlug}/order-status` : "/order-status"} onClick={() => setOpen(false)}
                  className="flex flex-col items-start gap-1 p-3 rounded-xl transition-all active:scale-95"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10">
                    <MapPin className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <div className="mt-1">
                    <p className="text-white text-xs font-bold leading-none">Track Order</p>
                    <p className="text-white/40 text-[9px] mt-0.5">Check status</p>
                  </div>
                </Link>
              </div>

              {/* ── Become Sub-Agent CTA ── */}
              {showSubAgentLink && agentSlug && (
                <Link
                  to={`/store/${agentSlug}/sub-agent`}
                  onClick={() => setOpen(false)}
                  className="relative flex items-center gap-3 p-3.5 rounded-xl overflow-hidden group transition-all active:scale-[0.98]"
                  style={{ background: `linear-gradient(135deg, ${networkAccent}18, ${networkAccent}06)`, border: `1px solid ${networkAccent}25` }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${networkAccent}20`, border: `1px solid ${networkAccent}30` }}>
                    <TrendingUp className="w-4 h-4" style={{ color: networkAccent }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-white font-black text-xs leading-none">Become Sub-Agent</p>
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full text-black leading-none" style={{ backgroundColor: networkAccent }}>EARN</span>
                    </div>
                    <p className="text-white/40 text-[10px]">Launch reseller shop</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: networkAccent }} />
                </Link>
              )}

              {/* ── How it works / Tutorial ── */}
              <button
                onClick={() => { setOpen(false); openTutorial(); }}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
                style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-400/10">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="text-xs font-bold text-white">How It Works</p>
                  <p className="text-[9px] text-white/40">Watch tutorial guide</p>
                </div>
                <span className="text-[8px] font-black text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full shrink-0">Help</span>
              </button>

              {/* ── Contact section ── */}
              {(waHref || whatsappGroupLink || supportNumber) && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-white/6" />
                    <p className="text-white/20 text-[9px] font-bold uppercase tracking-widest shrink-0">Support Desk</p>
                    <div className="flex-1 h-px bg-white/6" />
                  </div>

                  <div className="space-y-2">
                    {waHref && (
                      <a href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                        className="flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
                        style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.12)" }}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(37,211,102,0.12)" }}>
                          <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold text-white">WhatsApp Chat</p>
                          <p className="text-[9px] text-white/40">Instant support chat</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-[#25D366]/40 ml-auto" />
                      </a>
                    )}

                    {whatsappGroupLink && (
                      <a href={whatsappGroupLink} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                        className="flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
                        style={{ background: "rgba(37,211,102,0.03)", border: "1px solid rgba(37,211,102,0.08)" }}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(37,211,102,0.08)" }}>
                          <Users className="w-3.5 h-3.5 text-[#25D366]" />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold text-white">Join Community</p>
                          <p className="text-[9px] text-white/40">Updates & details</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-[#25D366]/40 ml-auto" />
                      </a>
                    )}

                    {supportNumber && (
                      <a href={`tel:${supportNumber.replace(/\D+/g, "")}`} onClick={() => setOpen(false)}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/6 transition-all active:scale-[0.98]">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10">
                          <Phone className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold text-white">Call Support</p>
                          <p className="text-[9px] text-white/40 font-mono">{supportNumber}</p>
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom brand footer */}
            <div className="p-4 border-t border-white/6 flex items-center justify-center gap-1.5 shrink-0 bg-black/20">
              <Zap className="w-3 h-3 text-emerald-400" />
              <span className="text-white/20 text-[9px] font-black uppercase tracking-widest">Verified Digital Store</span>
            </div>
          </div>
        </>
      , document.body)}
    </nav>
  );
};

export default StoreNavbar;
