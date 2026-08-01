import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu, X, LogOut, LayoutDashboard, ShieldCheck,
  TrendingUp, Home, HelpCircle, ChevronRight,
  User, Settings, Wallet, ClipboardList, RotateCcw, Store, Sun, Moon, Zap, Palette, Droplets, BookOpen,
} from "lucide-react";
import { THEMES } from "@/lib/themes";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import { motion, AnimatePresence } from "framer-motion";
import { NotificationCenter } from "./NotificationCenter";
import PromoCarousel from "@/components/PromoCarousel";

const openTutorial = () => window.dispatchEvent(new CustomEvent("open-tutorial"));

const NavIcon = ({ icon: Icon, className = "" }: { icon: typeof Home; className?: string }) => (
  <Icon className={`w-4 h-4 shrink-0 ${className}`} />
);

const Navbar = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isAdmin, signOut } = useAuth();
   const { isDark, toggleDark, theme, setThemeId } = useAppTheme();
   const drawerRef = useRef<HTMLDivElement>(null);
   const themePickerRef = useRef<HTMLDivElement>(null);
   const [themePickerOpen, setThemePickerOpen] = useState(false);
   const [menuBanners, setMenuBanners] = useState<any[]>([]);
   const [bannersLoading, setBannersLoading] = useState(true);
   const [api, setApi] = useState<CarouselApi>();
   const [current, setCurrent] = useState(0);

   useEffect(() => {
     const fetchMenuBanners = async () => {
       setBannersLoading(true);
       const { data, error } = await supabase
         .from("menu_banners")
         .select("*")
         .eq("is_active", true)
         .order("priority", { ascending: false });

       if (error) console.error("[Navbar] menu_banners fetch error:", error);
       if (data) setMenuBanners(data);
       setBannersLoading(false);
     };
     fetchMenuBanners();
   }, []);

   useEffect(() => {
     if (!api) return;
     setCurrent(api.selectedScrollSnap());
     api.on("select", () => {
       setCurrent(api.selectedScrollSnap());
     });
   }, [api]);
 
   useEffect(() => { setMenuOpen(false); setThemePickerOpen(false); }, [location.pathname]);

   useEffect(() => {
     const handler = (e: MouseEvent) => {
       if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
         setThemePickerOpen(false);
       }
     };
     document.addEventListener("mousedown", handler);
     return () => document.removeEventListener("mousedown", handler);
   }, []);

  useEffect(() => {
    const onScroll = () => {
      const currentScrollY = window.scrollY;
      setScrolled(currentScrollY > 12);
      
      // Auto-hide watcher on mobile: hide when scroll down, show when scroll up
      if (window.innerWidth < 768) {
        if (currentScrollY > lastScrollY.current && currentScrollY > 80) {
          setVisible(false);
        } else {
          setVisible(true);
        }
      } else {
        setVisible(true);
      }
      
      lastScrollY.current = currentScrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate("/");
  };

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  const agentApproved = profile?.agent_approved || profile?.sub_agent_approved;

  const mainLinks = [
    { to: "/", label: "Home", icon: Home },
    { to: "/buy-data", label: "Buy Data", icon: Zap },
    { to: "/buy-airtime", label: "Buy Airtime", icon: Wallet },
    { to: "/buy-utility", label: "Buy Utility", icon: Droplets },
    { to: "/order-status", label: "Track Order", icon: LayoutDashboard },
    { to: "/blog", label: "Guides", icon: BookOpen },
    ...(!user || !agentApproved ? [{ to: "/agent-program", label: "Agent", icon: TrendingUp }] : []),
  ];

  /* ── Style tokens ── */
  const pillBg = isDark
    ? scrolled ? "rgba(7, 5, 22, 0.82)" : "rgba(9, 7, 28, 0.58)"
    : scrolled ? "rgba(248, 250, 255, 0.90)" : "rgba(252, 254, 255, 0.68)";

  const pillBorder = isDark
    ? scrolled
      ? "linear-gradient(135deg, rgba(139,92,246,0.60) 0%, rgba(251,191,36,0.50) 40%, rgba(59,130,246,0.40) 100%)"
      : "linear-gradient(135deg, rgba(139,92,246,0.35) 0%, rgba(251,191,36,0.28) 50%, rgba(59,130,246,0.22) 100%)"
    : scrolled
      ? "linear-gradient(135deg, rgba(99,102,241,0.48) 0%, rgba(251,191,36,0.38) 50%, rgba(99,102,241,0.28) 100%)"
      : "linear-gradient(135deg, rgba(99,102,241,0.28) 0%, rgba(251,191,36,0.22) 50%, rgba(99,102,241,0.15) 100%)";

  const pillGlow = isDark
    ? scrolled
      ? "0 8px 48px rgba(139,92,246,0.28), 0 4px 20px rgba(0,0,0,0.50), 0 0 80px rgba(139,92,246,0.08)"
      : "0 4px 28px rgba(139,92,246,0.14), 0 2px 10px rgba(0,0,0,0.32)"
    : scrolled
      ? "0 8px 48px rgba(99,102,241,0.20), 0 4px 18px rgba(0,0,0,0.10)"
      : "0 4px 24px rgba(99,102,241,0.12), 0 2px 8px rgba(0,0,0,0.05)";

  const innerHighlight = isDark
    ? "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 100%)"
    : "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, transparent 100%)";

  const linkIdle = isDark
    ? "text-white/50 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/[0.08]"
    : "text-gray-700 hover:text-gray-900 hover:bg-black/[0.05] border border-transparent hover:border-black/[0.07]";

  const linkActiveStyle = isDark
    ? {
        background: "linear-gradient(135deg, rgba(251,191,36,0.24) 0%, rgba(251,191,36,0.08) 100%)",
        boxShadow: "0 0 18px rgba(251,191,36,0.12), inset 0 1px 0 rgba(255,255,255,0.09)",
        borderColor: "rgba(251,191,36,0.32)",
        color: "white",
      }
    : {
        background: "linear-gradient(135deg, rgba(251,191,36,0.20) 0%, rgba(251,191,36,0.06) 100%)",
        borderColor: "rgba(251,191,36,0.35)",
        color: "#111827",
      };

  const logoText = isDark ? "text-white" : "text-gray-900";
  const dividerBg = isDark ? "bg-white/10" : "bg-black/[0.08]";

  /* ── Drawer tokens ── */
  const drawerBg     = isDark ? "rgba(8, 5, 26, 0.52)"  : "rgba(252, 253, 255, 0.85)";
  const drawerBorder = isDark ? "rgba(139,92,246,0.38)"  : "rgba(99,102,241,0.24)";
  const drawerDivider= isDark ? "rgba(139,92,246,0.16)"  : "rgba(99,102,241,0.13)";

  const drawerGlow1 = isDark
    ? "radial-gradient(ellipse at 80% 10%, rgba(139,92,246,0.26) 0%, transparent 65%)"
    : "radial-gradient(ellipse at 80% 10%, rgba(99,102,241,0.18) 0%, transparent 65%)";
  const drawerGlow2 = isDark
    ? "radial-gradient(ellipse at 20% 85%, rgba(251,191,36,0.16) 0%, transparent 60%)"
    : "radial-gradient(ellipse at 20% 85%, rgba(251,191,36,0.13) 0%, transparent 60%)";

  const drawerActiveItemStyle = isDark
    ? {
        background: "linear-gradient(135deg, rgba(251,191,36,0.24) 0%, rgba(251,191,36,0.08) 100%)",
        boxShadow: "0 0 20px rgba(251,191,36,0.12), inset 0 1px 0 rgba(255,255,255,0.08)",
        borderColor: "rgba(251,191,36,0.30)",
        color: "white",
      }
    : {
        background: "linear-gradient(135deg, rgba(251,191,36,0.20) 0%, rgba(251,191,36,0.06) 100%)",
        borderColor: "rgba(251,191,36,0.32)",
        color: "#111827",
      };

  const itemIdle   = isDark
    ? "text-white/50 hover:text-white hover:bg-white/[0.07] border border-transparent transition-all duration-150"
    : "text-gray-700 hover:text-gray-900 hover:bg-black/[0.04] border border-transparent transition-all duration-150";
  const itemActive = isDark ? "text-white border" : "text-gray-900 border";

  return (
    <>
      {/* ─────────── Floating Glass Pill ─────────── */}
      <motion.div 
        className="fixed top-3 left-0 right-0 z-50 px-3 sm:px-5 pointer-events-none"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: visible ? 0 : -85, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.2 }}
      >
        <motion.div
          className="mx-auto rounded-2xl pointer-events-auto w-full"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          animate={{
            maxWidth: scrolled ? (hovered ? "800px" : "740px") : (hovered ? "1050px" : "1024px"),
          }}
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
          style={{
            padding: "1px",
            background: pillBorder,
            boxShadow: pillGlow,
            transition: "box-shadow 350ms ease, background 350ms ease",
          }}
        >
          {/* Glass inner */}
          <nav
            className="relative rounded-[15px] overflow-hidden transition-all duration-350"
            style={{
              background: pillBg,
              backdropFilter: "blur(28px) saturate(1.9)",
              WebkitBackdropFilter: "blur(28px) saturate(1.9)",
            }}
          >
            {/* Inner top highlight */}
            <div
              className="absolute top-0 left-0 right-0 h-12 rounded-t-[15px] pointer-events-none"
              style={{ background: innerHighlight }}
            />

            <motion.div 
              className="flex items-center justify-between px-3 sm:px-4 relative"
              animate={{
                height: scrolled ? "46px" : "54px"
              }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
            >

              {/* ── Logo ── */}
              <Link to="/" className="flex items-center gap-2.5 shrink-0 group" aria-label="SwiftData Ghana">
                <motion.div 
                  className="relative"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <div
                    className="absolute inset-0 rounded-full transition-all duration-300 group-hover:scale-125"
                    style={{ background: "rgba(251,191,36,0.28)", filter: "blur(10px)", transform: "scale(1.35)" }}
                  />
                  <img
                    src="/logo.png"
                    alt="SwiftData Ghana"
                    className="w-8 h-8 rounded-full shrink-0 ring-1 ring-amber-400/35 relative z-10"
                    width={32} height={32}
                  />
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, type: "spring" }}
                    className="absolute -bottom-0.5 -right-0.5 rounded-full bg-blue-600 flex items-center justify-center border z-20"
                    style={{
                      width: "1.05rem", height: "1.05rem",
                      borderColor: isDark ? "rgba(9,7,28,0.95)" : "rgba(252,254,255,0.95)",
                      boxShadow: "0 0 8px rgba(59,130,246,0.65)",
                      borderWidth: "1.5px",
                    }}
                  >
                    <ShieldCheck className="w-2.5 h-2.5 text-white" />
                  </motion.div>
                </motion.div>
              </Link>

              {/* ── Desktop nav links ── */}
              <motion.div 
                className="hidden md:flex items-center"
                animate={{
                  gap: scrolled ? "2px" : "4px"
                }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
              >
                {mainLinks.map(({ to, label, icon }) => (
                  <Link
                    key={to} to={to}
                    className={`relative flex items-center gap-1.5 rounded-xl font-medium transition-all duration-200 ${
                      scrolled ? "px-2 py-[5px] text-xs" : "px-3 py-[7px] text-sm"
                    } ${
                      isActive(to) ? (isDark ? "text-white" : "text-gray-900") : linkIdle
                    }`}
                  >
                    {isActive(to) && (
                      <motion.div
                        layoutId="active-nav-indicator"
                        className="absolute inset-0 rounded-xl -z-10"
                        style={isDark ? {
                          background: "linear-gradient(135deg, rgba(251,191,36,0.20) 0%, rgba(251,191,36,0.06) 100%)",
                          boxShadow: "0 0 16px rgba(251,191,36,0.08), inset 0 1px 0 rgba(255,255,255,0.08)",
                          border: "1px solid rgba(251,191,36,0.25)",
                        } : {
                          background: "linear-gradient(135deg, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.04) 100%)",
                          border: "1px solid rgba(251,191,36,0.25)",
                        }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <NavIcon icon={icon} className={isActive(to) ? "text-amber-400" : ""} />
                    <span className="relative z-10">{label}</span>
                  </Link>
                ))}

                <button
                  onClick={openTutorial}
                  className={`flex items-center gap-1.5 rounded-xl font-medium transition-all duration-150 ${
                    scrolled ? "px-2 py-[5px] text-xs" : "px-3 py-[7px] text-sm"
                  } ${linkIdle}`}
                >
                  <NavIcon icon={HelpCircle} /> How It Works
                </button>

                <div className={`w-px h-4 ${dividerBg} mx-1`} />

                <NotificationCenter isDark={isDark} />

                <motion.button
                  onClick={toggleDark}
                  whileHover={{ scale: 1.1, rotate: 12 }}
                  whileTap={{ scale: 0.9 }}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdle}`}
                  title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={isDark ? "dark" : "light"}
                      initial={{ y: 10, opacity: 0, rotate: -45 }}
                      animate={{ y: 0, opacity: 1, rotate: 0 }}
                      exit={{ y: -10, opacity: 0, rotate: 45 }}
                      transition={{ duration: 0.15 }}
                    >
                      {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
                    </motion.div>
                  </AnimatePresence>
                </motion.button>

                {/* Theme colour picker */}
                <div ref={themePickerRef} className="relative">
                  <motion.button
                    type="button"
                    onClick={() => setThemePickerOpen(v => !v)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdle}`}
                    title="Change Theme"
                  >
                    <Palette className="w-3.5 h-3.5" style={{ color: theme.dot }} />
                  </motion.button>

                  <AnimatePresence>
                    {themePickerOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92, y: -6 }}
                        transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        className="absolute top-full right-0 mt-2 w-52 rounded-2xl p-3 z-[60]"
                        style={{
                          background: isDark ? "rgba(9,7,28,0.97)" : "rgba(255,255,255,0.98)",
                          backdropFilter: "blur(24px)",
                          border: isDark ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(0,0,0,0.08)",
                          boxShadow: isDark ? "0 20px 60px rgba(0,0,0,0.65)" : "0 12px 40px rgba(0,0,0,0.14)",
                        }}
                      >
                        <p className={`text-[10px] font-black uppercase tracking-widest mb-2.5 px-1 ${isDark ? "text-white/30" : "text-gray-400"}`}>
                          Choose Theme
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {THEMES.map((t) => (
                            <button
                              type="button"
                              key={t.id}
                              onClick={() => { setThemeId(t.id); setThemePickerOpen(false); }}
                              className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all ${
                                theme.id === t.id
                                  ? isDark ? "bg-white/15 ring-1 ring-white/30" : "bg-gray-100 ring-1 ring-gray-300"
                                  : isDark ? "hover:bg-white/10" : "hover:bg-gray-100"
                              }`}
                            >
                              <span className="w-6 h-6 rounded-full border border-white/20 shrink-0 block" style={{ background: t.dot }} />
                              <span className={`text-[9px] font-bold leading-none ${isDark ? "text-white/70" : "text-gray-600"}`}>{t.label}</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {user && (
                  <Link
                    to={isAdmin ? "/admin" : "/dashboard"}
                    className={`relative flex items-center gap-1.5 rounded-xl font-medium transition-all duration-200 ${
                      scrolled ? "px-2 py-[5px] text-xs" : "px-3 py-[7px] text-sm"
                    } ${
                      isActive("/dashboard") || isActive("/admin") ? (isDark ? "text-white" : "text-gray-900") : linkIdle
                    }`}
                  >
                    {(isActive("/dashboard") || isActive("/admin")) && (
                      <motion.div
                        layoutId="active-nav-indicator"
                        className="absolute inset-0 rounded-xl -z-10"
                        style={isDark ? {
                          background: "linear-gradient(135deg, rgba(251,191,36,0.20) 0%, rgba(251,191,36,0.06) 100%)",
                          boxShadow: "0 0 16px rgba(251,191,36,0.08), inset 0 1px 0 rgba(255,255,255,0.08)",
                          border: "1px solid rgba(251,191,36,0.25)",
                        } : {
                          background: "linear-gradient(135deg, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.04) 100%)",
                          border: "1px solid rgba(251,191,36,0.25)",
                        }}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <NavIcon
                      icon={isAdmin ? ShieldCheck : LayoutDashboard}
                      className={isActive("/dashboard") || isActive("/admin") ? "text-amber-400" : ""}
                    />
                    <span className="relative z-10">{isAdmin ? "Admin" : "Dashboard"}</span>
                  </Link>
                )}

                {user ? (
                  <button
                    onClick={handleSignOut}
                    className={`ml-0.5 flex items-center gap-1.5 rounded-xl font-medium transition-all duration-150 ${
                      scrolled ? "px-2 py-[5px] text-xs" : "px-3 py-[7px] text-sm"
                    } ${linkIdle}`}
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                ) : (
                  <Link to="/login">
                    <motion.div
                      className={`ml-1 flex items-center gap-1.5 text-black font-bold cursor-pointer rounded-xl ${
                        scrolled ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
                      }`}
                      whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(251,191,36,0.55)" }}
                      whileTap={{ scale: 0.96 }}
                      style={{
                        background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                        boxShadow: "0 0 22px rgba(251,191,36,0.45), 0 2px 8px rgba(245,158,11,0.30), inset 0 1px 0 rgba(255,255,255,0.35)",
                      }}
                    >
                      <Zap className="w-3.5 h-3.5" /> Get Started
                    </motion.div>
                  </Link>
                )}
              </motion.div>

              {/* ── Mobile right ── */}
              <div className="md:hidden flex items-center gap-1.5">
                <NotificationCenter isDark={isDark} />
                <motion.button
                  onClick={toggleDark}
                  whileTap={{ scale: 0.9, rotate: 15 }}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdle}`}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={isDark ? "d" : "l"}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                    >
                      {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
                    </motion.div>
                  </AnimatePresence>
                </motion.button>
                {!user && (
                  <Link to="/login">
                    <motion.div
                      whileTap={{ scale: 0.95 }}
                      className="flex items-center gap-1 text-black text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                      style={{
                        background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                        boxShadow: "0 0 12px rgba(251,191,36,0.40)",
                      }}
                    >
                      Sign In
                    </motion.div>
                  </Link>
                )}
                <motion.button
                  onClick={(e) => { setMenuOpen(true); (e.currentTarget as HTMLButtonElement).blur(); }}
                  whileTap={{ scale: 0.9 }}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    isDark
                      ? "text-white/65 hover:text-white hover:bg-white/[0.08]"
                      : "text-gray-700 hover:text-gray-900 hover:bg-black/[0.05]"
                  }`}
                  aria-label="Open menu"
                >
                  <Menu className="w-5 h-5" />
                </motion.button>
              </div>
            </motion.div>
          </nav>
        </motion.div>
      </motion.div>

      {/* ─────────── Backdrop & Drawer Animated Group ─────────── */}
      <AnimatePresence>
        {menuOpen && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              className="md:hidden fixed inset-0 z-[60]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                background: isDark ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.28)",
                backdropFilter: "blur(6px) saturate(0.75)",
                WebkitBackdropFilter: "blur(6px) saturate(0.75)",
              }}
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />

            {/* Glassmorphic side drawer */}
            <motion.div
              ref={drawerRef}
              className="md:hidden fixed top-0 right-0 h-full z-[61] w-[300px] max-w-[85vw] flex flex-col overflow-hidden"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              style={{
                background: drawerBg,
                backdropFilter: "blur(36px) saturate(2.1)",
                WebkitBackdropFilter: "blur(36px) saturate(2.1)",
                borderLeft: `1px solid ${drawerBorder}`,
                boxShadow: isDark
                  ? "-24px 0 80px rgba(0,0,0,0.60), -1px 0 0 rgba(139,92,246,0.28)"
                  : "-24px 0 64px rgba(99,102,241,0.16), -1px 0 0 rgba(99,102,241,0.20)",
              }}
            >
              {/* Ambient glow blobs */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-10 -right-10 w-52 h-52 rounded-full"
                  style={{ background: drawerGlow1, filter: "blur(36px)" }} />
                <div className="absolute bottom-20 -left-10 w-44 h-44 rounded-full"
                  style={{ background: drawerGlow2, filter: "blur(30px)" }} />
              </div>

              {/* Glass edge highlights */}
              <div className="absolute top-0 left-0 right-0 h-px pointer-events-none z-10"
                style={{ background: isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.98)" }} />
              <div className="absolute top-0 left-0 bottom-0 w-px pointer-events-none z-10"
                style={{ background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.85)" }} />

              {/* ── Header ── */}
              <div
                className="relative z-10 flex items-center justify-between px-5 h-16 shrink-0"
                style={{ borderBottom: `1px solid ${drawerDivider}` }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full blur-md"
                      style={{ background: "rgba(251,191,36,0.38)", transform: "scale(1.45)" }} />
                    <img src="/logo.png" alt="SwiftData Ghana"
                      className="w-8 h-8 rounded-full ring-1 ring-amber-400/40 relative z-10"
                      width={32} height={32} />
                  </div>
                  <div>
                    <span className={`${logoText} font-black text-sm tracking-tight block leading-tight`}>SwiftData Ghana</span>
                    <span className="text-amber-400/70 text-[9px] font-semibold tracking-wider">MENU</span>
                  </div>
                </div>
                <motion.button
                  onClick={() => setMenuOpen(false)}
                  whileTap={{ scale: 0.9 }}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                    isDark
                      ? "text-white/40 hover:text-white hover:bg-white/[0.09] border border-transparent hover:border-white/[0.09]"
                      : "text-gray-600 hover:text-gray-900 hover:bg-black/[0.05] border border-transparent hover:border-black/[0.05]"
                  }`}
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* ── Scrollable content ── */}
              <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3 py-4 pb-24 space-y-0.5">

                {/* User card */}
                {user && (
                  <motion.div
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="flex items-center gap-3 px-3 py-3 mb-3 rounded-2xl shadow-sm"
                    style={{
                      background: isDark ? "rgba(139,92,246,0.11)" : "rgba(99,102,241,0.07)",
                      border: `1px solid ${isDark ? "rgba(139,92,246,0.24)" : "rgba(99,102,241,0.18)"}`,
                      boxShadow: isDark ? "none" : "0 4px 12px rgba(0,0,0,0.04)",
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.30)" }}
                    >
                      <User className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className={`${logoText} text-sm font-bold truncate`}>{profile?.full_name || "My Account"}</p>
                      <p className={`text-xs truncate ${isDark ? "text-white/38" : "text-gray-500"}`}>
                        {profile?.store_name || (isAdmin ? "Administrator" : "Customer")}
                      </p>
                    </div>
                  </motion.div>
                )}

                <p className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 ${isDark ? "text-white/20" : "text-gray-600"}`}>
                  Explore
                </p>

                {mainLinks.map(({ to, label, icon }) => (
                  <Link
                    key={to} to={to}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive(to) ? itemActive : itemIdle
                    }`}
                    style={isActive(to) ? drawerActiveItemStyle : undefined}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all"
                      style={{
                        background: isActive(to) ? "rgba(251,191,36,0.20)" : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                        border: isActive(to) ? "1px solid rgba(251,191,36,0.28)" : "1px solid transparent",
                      }}
                    >
                      <NavIcon icon={icon} className={isActive(to) ? "text-amber-500" : isDark ? "text-white/42" : "text-gray-600"} />
                    </div>
                    {label}
                    {isActive(to) && <ChevronRight className="w-4 h-4 ml-auto text-amber-400/55" />}
                  </Link>
                ))}

                <button
                  onClick={() => { setMenuOpen(false); openTutorial(); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${itemIdle}`}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>
                    <HelpCircle className={`w-4 h-4 ${isDark ? "text-white/42" : "text-gray-400"}`} />
                  </div>
                  How It Works
                  <span className="ml-auto text-[10px] font-bold text-amber-400/80 bg-amber-400/[0.12] border border-amber-400/20 px-1.5 py-0.5 rounded-md">
                    Tutorial
                  </span>
                </button>

                {user && (
                  <>
                    <div className="h-px my-2" style={{ background: drawerDivider }} />
                    <p className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 ${isDark ? "text-white/20" : "text-gray-600"}`}>
                      Account
                    </p>
                    {[
                      { to: isAdmin ? "/admin" : "/dashboard", label: "Dashboard", icon: LayoutDashboard },
                      { to: "/dashboard/wallet", label: "Account Balance", icon: Wallet },
                      { to: "/dashboard/transactions", label: "My Transactions", icon: ClipboardList },
                      { to: "/dashboard/refunded-orders", label: "Refunded Orders", icon: RotateCcw },
                      ...(agentApproved ? [{ to: "/dashboard/my-store", label: "My Store", icon: Store }] : []),
                      { to: "/dashboard/account-settings", label: "Account Settings", icon: Settings },
                    ].map(({ to, label, icon: Icon }) => (
                      <Link
                        key={to} to={to}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${itemIdle}`}
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>
                          <Icon className={`w-4 h-4 ${isDark ? "text-white/42" : "text-gray-600"}`} />
                        </div>
                        {label}
                      </Link>
                    ))}
                  </>
                )}

                <div className="h-px my-2" style={{ background: drawerDivider }} />

                {/* Appearance section */}
                <p className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 ${isDark ? "text-white/20" : "text-gray-600"}`}>
                  Appearance
                </p>
                <div className="px-1 py-1">
                  <div className="grid grid-cols-3 gap-1.5">
                    {THEMES.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => setThemeId(t.id)}
                        className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all ${
                          theme.id === t.id
                            ? isDark ? "bg-white/15 ring-1 ring-white/30" : "bg-gray-100 ring-1 ring-gray-300"
                            : isDark ? "hover:bg-white/10" : "hover:bg-gray-100"
                        }`}
                      >
                        <span className="w-6 h-6 rounded-full border border-white/20 shrink-0 block" style={{ background: t.dot }} />
                        <span className={`text-[9px] font-bold leading-none ${isDark ? "text-white/70" : "text-gray-600"}`}>{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px my-2" style={{ background: drawerDivider }} />

                {user ? (
                  <motion.button
                    onClick={handleSignOut}
                    whileHover={{ backgroundColor: "rgba(239,68,68,0.08)" }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400/60 hover:text-red-400 transition-all"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-red-500/[0.09]">
                      <LogOut className="w-4 h-4 text-red-400/60" />
                    </div>
                    Sign Out
                  </motion.button>
                ) : (
                  <Link to="/login">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold text-black cursor-pointer"
                      style={{
                        background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                        boxShadow: "0 0 28px rgba(251,191,36,0.40), 0 2px 10px rgba(245,158,11,0.28), inset 0 1px 0 rgba(255,255,255,0.32)",
                      }}
                    >
                      <Zap className="w-4 h-4" /> Get Started — It&apos;s Free
                    </motion.div>
                  </Link>
                )}

              </div>

              {/* ── Promo Carousel ── */}
              <div className="px-3 pb-4">
                <PromoCarousel />
              </div>

              {/* ── Pinned ad banner ── */}
              {(bannersLoading || menuBanners.length > 0) && (
              <div
                className="absolute bottom-0 left-0 right-0 z-20 px-3 pb-3 pt-2"
                style={{ borderTop: `1px solid ${drawerDivider}`, background: drawerBg, backdropFilter: "blur(36px)", WebkitBackdropFilter: "blur(36px)" }}
              >
                {bannersLoading ? (
                  <div
                    className="w-full rounded-xl animate-pulse"
                    style={{ height: 68, background: "rgba(255,255,255,0.06)" }}
                  />
                ) : menuBanners.length > 0 ? (
                  <div className="relative">
                    {/* Sponsored badge */}
                    <span
                      className="absolute top-1.5 right-1.5 z-10 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md pointer-events-none"
                      style={{
                        background: "rgba(0,0,0,0.55)",
                        color: "rgba(255,255,255,0.70)",
                        backdropFilter: "blur(4px)",
                      }}
                    >
                      Sponsored
                    </span>

                    <Carousel
                      setApi={setApi}
                      plugins={[Autoplay({ delay: 4000 })]}
                      className="w-full"
                    >
                      <CarouselContent className="-ml-0">
                        {menuBanners.map((banner) => (
                          <CarouselItem
                            key={banner.id}
                            className="pl-0"
                            onClick={() => banner.target_url && navigate(banner.target_url)}
                          >
                            <div
                              className="relative overflow-hidden rounded-xl cursor-pointer active:scale-[0.98] transition-transform"
                              style={{ height: 68 }}
                            >
                              <img
                                src={banner.image_url}
                                alt="Sponsored"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                              <div
                                className="absolute inset-0 rounded-xl pointer-events-none"
                                style={{
                                  background: "linear-gradient(90deg, rgba(0,0,0,0.28) 0%, transparent 55%)",
                                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
                                }}
                              />
                            </div>
                          </CarouselItem>
                        ))}
                      </CarouselContent>
                    </Carousel>

                    {menuBanners.length > 1 && (
                      <div className="flex justify-center gap-1 mt-1.5">
                        {menuBanners.map((_, i) => (
                          <div
                            key={i}
                            className={`h-0.5 rounded-full transition-all duration-300 ${
                              current === i ? "w-3 bg-amber-500" : "w-1.5 bg-white/10"
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Navbar;
