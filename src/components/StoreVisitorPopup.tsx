import { useState, useEffect } from "react";
import { X, TrendingUp, Zap, ShieldCheck, Store, ArrowRight, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";

interface StoreVisitorPopupProps {
  agentSlug?: string;
  showSubAgentLink?: boolean;
  storeName?: string;
  logoUrl?: string | null;
  primaryColor?: string;
}

const StoreVisitorPopup = ({
  agentSlug,
  showSubAgentLink = true,
  storeName = "Whitelabel Store",
  logoUrl,
  primaryColor = "#f59e0b",
}: StoreVisitorPopupProps) => {
  const { profile } = useAuth();
  const [visible, setVisible] = useState(false);

  // Never show to approved agents — they already have a store
  const isAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);

  useEffect(() => {
    if (isAgent) return;
    const hasDismissedSession = sessionStorage.getItem("store_visitor_popup_dismissed");
    if (hasDismissedSession) return;

    supabase
      .from("public_system_settings")
      .select("store_visitor_popup_enabled")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        const isEnabled = Boolean((data as any)?.store_visitor_popup_enabled);
        if (!isEnabled) return;
        // On home page, wait 15 seconds to avoid interrupting user's data package selection
        const delay = agentSlug === "home" ? 15000 : 5000;
        const t = setTimeout(() => {
          if (!sessionStorage.getItem("store_visitor_popup_dismissed")) {
            setVisible(true);
          }
        }, delay);
        return () => clearTimeout(t);
      });
  }, [isAgent, agentSlug]);

  // Dismiss hides for this session
  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem("store_visitor_popup_dismissed", "true");
  };

  const ctaHref = showSubAgentLink && agentSlug ? `/store/${agentSlug}/sub-agent` : "/agent-program";
  const hostname = window.location.hostname;

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0, scale: 0.92, y: -40 },
    visible: { 
      opacity: 1, 
      scale: 1, 
      y: 0, 
      transition: { 
        type: "spring", 
        damping: 24, 
        stiffness: 280,
        staggerChildren: 0.08,
        delayChildren: 0.05
      } 
    },
    exit: { opacity: 0, scale: 0.95, y: 20, transition: { duration: 0.2 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15, filter: "blur(4px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { type: "spring", stiffness: 300, damping: 25 } }
  };

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/75 backdrop-blur-[6px]" 
            onClick={dismiss} 
          />

          {/* Panel */}
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed z-[201] top-6 inset-x-0 flex justify-center px-4"
          >
            <div
              className="relative w-full max-w-[380px] overflow-hidden rounded-3xl shadow-2xl shadow-black/90"
              style={{ 
                background: "#08080c", 
                border: `1px solid ${primaryColor}33`,
                boxShadow: `0 24px 64px -12px ${primaryColor}22`
              }}
            >
              {/* ── Ambient glow ── */}
              <div className="absolute inset-0 pointer-events-none">
                <motion.div 
                  animate={{ opacity: [0.4, 0.7, 0.4] }}
                  transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                  className="absolute -top-12 -left-12 w-48 h-48 rounded-full blur-3xl" 
                  style={{ backgroundColor: `${primaryColor}1a` }}
                />
                <div className="absolute bottom-0 right-0 w-40 h-40 rounded-full blur-2xl" style={{ backgroundColor: `${primaryColor}0d` }} />
              </div>

              {/* ── Close ── */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={dismiss}
                className="absolute top-4 right-4 z-20 w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all border border-white/10"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </motion.button>

              {/* ── Hero ── */}
              <motion.div
                variants={itemVariants}
                className="relative overflow-hidden mx-5 mt-5 mb-3 rounded-2xl shadow-lg shadow-black/40 flex flex-col justify-center"
                style={{ 
                  background: "#0d0d12", 
                  border: `1px solid ${primaryColor}25`, 
                  minHeight: 180 
                }}
              >
                {/* Diagonal primary slash */}
                <div
                  className="absolute inset-0 pointer-events-none overflow-hidden"
                  style={{ borderRadius: "inherit" }}
                >
                  <motion.div
                    initial={{ rotate: -18, x: 50 }}
                    animate={{ rotate: -18, x: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="absolute"
                    style={{
                      top: -40, right: -30,
                      width: 220, height: 340,
                      background: `${primaryColor}0c`,
                      borderRadius: 40,
                    }}
                  />
                  <motion.div
                    initial={{ rotate: -18, x: 30 }}
                    animate={{ rotate: -18, x: 0 }}
                    transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }}
                    className="absolute"
                    style={{
                      top: 10, right: -10,
                      width: 130, height: 260,
                      background: `${primaryColor}14`,
                      borderRadius: 30,
                    }}
                  />
                  <div
                    className="absolute"
                    style={{
                      bottom: -20, left: -20,
                      width: 180, height: 160,
                      background: "rgba(0,0,0,0.7)",
                      transform: "rotate(-18deg)",
                      borderRadius: 24,
                    }}
                  />
                </div>

                {/* Brand row */}
                <div className="relative z-10 flex items-center gap-2.5 px-5 pt-4 mb-2">
                  <motion.div 
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.3 }}
                    className="w-10 h-10 rounded-xl overflow-hidden bg-white flex items-center justify-center shrink-0 shadow-md"
                    style={{ border: `1.5px solid ${primaryColor}` }}
                  >
                    {logoUrl ? (
                      <img src={logoUrl} alt={storeName} className="w-full h-full object-contain" />
                    ) : (
                      <Store className="w-5 h-5" style={{ color: primaryColor }} />
                    )}
                  </motion.div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Wifi className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                      <span className="text-white font-black text-base leading-none tracking-tight">{storeName}</span>
                    </div>
                    <p className="text-[10px] font-black tracking-[0.2em] uppercase mt-0.5" style={{ color: primaryColor }}>Reseller Node</p>
                  </div>
                </div>

                {/* Headline */}
                <div className="relative z-10 px-5 pb-5">
                  <h2 className="font-black leading-[1.0] mb-3" style={{ fontSize: 30 }}>
                    <motion.span 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 }}
                      className="inline-block"
                      style={{ color: primaryColor }}
                    >Better service,</motion.span>
                    <br />
                    <motion.span 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 }}
                      className="text-white inline-block"
                    >zero stress</motion.span>
                  </h2>
                  {/* Decorative lines */}
                  <div className="flex gap-1.5 mb-3">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: 40 }}
                      transition={{ delay: 0.6, duration: 0.4 }}
                      className="h-[3px] rounded-full" 
                      style={{ backgroundColor: primaryColor }}
                    />
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: 20 }}
                      transition={{ delay: 0.7, duration: 0.3 }}
                      className="h-[3px] rounded-full" 
                      style={{ backgroundColor: `${primaryColor}4d` }}
                    />
                  </div>
                  <p className="text-white/75 text-sm font-medium">instant digital delivery</p>
                </div>
              </motion.div>

              {/* "Just share your link." strip */}
              <motion.div
                variants={itemVariants}
                whileHover={{ scale: 1.02 }}
                onClick={() => setVisible(false)}
                className="relative z-10 mx-5 mb-3 rounded-2xl flex items-center justify-between px-5 py-3 cursor-pointer shadow-md"
                style={{ 
                  backgroundColor: primaryColor,
                  boxShadow: `0 8px 20px -6px ${primaryColor}55`
                }}
              >
                <span className="font-black text-black text-xs uppercase tracking-wider">Fast & Secure Bundles</span>
                <motion.div
                  animate={{ x: [0, 5, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                >
                  <ArrowRight className="w-4 h-4 text-black/70" />
                </motion.div>
              </motion.div>

              {/* ── Feature pills ── */}
              <motion.div variants={itemVariants} className="relative z-10 px-5 pb-2 grid grid-cols-3 gap-2">
                {[
                  { icon: Store,       text: "Official Shop" },
                  { icon: Zap,         text: "Instant Pay" },
                  { icon: ShieldCheck, text: "Auto Delivery" },
                ].map(({ icon: Icon, text }, idx) => (
                  <motion.div
                    key={text}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 + (idx * 0.1) }}
                    whileHover={{ y: -3, background: "rgba(255,255,255,0.05)" }}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/[0.03] border transition-all"
                    style={{ borderColor: `${primaryColor}1a` }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                    <span className="text-[10px] font-bold text-white/80 text-center leading-tight">{text}</span>
                  </motion.div>
                ))}
              </motion.div>

              {/* ── CTA ── */}
              <motion.div variants={itemVariants} className="relative z-10 p-5 pt-2 space-y-1.5">
                <Link
                  to={ctaHref}
                  onClick={dismiss}
                >
                  <motion.div
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="w-full flex items-center justify-center gap-2 font-black text-black py-3.5 rounded-2xl text-xs uppercase tracking-wider cursor-pointer relative overflow-hidden group shadow-lg"
                    style={{ 
                      backgroundColor: primaryColor,
                      boxShadow: `0 12px 24px -4px ${primaryColor}44`
                    }}
                  >
                    <motion.div
                      className="absolute inset-0 bg-white/20"
                      initial={{ x: "-100%" }}
                      whileHover={{ x: "100%" }}
                      transition={{ duration: 0.5 }}
                    />
                    <TrendingUp className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                    Become a Partner Agent
                  </motion.div>
                </Link>
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={dismiss}
                  className="w-full min-h-[42px] flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 text-white/85 hover:text-white text-xs font-bold transition-all py-2.5"
                >
                  Close &amp; Browse Store
                </motion.button>
              </motion.div>

              {/* ── Footer ── */}
              <motion.div variants={itemVariants} className="relative z-10 px-5 pb-4 flex items-center gap-2 justify-center border-t border-white/5 pt-3 mt-1">
                <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400" 
                  />
                </div>
                <span className="text-white/70 text-[10px] font-semibold tracking-wide">{hostname}</span>
              </motion.div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default StoreVisitorPopup;
