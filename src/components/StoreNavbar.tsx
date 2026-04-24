import { useState, useEffect, useRef } from "react";
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const waHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D+/g, "")}`
    : null;

  return (
    <nav
      ref={menuRef}
      className="sticky top-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(6,6,18,0.98)" : "rgba(6,6,18,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        boxShadow: scrolled ? `0 4px 32px rgba(0,0,0,0.6), 0 0 0 1px ${networkAccent || "#f59e0b"}18` : "none",
      }}
    >
      {/* Thin accent bar */}
      <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${networkAccent}80, transparent)` }} />

      {/* ── Main bar ── */}
      <div className="container mx-auto max-w-3xl flex items-center justify-between px-4 h-14">

        {/* Left */}
        <div className="flex items-center gap-2.5 min-w-0">
          {backMode && backHref ? (
            <button
              onClick={() => navigate(backHref)}
              className="flex items-center gap-1.5 text-white/50 hover:text-white transition-colors text-sm font-medium shrink-0 mr-1"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{backLabel || "Back"}</span>
            </button>
          ) : (
            agentSlug && (
              <Link to={`/store/${agentSlug}`} className="text-white/30 hover:text-white/60 transition-colors shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            )
          )}

          <Link to={agentSlug ? `/store/${agentSlug}` : "/"} className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${networkAccent}20`, border: `1.5px solid ${networkAccent}40` }}>
                <Store className="w-4 h-4" style={{ color: networkAccent }} />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#060612] bg-green-400 animate-pulse" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="text-white font-bold text-sm leading-none truncate max-w-[130px] sm:max-w-[220px]">
                {storeName}
              </p>
              <p className="text-[10px] font-semibold mt-0.5 leading-none opacity-70" style={{ color: networkAccent }}>
                {backMode ? (stepLabel || "Sub-Agent Signup") : "Verified Data Store"}
              </p>
            </div>
          </Link>
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-1">
          {!backMode && (
            <>
              <Link to="/order-status"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white hover:bg-white/8 transition-all">
                <MapPin className="w-3.5 h-3.5" /> Track Order
              </Link>
              {showSubAgentLink && agentSlug && (
                <Link to={`/store/${agentSlug}/sub-agent`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                  style={{ color: networkAccent, background: `${networkAccent}15`, border: `1px solid ${networkAccent}30` }}>
                  <TrendingUp className="w-3.5 h-3.5" /> Become Sub-Agent
                </Link>
              )}
              <button onClick={openTutorial}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white hover:bg-white/8 transition-all">
                <HelpCircle className="w-3.5 h-3.5" /> Help
              </button>
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all hover:scale-105 active:scale-95"
                  style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
                  <MessageCircle className="w-4 h-4" /> Chat
                </a>
              )}
            </>
          )}
          {backMode && waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-white text-xs font-bold px-3 py-1.5 rounded-xl hover:scale-105 transition-all"
              style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          )}
        </div>

        {/* Mobile right */}
        <div className="md:hidden flex items-center gap-2">
          {waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg"
              style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
              <MessageCircle className="w-4 h-4" /><span className="hidden xs:inline">Chat</span>
            </a>
          )}
          {!backMode && (
            <button
              onClick={() => setOpen(!open)}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
              style={{ background: open ? `${networkAccent}20` : "rgba(255,255,255,0.06)", color: open ? networkAccent : "rgba(255,255,255,0.6)" }}
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      {!backMode && (
        <div
          className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${open ? "max-h-[640px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}
          style={{ borderTop: open ? "1px solid rgba(255,255,255,0.06)" : "none" }}
        >
          <div className="px-3 py-3" style={{ background: "rgba(5,5,15,0.99)" }}>

            {/* ── Store Hero Card ── */}
            <div className="relative rounded-2xl overflow-hidden mb-3 p-4"
              style={{ background: `linear-gradient(135deg, ${networkAccent}18, ${networkAccent}06)`, border: `1px solid ${networkAccent}25` }}>
              {/* Glow */}
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{ background: `${networkAccent}25` }} />
              <div className="relative flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg" style={{ background: `${networkAccent}25`, border: `1.5px solid ${networkAccent}50` }}>
                  <Store className="w-6 h-6" style={{ color: networkAccent }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white font-black text-base leading-none truncate">{storeName}</p>
                    <BadgeCheck className="w-4 h-4 shrink-0" style={{ color: networkAccent }} />
                  </div>
                  <p className="text-xs font-black uppercase tracking-widest mt-1" style={{ color: `${networkAccent}` }}>Official Store</p>
                </div>
              </div>
              {/* Feature pills */}
              <div className="relative flex flex-wrap gap-1.5 mt-3">
                {[
                  { icon: Zap, label: "Instant Delivery" },
                  { icon: Shield, label: "Secure Payment" },
                  { icon: Clock, label: "No Expiry" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold"
                    style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}>
                    <f.icon className="w-2.5 h-2.5" style={{ color: networkAccent }} />
                    {f.label}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Quick Actions ── */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Link to={agentSlug ? `/store/${agentSlug}` : "/"} onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 p-3 rounded-xl transition-all active:scale-95"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${networkAccent}20` }}>
                  <ShoppingBag className="w-4 h-4" style={{ color: networkAccent }} />
                </div>
                <div>
                  <p className="text-white text-xs font-bold leading-none">Buy Data</p>
                  <p className="text-white/40 text-[10px] mt-0.5">Browse bundles</p>
                </div>
              </Link>

              <Link to="/order-status" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 p-3 rounded-xl transition-all active:scale-95"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-500/20">
                  <MapPin className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-white text-xs font-bold leading-none">Track Order</p>
                  <p className="text-white/40 text-[10px] mt-0.5">Check status</p>
                </div>
              </Link>
            </div>

            {/* ── Become Sub-Agent CTA ── */}
            {showSubAgentLink && agentSlug && (
              <Link
                to={`/store/${agentSlug}/sub-agent`}
                onClick={() => setOpen(false)}
                className="relative flex items-center gap-3 p-4 rounded-2xl mb-3 overflow-hidden group transition-all active:scale-[0.98]"
                style={{ background: `linear-gradient(135deg, ${networkAccent}22, ${networkAccent}08)`, border: `1px solid ${networkAccent}35` }}
              >
                <div className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-40" style={{ background: networkAccent }} />
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${networkAccent}30`, border: `1px solid ${networkAccent}50` }}>
                  <TrendingUp className="w-5 h-5" style={{ color: networkAccent }} />
                </div>
                <div className="flex-1 min-w-0 relative">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-white font-black text-sm leading-none">Become a Sub-Agent</p>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full text-black" style={{ background: networkAccent }}>EARN</span>
                  </div>
                  <p className="text-white/50 text-xs">Resell data & earn daily profit from your own store</p>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0 relative" style={{ color: networkAccent }} />
              </Link>
            )}

            {/* ── Networks Available ── */}
            <div className="flex gap-2 mb-3">
              {Object.entries(NETWORK_COLORS).map(([net, style]) => (
                <div key={net} className="flex-1 flex flex-col items-center gap-1 p-2 rounded-xl text-center"
                  style={{ background: style.bg, border: `1px solid ${style.dot}25` }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: style.dot }} />
                  <p className="text-[10px] font-bold" style={{ color: style.text }}>{net}</p>
                </div>
              ))}
            </div>

            {/* ── How it works / Tutorial ── */}
            <button
              onClick={() => { setOpen(false); openTutorial(); }}
              className="w-full flex items-center gap-3 p-3 rounded-xl mb-3 transition-all active:scale-[0.98]"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.20)" }}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-400/15">
                <Sparkles className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-white">How It Works</p>
                <p className="text-[10px] text-white/40">Watch the step-by-step tutorial</p>
              </div>
              <span className="ml-auto text-[10px] font-black text-amber-400 bg-amber-400/15 px-2 py-0.5 rounded-full">Tutorial</span>
            </button>

            {/* ── Contact section ── */}
            {(waHref || whatsappGroupLink || supportNumber) && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-white/8" />
                  <p className="text-white/25 text-[10px] font-bold uppercase tracking-widest">Contact Store</p>
                  <div className="flex-1 h-px bg-white/8" />
                </div>

                <div className="space-y-1.5">
                  {waHref && (
                    <a href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
                      style={{ background: "rgba(37,211,102,0.1)", border: "1px solid rgba(37,211,102,0.2)" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(37,211,102,0.18)" }}>
                        <MessageCircle className="w-4 h-4 text-[#25D366]" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">WhatsApp Chat</p>
                        <p className="text-[10px] text-white/40">Get instant support</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-[#25D366]/50 ml-auto" />
                    </a>
                  )}

                  {whatsappGroupLink && (
                    <a href={whatsappGroupLink} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.98]"
                      style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.12)" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(37,211,102,0.12)" }}>
                        <Users className="w-4 h-4 text-[#25D366]" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">WhatsApp Group</p>
                        <p className="text-[10px] text-white/40">Join the community</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-[#25D366]/50 ml-auto" />
                    </a>
                  )}

                  {supportNumber && (
                    <a href={`tel:${supportNumber.replace(/\D+/g, "")}`} onClick={() => setOpen(false)}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/8 transition-all active:scale-[0.98]">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/15">
                        <Phone className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Call Support</p>
                        <p className="text-[10px] text-white/40 font-mono">{supportNumber}</p>
                      </div>
                    </a>
                  )}
                </div>
              </>
            )}

            <div className="flex items-center justify-center gap-1.5 pt-3 mt-2 border-t border-white/6">
              <Zap className="w-2.5 h-2.5 text-emerald-400" />
              <span className="text-white/20 text-[10px] font-black uppercase tracking-widest">Verified Digital Platform</span>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default StoreNavbar;
