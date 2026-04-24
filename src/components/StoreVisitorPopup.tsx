import { useState, useEffect } from "react";
import { X, TrendingUp, Zap, ShieldCheck, Store, ArrowRight, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

interface StoreVisitorPopupProps {
  agentSlug?: string;
  showSubAgentLink?: boolean;
}

const StoreVisitorPopup = ({ agentSlug, showSubAgentLink = true }: StoreVisitorPopupProps) => {
  const { profile } = useAuth();
  const [visible, setVisible] = useState(false);

  // Never show to approved agents — they already have a store
  const isAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);

  useEffect(() => {
    if (isAgent) return;

    supabase
      .from("system_settings")
      .select("store_visitor_popup_enabled")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        const isEnabled = Boolean((data as any)?.store_visitor_popup_enabled);
        if (!isEnabled) return;
        const t = setTimeout(() => setVisible(true), 2800);
        return () => clearTimeout(t);
      });
  }, [isAgent]);

  // Dismiss only hides for this page view — popup returns on every refresh
  const dismiss = () => setVisible(false);

  if (!visible) return null;

  const ctaHref = showSubAgentLink && agentSlug ? `/store/${agentSlug}/sub-agent` : "/agent-program";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[200] bg-black/75 backdrop-blur-sm" onClick={dismiss} />

      {/* Panel */}
      <div
        className="fixed z-[201] inset-x-4 bottom-4 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[390px]"
        style={{ animation: "fade-in 0.45s cubic-bezier(0.22,1,0.36,1) both" }}
      >
        <div
          className="relative overflow-hidden rounded-3xl shadow-2xl shadow-black/60"
          style={{ background: "#080800", border: "1px solid rgba(251,191,36,0.18)" }}
        >
          {/* ── Ambient glow ── */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-12 -left-12 w-48 h-48 bg-amber-400/12 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-40 h-40 bg-amber-400/8 rounded-full blur-2xl" />
          </div>

          {/* ── Close ── */}
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-white/8 hover:bg-white/15 flex items-center justify-center text-white/40 hover:text-white transition-all"
          >
            <X className="w-4 h-4" />
          </button>

          {/* ── Hero — CSS recreation of the marketing image ── */}
          <div
            className="relative overflow-hidden mx-6 mt-6 mb-4 rounded-2xl"
            style={{ background: "#0d0d00", border: "1px solid rgba(251,191,36,0.15)", minHeight: 200 }}
          >
            {/* Diagonal yellow slash — background graphic */}
            <div
              className="absolute inset-0 pointer-events-none overflow-hidden"
              style={{ borderRadius: "inherit" }}
            >
              <div
                className="absolute"
                style={{
                  top: -40, right: -30,
                  width: 220, height: 340,
                  background: "rgba(245,158,11,0.08)",
                  transform: "rotate(-18deg)",
                  borderRadius: 40,
                }}
              />
              <div
                className="absolute"
                style={{
                  top: 10, right: -10,
                  width: 130, height: 260,
                  background: "rgba(245,158,11,0.12)",
                  transform: "rotate(-18deg)",
                  borderRadius: 30,
                }}
              />
              {/* Bottom-left dark diagonal */}
              <div
                className="absolute"
                style={{
                  bottom: -20, left: -20,
                  width: 180, height: 160,
                  background: "rgba(0,0,0,0.6)",
                  transform: "rotate(-18deg)",
                  borderRadius: 24,
                }}
              />
            </div>

            {/* Brand row */}
            <div className="relative z-10 flex items-center gap-2.5 px-5 pt-5 mb-4">
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-amber-400 flex items-center justify-center shrink-0 shadow-lg shadow-amber-400/30">
                <img src="/logo.png" alt="SwiftData Ghana" className="w-8 h-8 object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-white font-black text-base leading-none tracking-tight">SwiftData</span>
                </div>
                <p className="text-amber-400 text-[11px] font-black tracking-[0.2em] uppercase">GH</p>
              </div>
            </div>

            {/* Headline */}
            <div className="relative z-10 px-5 pb-5">
              <h2 className="font-black leading-[1.0] mb-3" style={{ fontSize: 30 }}>
                <span className="text-amber-400">Better service,</span>
                <br />
                <span className="text-white">zero stress</span>
              </h2>
              {/* Decorative lines */}
              <div className="flex gap-1.5 mb-3">
                <div className="h-[3px] w-10 bg-amber-400 rounded-full" />
                <div className="h-[3px] w-5 bg-amber-400/30 rounded-full" />
              </div>
              <p className="text-white/40 text-sm font-medium">we handle the rest</p>
            </div>

            {/* Silhouette placeholder — right side accent */}
            <div
              className="absolute bottom-0 right-0 z-0"
              style={{
                width: 110,
                height: "100%",
                background: "linear-gradient(135deg, transparent 40%, rgba(245,158,11,0.18) 100%)",
                borderRadius: "0 inherit inherit 0",
              }}
            >
              {/* Decorative circles mimicking the person shape */}
              <div
                className="absolute"
                style={{
                  bottom: 0, right: 0,
                  width: 90, height: 160,
                  background: "rgba(245,158,11,0.08)",
                  borderRadius: "50% 50% 0 0",
                }}
              />
            </div>
          </div>

          {/* "Just share your link." strip */}
          <div
            className="relative z-10 mx-6 mb-4 rounded-2xl flex items-center justify-between px-5 py-3.5"
            style={{ background: "#f59e0b" }}
          >
            <span className="font-black text-black text-sm">Just share your link.</span>
            <ArrowRight className="w-4 h-4 text-black/60" />
          </div>

          {/* ── Feature pills ── */}
          <div className="relative z-10 px-6 pb-2 grid grid-cols-3 gap-2">
            {[
              { icon: Store,       text: "Your store" },
              { icon: Zap,         text: "Instant pay" },
              { icon: ShieldCheck, text: "Auto delivery" },
            ].map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.03] border border-amber-400/10"
              >
                <Icon className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[10px] font-bold text-white/35 text-center leading-tight">{text}</span>
              </div>
            ))}
          </div>

          {/* ── CTA ── */}
          <div className="relative z-10 p-5 pt-3 space-y-2">
            <Link
              to={ctaHref}
              onClick={dismiss}
              className="w-full flex items-center justify-center gap-2 font-black text-black py-3.5 rounded-2xl text-sm transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-amber-400/25"
              style={{ background: "#f59e0b" }}
            >
              <TrendingUp className="w-4 h-4" />
              Get Your Own Store Now
            </Link>
            <button
              onClick={dismiss}
              className="w-full text-white/25 text-xs font-medium hover:text-white/50 transition-colors py-1"
            >
              Maybe later
            </button>
          </div>

          {/* ── Footer ── */}
          <div className="relative z-10 px-6 pb-4 flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-amber-400/15 border border-amber-400/25 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
            </div>
            <span className="text-white/20 text-[10px]">swiftdatagh.shop</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default StoreVisitorPopup;
