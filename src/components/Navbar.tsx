import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu, X, LogOut, LayoutDashboard, ShieldCheck,
  TrendingUp, Home, HelpCircle, ChevronRight,
  User, Settings, Wallet, ClipboardList, Store, Sun, Moon,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";

const openTutorial = () => window.dispatchEvent(new CustomEvent("open-tutorial"));

const NavIcon = ({ icon: Icon, className = "" }: { icon: typeof Home; className?: string }) => (
  <Icon className={`w-4 h-4 shrink-0 ${className}`} />
);

const Navbar = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, isAdmin, signOut } = useAuth();
  const { isDark, toggleDark } = useAppTheme();
  const drawerRef = useRef<HTMLDivElement>(null);

  /* close on route change */
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  /* shadow on scroll */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* lock body scroll while drawer is open */
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
    { to: "/order-status", label: "Track Order", icon: LayoutDashboard },
    ...(!user || !agentApproved ? [{ to: "/agent-program", label: "Become an Agent", icon: TrendingUp }] : []),
  ];

  /* ── Glassmorphic style tokens ── */
  const navBackground = isDark
    ? scrolled ? "rgba(6, 5, 20, 0.88)" : "rgba(8, 6, 26, 0.55)"
    : scrolled ? "rgba(244, 249, 255, 0.92)" : "rgba(246, 251, 255, 0.62)";

  const navShadow = scrolled
    ? isDark
      ? "0 4px 40px rgba(0,0,0,0.55), 0 1px 0 rgba(139,92,246,0.12)"
      : "0 4px 32px rgba(99,102,241,0.10), 0 2px 8px rgba(0,0,0,0.06)"
    : "none";

  const borderGradient = isDark
    ? "linear-gradient(90deg, transparent 0%, rgba(139,92,246,0.55) 20%, rgba(251,191,36,0.55) 50%, rgba(139,92,246,0.35) 80%, transparent 100%)"
    : "linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.45) 25%, rgba(251,191,36,0.5) 50%, rgba(99,102,241,0.3) 75%, transparent 100%)";

  const innerHighlight = isDark
    ? "linear-gradient(180deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0) 100%)"
    : "linear-gradient(180deg, rgba(255,255,255,0.80) 0%, rgba(255,255,255,0) 100%)";

  const linkIdleCls = isDark
    ? "text-white/55 hover:text-white hover:bg-white/[0.07] border border-transparent hover:border-white/[0.07]"
    : "text-gray-600 hover:text-gray-900 hover:bg-black/[0.04] border border-transparent hover:border-black/[0.06]";

  const linkActiveCls = isDark ? "text-white border" : "text-gray-900 border";

  const linkActiveStyle = isDark
    ? {
        background: "linear-gradient(135deg, rgba(251,191,36,0.2) 0%, rgba(251,191,36,0.06) 100%)",
        boxShadow: "0 0 14px rgba(251,191,36,0.07), inset 0 1px 0 rgba(255,255,255,0.06)",
        borderColor: "rgba(251,191,36,0.22)",
      }
    : {
        background: "linear-gradient(135deg, rgba(251,191,36,0.16) 0%, rgba(251,191,36,0.04) 100%)",
        borderColor: "rgba(251,191,36,0.28)",
      };

  const logoText  = isDark ? "text-white"  : "text-gray-900";
  const dividerBg = isDark ? "bg-white/10" : "bg-black/10";

  /* ── Drawer-specific tokens ── */
  const drawerBg     = isDark ? "rgba(8, 5, 26, 0.52)"   : "rgba(240, 248, 255, 0.60)";
  const drawerBorder = isDark ? "rgba(139,92,246,0.35)"   : "rgba(99,102,241,0.22)";
  const drawerDivider= isDark ? "rgba(139,92,246,0.16)"   : "rgba(99,102,241,0.13)";

  /* ambient glow blobs rendered inside the drawer */
  const drawerGlow1  = isDark
    ? "radial-gradient(ellipse at 80% 10%, rgba(139,92,246,0.22) 0%, transparent 65%)"
    : "radial-gradient(ellipse at 80% 10%, rgba(99,102,241,0.15) 0%, transparent 65%)";
  const drawerGlow2  = isDark
    ? "radial-gradient(ellipse at 20% 85%, rgba(251,191,36,0.14) 0%, transparent 60%)"
    : "radial-gradient(ellipse at 20% 85%, rgba(251,191,36,0.12) 0%, transparent 60%)";

  const drawerActiveItemStyle = isDark
    ? {
        background: "linear-gradient(135deg, rgba(251,191,36,0.22) 0%, rgba(251,191,36,0.07) 100%)",
        boxShadow: "0 0 18px rgba(251,191,36,0.10), inset 0 1px 0 rgba(255,255,255,0.07)",
        borderColor: "rgba(251,191,36,0.28)",
        color: "white",
      }
    : {
        background: "linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(251,191,36,0.05) 100%)",
        borderColor: "rgba(251,191,36,0.30)",
        color: "#111827",
      };

  const itemIdleCls = isDark
    ? "text-white/55 hover:text-white border border-transparent transition-all duration-150"
    : "text-gray-600 hover:text-gray-900 border border-transparent transition-all duration-150";

  const itemActiveCls = isDark ? "text-white border" : "text-gray-900 border";

  return (
    <>
      {/* ─────────── Top Nav Bar ─────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          background: navBackground,
          backdropFilter: "blur(24px) saturate(1.6)",
          WebkitBackdropFilter: "blur(24px) saturate(1.6)",
          boxShadow: navShadow,
        }}
      >
        {/* inner highlight */}
        <div className="absolute top-0 left-0 right-0 h-8 pointer-events-none"
          style={{ background: innerHighlight }} />
        {/* gradient bottom border */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px pointer-events-none transition-opacity duration-300"
          style={{ background: borderGradient, opacity: scrolled ? 1 : 0.75 }}
        />

        <div className="container mx-auto flex items-center justify-between h-16 px-4 relative">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="SwiftData Ghana">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-md"
                style={{ background: "rgba(251,191,36,0.25)", transform: "scale(1.3)" }} />
              <img src="/logo.png" alt="SwiftData Ghana"
                className="w-10 h-10 rounded-full shrink-0 ring-1 ring-amber-400/30 relative z-10"
                width={40} height={40} />
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center border-2 z-20 shadow-lg"
                style={{
                  borderColor: isDark ? "rgba(6,5,20,0.9)" : "rgba(246,251,255,0.9)",
                  boxShadow: "0 0 10px rgba(59,130,246,0.5)",
                }}>
                <ShieldCheck className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="leading-tight hidden sm:block">
              <span className={`${logoText} font-black text-sm block leading-none tracking-tight`}>SwiftData Ghana</span>
              <span className="text-amber-400 text-[10px] leading-none font-semibold">#1 Cheapest Data Bundles</span>
            </div>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5">
            {mainLinks.map(({ to, label, icon }) => (
              <Link key={to} to={to}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${isActive(to) ? linkActiveCls : linkIdleCls}`}
                style={isActive(to) ? linkActiveStyle : undefined}>
                <NavIcon icon={icon} className={isActive(to) ? "text-amber-400" : ""} />
                {label}
              </Link>
            ))}

            <button onClick={openTutorial}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${linkIdleCls}`}>
              <NavIcon icon={HelpCircle} /> How It Works
            </button>

            <div className={`w-px h-5 ${dividerBg} mx-1`} />

            <button onClick={toggleDark}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdleCls}`}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}>
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            {user && (
              <Link to={isAdmin ? "/admin" : "/dashboard"}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${isActive("/dashboard") || isActive("/admin") ? linkActiveCls : linkIdleCls}`}
                style={isActive("/dashboard") || isActive("/admin") ? linkActiveStyle : undefined}>
                <NavIcon icon={isAdmin ? ShieldCheck : LayoutDashboard}
                  className={isActive("/dashboard") || isActive("/admin") ? "text-amber-400" : ""} />
                {isAdmin ? "Admin" : "Dashboard"}
              </Link>
            )}

            {user ? (
              <button onClick={handleSignOut}
                className={`ml-1 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${linkIdleCls}`}>
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            ) : (
              <Link to="/login"
                className="ml-1 flex items-center gap-1.5 text-black text-sm font-bold px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                  boxShadow: "0 0 20px rgba(251,191,36,0.35), 0 2px 8px rgba(245,158,11,0.3)",
                }}>
                Get Started <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>

          {/* Mobile right — theme toggle + sign-in + hamburger */}
          <div className="md:hidden flex items-center gap-2">
            <button onClick={toggleDark}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdleCls}`}>
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
            {!user && (
              <Link to="/login"
                className="flex items-center gap-1 text-black text-xs font-bold px-3 py-2 rounded-lg transition-all"
                style={{
                  background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                  boxShadow: "0 0 12px rgba(251,191,36,0.3)",
                }}>
                Sign In
              </Link>
            )}
            <button
              onClick={() => setMenuOpen(true)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${isDark ? "text-white/70 hover:text-white hover:bg-white/[0.07]" : "text-gray-600 hover:text-gray-900 hover:bg-black/[0.04]"}`}
              aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* ─────────── Backdrop overlay (lighter so page shows through) ─────────── */}
      <div
        className="md:hidden fixed inset-0 z-[60] transition-all duration-300"
        style={{
          background: isDark ? "rgba(0,0,0,0.38)" : "rgba(0,0,0,0.25)",
          backdropFilter: menuOpen ? "blur(6px) saturate(0.8)" : "none",
          WebkitBackdropFilter: menuOpen ? "blur(6px) saturate(0.8)" : "none",
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
        }}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />

      {/* ─────────── Glassmorphic side drawer ─────────── */}
      <div
        ref={drawerRef}
        className="md:hidden fixed top-0 right-0 h-full z-[61] w-[300px] max-w-[85vw] flex flex-col overflow-hidden"
        style={{
          background: drawerBg,
          backdropFilter: "blur(32px) saturate(2)",
          WebkitBackdropFilter: "blur(32px) saturate(2)",
          borderLeft: `1px solid ${drawerBorder}`,
          boxShadow: isDark
            ? "-24px 0 70px rgba(0,0,0,0.55), -1px 0 0 rgba(139,92,246,0.25)"
            : "-24px 0 60px rgba(99,102,241,0.14), -1px 0 0 rgba(99,102,241,0.18)",
          transform: menuOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 320ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* ── Ambient glow blobs (give the glass something to refract) ── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full"
            style={{ background: drawerGlow1, filter: "blur(32px)" }} />
          <div className="absolute bottom-16 -left-8 w-40 h-40 rounded-full"
            style={{ background: drawerGlow2, filter: "blur(28px)" }} />
        </div>

        {/* Top inner highlight (glass reflection edge) */}
        <div className="absolute top-0 left-0 right-0 h-px pointer-events-none z-10"
          style={{ background: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.95)" }} />
        {/* Left inner highlight */}
        <div className="absolute top-0 left-0 bottom-0 w-px pointer-events-none z-10"
          style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.8)" }} />

        {/* ── Drawer header ── */}
        <div className="relative z-10 flex items-center justify-between px-5 h-16 shrink-0"
          style={{ borderBottom: `1px solid ${drawerDivider}` }}>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-md"
                style={{ background: "rgba(251,191,36,0.35)", transform: "scale(1.4)" }} />
              <img src="/logo.png" alt="SwiftData Ghana"
                className="w-8 h-8 rounded-full ring-1 ring-amber-400/40 relative z-10"
                width={32} height={32} />
            </div>
            <span className={`${logoText} font-black text-sm tracking-tight`}>Menu</span>
          </div>
          <button
            onClick={() => setMenuOpen(false)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              isDark
                ? "text-white/45 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/[0.08]"
                : "text-gray-500 hover:text-gray-900 hover:bg-black/[0.05] border border-transparent hover:border-black/[0.05]"
            }`}
            aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div className="relative z-10 flex-1 overflow-y-auto px-3 py-4 space-y-0.5">

          {/* User card */}
          {user && (
            <div className="flex items-center gap-3 px-3 py-3 mb-3 rounded-2xl"
              style={{
                background: isDark ? "rgba(139,92,246,0.10)" : "rgba(99,102,241,0.06)",
                border: `1px solid ${isDark ? "rgba(139,92,246,0.22)" : "rgba(99,102,241,0.16)"}`,
                backdropFilter: "blur(8px)",
              }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.28)" }}>
                <User className="w-4 h-4 text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className={`${logoText} text-sm font-bold truncate`}>{profile?.full_name || "My Account"}</p>
                <p className={`text-xs truncate ${isDark ? "text-white/40" : "text-gray-400"}`}>
                  {profile?.store_name || (isAdmin ? "Administrator" : "Customer")}
                </p>
              </div>
            </div>
          )}

          {/* Explore section */}
          <p className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 ${isDark ? "text-white/22" : "text-gray-400"}`}>
            Explore
          </p>
          {mainLinks.map(({ to, label, icon }) => (
            <Link key={to} to={to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive(to) ? itemActiveCls : itemIdleCls}`}
              style={isActive(to) ? drawerActiveItemStyle : undefined}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all"
                style={{
                  background: isActive(to)
                    ? "rgba(251,191,36,0.18)"
                    : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  border: isActive(to)
                    ? "1px solid rgba(251,191,36,0.25)"
                    : "1px solid transparent",
                }}>
                <NavIcon icon={icon} className={isActive(to) ? "text-amber-400" : isDark ? "text-white/45" : "text-gray-400"} />
              </div>
              {label}
              {isActive(to) && <ChevronRight className="w-4 h-4 ml-auto text-amber-400/60" />}
            </Link>
          ))}

          <button
            onClick={() => { setMenuOpen(false); openTutorial(); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${itemIdleCls}`}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>
              <HelpCircle className={`w-4 h-4 ${isDark ? "text-white/45" : "text-gray-400"}`} />
            </div>
            How It Works
            <span className="ml-auto text-[10px] font-bold text-amber-400/80 bg-amber-400/12 border border-amber-400/20 px-1.5 py-0.5 rounded-md">
              Tutorial
            </span>
          </button>

          {/* Account section */}
          {user && (
            <>
              <div className="h-px my-2" style={{ background: drawerDivider }} />
              <p className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 ${isDark ? "text-white/22" : "text-gray-400"}`}>
                Account
              </p>
              {[
                { to: isAdmin ? "/admin" : "/dashboard", label: "Dashboard", icon: LayoutDashboard },
                { to: "/dashboard/wallet", label: "My Wallet", icon: Wallet },
                { to: "/dashboard/transactions", label: "My Transactions", icon: ClipboardList },
                ...(agentApproved ? [{ to: "/dashboard/my-store", label: "My Store", icon: Store }] : []),
                { to: "/dashboard/account-settings", label: "Account Settings", icon: Settings },
              ].map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${itemIdleCls}`}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>
                    <Icon className={`w-4 h-4 ${isDark ? "text-white/45" : "text-gray-400"}`} />
                  </div>
                  {label}
                </Link>
              ))}
              {isAdmin && (
                <Link to="/admin"
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${itemIdleCls}`}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-400/12">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                  </div>
                  Admin Panel
                  <span className="ml-auto text-[10px] font-bold text-amber-400/80 bg-amber-400/12 border border-amber-400/20 px-1.5 py-0.5 rounded-md">
                    Admin
                  </span>
                </Link>
              )}
            </>
          )}

          {/* Footer */}
          <div className="h-px my-2" style={{ background: drawerDivider }} />
          {user ? (
            <button onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400/65 hover:text-red-400 transition-all"
              style={{ background: "transparent" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.08)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-red-500/[0.09]">
                <LogOut className="w-4 h-4 text-red-400/65" />
              </div>
              Sign Out
            </button>
          ) : (
            <Link to="/login"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold text-black transition-all active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                boxShadow: "0 0 24px rgba(251,191,36,0.35), 0 2px 8px rgba(245,158,11,0.25), inset 0 1px 0 rgba(255,255,255,0.3)",
              }}>
              Get Started — It's Free <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </>
  );
};

export default Navbar;
