import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu, X, LogOut, LayoutDashboard, ShieldCheck,
  TrendingUp, Home, HelpCircle, ChevronRight,
  Users, Settings, Wallet, ClipboardList, RotateCcw, Store, Sun, Moon, Zap, BookOpen,
  Smartphone, PackageSearch, Check, ArrowRight, LogIn, Gamepad2, ChevronDown,
} from "lucide-react";
import { THEMES } from "@/lib/themes";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { motion, AnimatePresence } from "framer-motion";
import { NotificationCenter } from "./NotificationCenter";

const openTutorial = () => window.dispatchEvent(new CustomEvent("open-tutorial"));

const NavIcon = ({ icon: Icon, className = "" }: { icon: typeof Home; className?: string }) => (
  <Icon className={`w-4 h-4 shrink-0 ${className}`} />
);

const initialsOf = (name?: string | null) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SD";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};

const DrawerGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <p className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
    <div className="rounded-2xl border border-border/70 dark:border-white/[0.08] bg-card/70 overflow-hidden divide-y divide-border/60 dark:divide-white/[0.06]">
      {children}
    </div>
  </div>
);

const DrawerRow = ({
  to, onClick, label, icon: Icon, active, trailing,
}: {
  to?: string;
  onClick?: () => void;
  label: string;
  icon: typeof Home;
  active?: boolean;
  trailing?: ReactNode;
}) => {
  const body = (
    <>
      <span className={`h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className={`flex-1 min-w-0 truncate text-[14px] ${active ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>{label}</span>
      {trailing ?? <ChevronRight className={`w-4 h-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground/50"}`} />}
    </>
  );
  const cls = `w-full flex items-center gap-3 px-3 h-12 text-left transition-colors hover:bg-muted/60 active:bg-muted ${active ? "bg-primary/[0.06]" : ""}`;
  return to ? (
    <Link to={to} className={cls} aria-current={active ? "page" : undefined}>{body}</Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>{body}</button>
  );
};

export type NavLinkConfig = { to: string; label: string; icon: typeof Home };

export const PRIMARY_NAV_LINKS: NavLinkConfig[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/buy-data", label: "Buy Data", icon: Zap },
  { to: "/buy-airtime", label: "Airtime", icon: Smartphone },
  { to: "/order-status", label: "Track", icon: PackageSearch },
  { to: "/challenges", label: "Games", icon: Gamepad2 },
];

export const getMoreNavLinks = (showAgent: boolean): NavLinkConfig[] => [
  { to: "/submit-numbers", label: "Verify & Submit", icon: ShieldCheck },
  { to: "/blog", label: "Guides", icon: BookOpen },
  ...(showAgent ? [{ to: "/agent-program", label: "Become an Agent", icon: TrendingUp }] : []),
];

const navItemClass = (compact: boolean) =>
  `relative flex items-center gap-1.5 rounded-xl font-medium whitespace-nowrap transition-all duration-200 ${
    compact ? "px-2.5 py-[5px] text-[13px]" : "px-3 py-[7px] text-sm"
  }`;

const menuItemClass = "rounded-xl h-10 px-2.5 gap-2.5 cursor-pointer";

const ActiveNavIndicator = ({ isDark }: { isDark: boolean }) => (
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
);

const DesktopNavLink = ({
  to, label, icon, active, compact, isDark, idleClass,
}: NavLinkConfig & { active: boolean; compact: boolean; isDark: boolean; idleClass: string }) => (
  <Link
    to={to}
    aria-current={active ? "page" : undefined}
    className={`${navItemClass(compact)} ${active ? (isDark ? "text-white" : "text-gray-900") : idleClass}`}
  >
    {active && <ActiveNavIndicator isDark={isDark} />}
    <NavIcon icon={icon} className={active ? "text-amber-400" : ""} />
    <span className="relative z-10">{label}</span>
  </Link>
);

const GoldNavLink = ({ to, label, icon: Icon, compact }: NavLinkConfig & { compact: boolean }) => (
  <Link to={to}>
    <motion.div
      className={`flex items-center gap-1.5 text-black font-black whitespace-nowrap cursor-pointer rounded-xl ${
        compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
      }`}
      whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(251,191,36,0.55)" }}
      whileTap={{ scale: 0.96 }}
      style={{
        background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
        boxShadow: "0 0 22px rgba(251,191,36,0.45), 0 2px 8px rgba(245,158,11,0.30), inset 0 1px 0 rgba(255,255,255,0.35)",
      }}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </motion.div>
  </Link>
);

const AppearanceControls = () => {
  const { isDark, toggleDark, theme, setThemeId } = useAppTheme();
  return (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Mode">
        {[
          { dark: false, label: "Light", icon: Sun },
          { dark: true, label: "Dark", icon: Moon },
        ].map(({ dark, label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={isDark === dark}
            onClick={() => { if (isDark !== dark) toggleDark(); }}
            className={`h-9 rounded-lg text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition ${
              isDark === dark ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-medium text-muted-foreground">Colour</span>
          <span className="text-xs font-semibold text-foreground truncate max-w-[65%]">{theme.label}</span>
        </div>
        <div className="grid grid-cols-7 gap-2" role="radiogroup" aria-label="Colour theme">
          {THEMES.map((t) => {
            const selected = theme.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t.label}
                title={t.label}
                onClick={() => setThemeId(t.id)}
                className={`relative aspect-square w-full rounded-full transition active:scale-90 ring-offset-2 ring-offset-card shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] ${
                  selected ? "ring-2 ring-foreground/70" : "hover:scale-105"
                }`}
                style={{ background: t.dot }}
              >
                {selected && <Check className="absolute inset-0 m-auto w-3.5 h-3.5 text-white drop-shadow" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};

const DesktopAccountMenu = ({ onSignOut, agentApproved }: { onSignOut: () => void; agentApproved: boolean }) => {
  const { profile, isAdmin, openAccountSwitcher, savedAccounts } = useAuth();
  const links: NavLinkConfig[] = [
    { to: "/dashboard/wallet", label: "Wallet", icon: Wallet },
    { to: "/dashboard/transactions", label: "Transactions", icon: ClipboardList },
    ...(agentApproved ? [{ to: "/dashboard/my-store", label: "My store", icon: Store }] : []),
    { to: "/dashboard/account-settings", label: "Settings", icon: Settings },
  ];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex items-center gap-1 h-9 pl-0.5 pr-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <span className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-black flex items-center justify-center text-xs font-black">
            {initialsOf(profile?.full_name)}
          </span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={12} className="w-60 rounded-2xl p-1.5">
        <DropdownMenuLabel className="px-2.5 py-2 font-normal">
          <p className="text-sm font-semibold text-foreground truncate">{profile?.full_name || "My account"}</p>
          <p className="text-xs text-muted-foreground truncate">
            {isAdmin ? "Administrator" : profile?.store_name || (agentApproved ? "Agent" : "Customer")}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.map(({ to, label, icon: Icon }) => (
          <DropdownMenuItem key={to} asChild className={menuItemClass}>
            <Link to={to}>
              <Icon className="w-4 h-4 text-muted-foreground" /> {label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem className={menuItemClass} onSelect={openAccountSwitcher}>
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="flex-1">Switch account</span>
          {savedAccounts.length > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">{savedAccounts.length} saved</span>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={`${menuItemClass} text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-400`}
          onSelect={onSignOut}
        >
          <LogOut className="w-4 h-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};


const Navbar = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isAdmin, signOut, openAccountSwitcher, savedAccounts } = useAuth();
   const { isDark } = useAppTheme();
   const drawerRef = useRef<HTMLDivElement>(null);
   const [menuBanners, setMenuBanners] = useState<any[]>([]);
   const [bannersLoading, setBannersLoading] = useState(false);
   const [api, setApi] = useState<CarouselApi>();
   const [current, setCurrent] = useState(0);

   useEffect(() => {
     if (!menuOpen || menuBanners.length > 0) return;
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
   }, [menuOpen, menuBanners.length]);

   useEffect(() => {
     if (!api) return;
     setCurrent(api.selectedScrollSnap());
     api.on("select", () => {
       setCurrent(api.selectedScrollSnap());
     });
   }, [api]);
 
   useEffect(() => { setMenuOpen(false); }, [location.pathname]);

   useEffect(() => {
     if (!menuOpen) return;
     const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
     window.addEventListener("keydown", onKey);
     return () => window.removeEventListener("keydown", onKey);
   }, [menuOpen]);

  useEffect(() => {
    const onScroll = () => {
      const currentScrollY = window.scrollY;
      setScrolled(currentScrollY > 12);
      
      // Auto-hide watcher on mobile: hide when scroll down, show when scroll up
      if (window.innerWidth < 1024) {
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
    if (menuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate("/");
  };

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  const agentApproved = profile?.agent_approved || profile?.sub_agent_approved;

  const moreLinks = getMoreNavLinks(!user || !agentApproved);
  const moreActive = moreLinks.some((link) => isActive(link.to));

  /* ── Mobile drawer content ── */
  const quickActions = [
    { to: "/buy-data", label: "Buy data", hint: "All networks", icon: Zap, tone: "bg-amber-400/15 text-amber-600 dark:text-amber-400" },
    { to: "/buy-airtime", label: "Buy airtime", hint: "Instant top-up", icon: Smartphone, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
    { to: "/order-status", label: "Track order", hint: "Live status", icon: PackageSearch, tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    { to: "/submit-numbers", label: "Verify number", hint: "Check & submit", icon: ShieldCheck, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  ];
  const exploreLinks = [
    { to: "/", label: "Home", icon: Home },
    { to: "/challenges", label: "Game challenges", icon: Gamepad2 },
    { to: "/blog", label: "Guides", icon: BookOpen },
    ...(!user || !agentApproved ? [{ to: "/agent-program", label: "Become an agent", icon: TrendingUp }] : []),
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

  return (
    <>
      {/* ─────────── Floating Glass Pill ─────────── */}
      <motion.div 
        className="fixed top-3 left-0 right-0 z-50 px-3 sm:px-5 pointer-events-none"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: visible ? 0 : -85, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.2 }}
      >
        <div
          className="mx-auto rounded-2xl pointer-events-auto w-full max-w-6xl"
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
                  <picture className="relative z-10">
                    <source srcSet="/logo.webp" type="image/webp" />
                    <img
                      src="/logo.png"
                      alt="SwiftData Ghana"
                      className="w-8 h-8 rounded-full shrink-0 ring-1 ring-amber-400/35 relative z-10"
                      width={32}
                      height={32}
                    />
                  </picture>
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
                <span className="text-[15px] font-black tracking-tight whitespace-nowrap text-foreground">SwiftData</span>
              </Link>

              {/* ── Desktop links ── */}
              <div className="hidden lg:flex items-center gap-0.5 min-w-0">
                {PRIMARY_NAV_LINKS.map((link) => (
                  <DesktopNavLink
                    key={link.to}
                    {...link}
                    active={isActive(link.to)}
                    compact={scrolled}
                    isDark={isDark}
                    idleClass={linkIdle}
                  />
                ))}

                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={`${navItemClass(scrolled)} ${moreActive ? (isDark ? "text-white" : "text-gray-900") : linkIdle}`}
                    >
                      {moreActive && <ActiveNavIndicator isDark={isDark} />}
                      <span className="relative z-10">More</span>
                      <ChevronDown className="w-3.5 h-3.5 relative z-10" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" sideOffset={12} className="w-56 rounded-2xl p-1.5">
                    {moreLinks.map(({ to, label, icon: Icon }) => (
                      <DropdownMenuItem key={to} asChild className={`${menuItemClass} ${isActive(to) ? "bg-primary/10" : ""}`}>
                        <Link to={to}>
                          <Icon className={`w-4 h-4 ${isActive(to) ? "text-primary" : "text-muted-foreground"}`} /> {label}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem className={menuItemClass} onSelect={openTutorial}>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" /> How It Works
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* ── Desktop actions ── */}
              <div className="hidden lg:flex items-center gap-1.5 shrink-0">
                <NotificationCenter isDark={isDark} />

                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={`w-9 h-9 min-w-[36px] min-h-[36px] rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdle}`}
                      title="Appearance"
                      aria-label="Appearance"
                    >
                      {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={12} className="w-72 rounded-2xl p-3 space-y-3">
                    <AppearanceControls />
                  </PopoverContent>
                </Popover>

                {user ? (
                  <>
                    <GoldNavLink
                      to={isAdmin ? "/admin" : "/dashboard"}
                      label={isAdmin ? "Admin" : "Dashboard"}
                      icon={isAdmin ? ShieldCheck : LayoutDashboard}
                      compact={scrolled}
                    />
                    <DesktopAccountMenu onSignOut={handleSignOut} agentApproved={!!agentApproved} />
                  </>
                ) : (
                  <>
                    {savedAccounts.length > 0 && (
                      <button
                        type="button"
                        onClick={openAccountSwitcher}
                        className={`relative w-9 h-9 min-w-[36px] min-h-[36px] rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdle}`}
                        title="Switch Account"
                        aria-label="Switch account"
                      >
                        <Users className="w-4 h-4 text-amber-400" />
                      </button>
                    )}
                    <Link
                      to="/login"
                      className={`text-sm font-semibold whitespace-nowrap px-3 py-[7px] rounded-xl transition-colors ${linkIdle}`}
                    >
                      Sign in
                    </Link>
                    <GoldNavLink to="/buy-data" label="Buy Data" icon={Zap} compact={scrolled} />
                  </>
                )}
              </div>

              {/* ── Mobile right ── */}
              <div className="lg:hidden flex items-center gap-1.5">
                <NotificationCenter isDark={isDark} />
                {!user && (
                  <Link to="/buy-data">
                    <motion.div
                      whileTap={{ scale: 0.95 }}
                      className="flex items-center gap-1 text-black text-xs font-black whitespace-nowrap px-3.5 py-2 rounded-xl cursor-pointer min-h-[38px] shadow-md shadow-amber-400/20"
                      style={{
                        background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                      }}
                    >
                      <Zap className="w-3.5 h-3.5 fill-black" />
                      Buy Data
                    </motion.div>
                  </Link>
                )}
                <motion.button
                  onClick={(e) => { setMenuOpen(true); (e.currentTarget as HTMLButtonElement).blur(); }}
                  whileTap={{ scale: 0.9 }}
                  className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center transition-colors ${
                    isDark
                      ? "text-white/75 hover:text-white hover:bg-white/[0.08]"
                      : "text-gray-700 hover:text-gray-900 hover:bg-black/[0.05]"
                  }`}
                  aria-label="Open menu"
                >
                  <Menu className="w-5 h-5" />
                </motion.button>
              </div>
            </motion.div>
          </nav>
        </div>
      </motion.div>

      {/* ─────────── Mobile menu drawer (portaled to body so it always scrolls on mobile) ─────────── */}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {menuOpen && (
            <>
              <motion.div
                className="lg:hidden fixed inset-0 z-[9998] bg-black/45 dark:bg-black/65 backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />

              <motion.aside
                ref={drawerRef}
                role="dialog"
                aria-modal="true"
                aria-label="Menu"
                className="lg:hidden fixed top-0 right-0 bottom-0 z-[9999] w-[340px] max-w-[88vw] flex flex-col overflow-hidden bg-background/95 backdrop-blur-2xl border-l border-border/70 dark:border-white/[0.08] shadow-[-24px_0_80px_rgba(0,0,0,0.35)]"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 30, stiffness: 280 }}
                drag="x"
                dragDirectionLock
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0, right: 0.5 }}
                onDragEnd={(_, info) => { if (info.offset.x > 90 || info.velocity.x > 600) setMenuOpen(false); }}
                style={{ height: "100dvh", maxHeight: "100dvh", paddingTop: "env(safe-area-inset-top, 0px)" }}
              >
                {/* Soft brand glow */}
                <div className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
                <div className="pointer-events-none absolute bottom-24 -left-24 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />

                {/* Header */}
                <div className="relative z-10 flex items-center justify-between px-4 h-16 shrink-0">
                  <Link to="/" className="flex items-center gap-2.5 min-w-0">
                    <picture className="shrink-0">
                      <source srcSet="/logo.webp" type="image/webp" />
                      <img src="/logo.png" alt="" className="w-9 h-9 rounded-full ring-1 ring-amber-400/40" width={36} height={36} />
                    </picture>
                    <div className="min-w-0 leading-tight">
                      <p className="text-[15px] font-bold tracking-tight text-foreground truncate">SwiftData Ghana</p>
                      <p className="text-[11px] text-muted-foreground truncate">Data, airtime &amp; bills in seconds</p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted border border-border/70 dark:border-white/10 transition"
                    aria-label="Close menu"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Scrollable content */}
                <div
                  className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 pb-6 space-y-5"
                  style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
                >
                  {/* Account / welcome card */}
                  {user ? (
                    <div className="rounded-2xl border border-border/70 dark:border-white/[0.08] bg-card/80 p-3.5">
                      <div className="flex items-center gap-3">
                        <span className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-black flex items-center justify-center text-sm font-black">
                          {initialsOf(profile?.full_name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground truncate">{profile?.full_name || "My account"}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {isAdmin ? "Administrator" : profile?.store_name || (agentApproved ? "Agent" : "Customer")}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Link
                          to={isAdmin ? "/admin" : "/dashboard"}
                          className="h-10 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition"
                        >
                          <LayoutDashboard className="w-4 h-4" /> {isAdmin ? "Admin" : "Dashboard"}
                        </Link>
                        <Link
                          to="/dashboard/wallet"
                          className="h-10 rounded-xl border border-border dark:border-white/10 bg-background/60 text-foreground text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-muted active:scale-[0.98] transition"
                        >
                          <Wallet className="w-4 h-4" /> Wallet
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="relative overflow-hidden rounded-2xl p-4 text-black bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500">
                      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/25 blur-2xl" />
                      <p className="relative text-[15px] font-black leading-snug">Cheap data, delivered instantly</p>
                      <p className="relative text-xs font-medium text-black/70 mt-0.5">MTN, Telecel &amp; AirtelTigo bundles. No account needed.</p>
                      <div className="relative mt-3 grid grid-cols-2 gap-2">
                        <Link to="/buy-data" className="h-10 rounded-xl bg-black text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition">
                          <Zap className="w-4 h-4 fill-amber-400 text-amber-400" /> Buy data
                        </Link>
                        <Link to="/login" className="h-10 rounded-xl bg-white/60 text-black text-[13px] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition">
                          <LogIn className="w-4 h-4" /> Sign in
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* Quick actions */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {quickActions.map(({ to, label, hint, icon: Icon, tone }) => {
                      const active = isActive(to);
                      return (
                        <Link
                          key={to}
                          to={to}
                          className={`group rounded-2xl border p-3 flex flex-col gap-2.5 transition active:scale-[0.98] ${
                            active
                              ? "border-primary/50 bg-primary/10"
                              : "border-border/70 dark:border-white/[0.08] bg-card/70 hover:bg-card"
                          }`}
                        >
                          <span className={`h-9 w-9 rounded-xl flex items-center justify-center ${tone}`}>
                            <Icon className="w-[18px] h-[18px]" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-foreground leading-tight">{label}</span>
                            <span className="block text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>

                  {/* Explore */}
                  <DrawerGroup title="Explore">
                    {exploreLinks.map(({ to, label, icon }) => (
                      <DrawerRow key={to} to={to} label={label} icon={icon} active={isActive(to)} />
                    ))}
                    <DrawerRow
                      label="How it works"
                      icon={HelpCircle}
                      onClick={() => { setMenuOpen(false); openTutorial(); }}
                      trailing={<span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-400/15 px-1.5 py-0.5 rounded-md">Tutorial</span>}
                    />
                  </DrawerGroup>

                  {/* Account */}
                  {user && (
                    <DrawerGroup title="Account">
                      {[
                        { to: "/dashboard/transactions", label: "Transactions", icon: ClipboardList },
                        { to: "/dashboard/refunded-orders", label: "Refunded orders", icon: RotateCcw },
                        ...(agentApproved ? [{ to: "/dashboard/my-store", label: "My store", icon: Store }] : []),
                        { to: "/dashboard/account-settings", label: "Settings", icon: Settings },
                      ].map(({ to, label, icon }) => (
                        <DrawerRow key={to} to={to} label={label} icon={icon} active={isActive(to)} />
                      ))}
                      <DrawerRow
                        label="Switch account"
                        icon={Users}
                        onClick={() => { setMenuOpen(false); openAccountSwitcher(); }}
                        trailing={savedAccounts.length > 0 ? <span className="text-[11px] text-muted-foreground tabular-nums">{savedAccounts.length} saved</span> : undefined}
                      />
                    </DrawerGroup>
                  )}
                  {!user && savedAccounts.length > 0 && (
                    <DrawerGroup title="Accounts">
                      <DrawerRow
                        label="Switch account"
                        icon={Users}
                        onClick={() => { setMenuOpen(false); openAccountSwitcher(); }}
                        trailing={savedAccounts.length > 0 ? <span className="text-[11px] text-muted-foreground tabular-nums">{savedAccounts.length} saved</span> : undefined}
                      />
                    </DrawerGroup>
                  )}

                  {/* Appearance */}
                  <div>
                    <p className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Appearance</p>
                    <div className="rounded-2xl border border-border/70 dark:border-white/[0.08] bg-card/70 p-3 space-y-3">
                      <AppearanceControls />
                    </div>
                  </div>

                  {/* Sign out / create account */}
                  {user ? (
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full h-11 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] text-rose-600 dark:text-rose-400 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-rose-500/10 transition"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  ) : (
                    <Link
                      to="/login"
                      className="w-full h-11 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition"
                    >
                      Create a free account <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>

                {/* Pinned sponsored banner */}
                {(bannersLoading || menuBanners.length > 0) && (
                  <div
                    className="relative z-20 shrink-0 px-4 pt-2.5 border-t border-border/70 dark:border-white/[0.08] bg-background/95"
                    style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
                  >
                    {bannersLoading ? (
                      <div className="w-full h-16 rounded-xl bg-muted animate-pulse" />
                    ) : (
                      <div className="relative">
                        <span className="absolute top-1.5 right-1.5 z-10 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md pointer-events-none bg-black/55 text-white/75">
                          Sponsored
                        </span>
                        <Carousel setApi={setApi} plugins={[Autoplay({ delay: 4000 })]} className="w-full">
                          <CarouselContent className="-ml-0">
                            {menuBanners.map((banner) => (
                              <CarouselItem key={banner.id} className="pl-0" onClick={() => banner.target_url && navigate(banner.target_url)}>
                                <div className="relative overflow-hidden rounded-xl cursor-pointer active:scale-[0.98] transition-transform h-16">
                                  <img
                                    src={banner.image_url}
                                    alt="Sponsored"
                                    className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                  <div className="absolute inset-0 rounded-xl pointer-events-none ring-1 ring-inset ring-white/10" />
                                </div>
                              </CarouselItem>
                            ))}
                          </CarouselContent>
                        </Carousel>
                        {menuBanners.length > 1 && (
                          <div className="flex justify-center gap-1 mt-1.5">
                            {menuBanners.map((_, i) => (
                              <div key={i} className={`h-1 rounded-full transition-all duration-300 ${current === i ? "w-3 bg-primary" : "w-1.5 bg-muted-foreground/25"}`} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default Navbar;
