import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu, X, LogOut, LayoutDashboard, ShieldCheck,
  TrendingUp, Home, HelpCircle, ChevronRight,
  User, Settings, Wallet, ClipboardList, Store, Sun, Moon, Zap,
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

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
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
    { to: "/order-status", label: "Track Order", icon: LayoutDashboard },
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
    : "text-gray-500 hover:text-gray-900 hover:bg-black/[0.05] border border-transparent hover:border-black/[0.07]";

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
  const drawerBg     = isDark ? "rgba(8, 5, 26, 0.52)"  : "rgba(240, 248, 255, 0.60)";
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
    : "text-gray-500 hover:text-gray-900 hover:bg-black/[0.04] border border-transparent transition-all duration-150";
  const itemActive = isDark ? "text-white border" : "text-gray-900 border";

  return (
    <>
      {/* ─────────── Floating Glass Pill ─────────── */}
      <div className="fixed top-3 left-0 right-0 z-50 px-3 sm:px-5 pointer-events-none">
        {/* Gradient border shell */}
        <div
          className="mx-auto max-w-5xl rounded-2xl pointer-events-auto"
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

            <div className="flex items-center justify-between h-[54px] px-3 sm:px-4 relative">

              {/* ── Logo ── */}
              <Link to="/" className="flex items-center gap-2.5 shrink-0 group" aria-label="SwiftData Ghana">
                <div className="relative">
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
                  <div
                    className="absolute -bottom-0.5 -right-0.5 rounded-full bg-blue-600 flex items-center justify-center border z-20"
                    style={{
                      width: "1.05rem", height: "1.05rem",
                      borderColor: isDark ? "rgba(9,7,28,0.95)" : "rgba(252,254,255,0.95)",
                      boxShadow: "0 0 8px rgba(59,130,246,0.65)",
                      borderWidth: "1.5px",
                    }}
                  >
                    <ShieldCheck className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>
                <div className="leading-tight hidden sm:block">
                  <span className={`${logoText} font-black text-[13px] block leading-none tracking-tight`}>
                    SwiftData Ghana
                  </span>
                  <span className="text-amber-400 text-[10px] leading-none font-semibold tracking-wide">
                    #1 Cheapest Data Bundles
                  </span>
                </div>
              </Link>

              {/* ── Desktop nav links ── */}
              <div className="hidden md:flex items-center gap-0.5">
                {mainLinks.map(({ to, label, icon }) => (
                  <Link
                    key={to} to={to}
                    className={`flex items-center gap-1.5 px-3 py-[7px] rounded-xl text-sm font-medium transition-all duration-150 ${
                      isActive(to) ? (isDark ? "text-white border" : "text-gray-900 border") : linkIdle
                    }`}
                    style={isActive(to) ? linkActiveStyle : undefined}
                  >
                    <NavIcon icon={icon} className={isActive(to) ? "text-amber-400" : ""} />
                    {label}
                    {to === "/buy-airtime" && (
                      <span className="ml-1 text-[8px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1 rounded">
                        Soon
                      </span>
                    )}
                  </Link>
                ))}

                <button
                  onClick={openTutorial}
                  className={`flex items-center gap-1.5 px-3 py-[7px] rounded-xl text-sm font-medium transition-all duration-150 ${linkIdle}`}
                >
                  <NavIcon icon={HelpCircle} /> How It Works
                </button>

                <div className={`w-px h-4 ${dividerBg} mx-1`} />

                <button
                  onClick={toggleDark}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdle}`}
                  title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                >
                  {isDark
                    ? <Sun className="w-3.5 h-3.5 text-amber-400" />
                    : <Moon className="w-3.5 h-3.5" />}
                </button>

                {user && (
                  <Link
                    to={isAdmin ? "/admin" : "/dashboard"}
                    className={`flex items-center gap-1.5 px-3 py-[7px] rounded-xl text-sm font-medium transition-all duration-150 ${
                      isActive("/dashboard") || isActive("/admin")
                        ? (isDark ? "text-white border" : "text-gray-900 border")
                        : linkIdle
                    }`}
                    style={isActive("/dashboard") || isActive("/admin") ? linkActiveStyle : undefined}
                  >
                    <NavIcon
                      icon={isAdmin ? ShieldCheck : LayoutDashboard}
                      className={isActive("/dashboard") || isActive("/admin") ? "text-amber-400" : ""}
                    />
                    {isAdmin ? "Admin" : "Dashboard"}
                  </Link>
                )}

                {user ? (
                  <button
                    onClick={handleSignOut}
                    className={`ml-0.5 flex items-center gap-1.5 px-3 py-[7px] rounded-xl text-sm font-medium transition-all duration-150 ${linkIdle}`}
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                ) : (
                  <Link
                    to="/login"
                    className="ml-1 flex items-center gap-1.5 text-black text-sm font-bold px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                      boxShadow: "0 0 22px rgba(251,191,36,0.45), 0 2px 8px rgba(245,158,11,0.30), inset 0 1px 0 rgba(255,255,255,0.35)",
                    }}
                  >
                    <Zap className="w-3.5 h-3.5" /> Get Started
                  </Link>
                )}
              </div>

              {/* ── Mobile right ── */}
              <div className="md:hidden flex items-center gap-1.5">
                <button
                  onClick={toggleDark}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${linkIdle}`}
                >
                  {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
                {!user && (
                  <Link
                    to="/login"
                    className="flex items-center gap-1 text-black text-xs font-bold px-3 py-1.5 rounded-lg"
                    style={{
                      background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                      boxShadow: "0 0 12px rgba(251,191,36,0.40)",
                    }}
                  >
                    Sign In
                  </Link>
                )}
                <button
                  onClick={() => setMenuOpen(true)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    isDark
                      ? "text-white/65 hover:text-white hover:bg-white/[0.08]"
                      : "text-gray-500 hover:text-gray-900 hover:bg-black/[0.05]"
                  }`}
                  aria-label="Open menu"
                >
                  <Menu className="w-5 h-5" />
                </button>
              </div>
            </div>
          </nav>
        </div>
      </div>

      {/* ─────────── Backdrop overlay ─────────── */}
      <div
        className="md:hidden fixed inset-0 z-[60] transition-all duration-300"
        style={{
          background: isDark ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.28)",
          backdropFilter: menuOpen ? "blur(6px) saturate(0.75)" : "none",
          WebkitBackdropFilter: menuOpen ? "blur(6px) saturate(0.75)" : "none",
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
          backdropFilter: "blur(36px) saturate(2.1)",
          WebkitBackdropFilter: "blur(36px) saturate(2.1)",
          borderLeft: `1px solid ${drawerBorder}`,
          boxShadow: isDark
            ? "-24px 0 80px rgba(0,0,0,0.60), -1px 0 0 rgba(139,92,246,0.28)"
            : "-24px 0 64px rgba(99,102,241,0.16), -1px 0 0 rgba(99,102,241,0.20)",
          transform: menuOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 320ms cubic-bezier(0.32, 0.72, 0, 1)",
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
          <button
            onClick={() => setMenuOpen(false)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              isDark
                ? "text-white/40 hover:text-white hover:bg-white/[0.09] border border-transparent hover:border-white/[0.09]"
                : "text-gray-400 hover:text-gray-900 hover:bg-black/[0.05] border border-transparent hover:border-black/[0.05]"
            }`}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div className="relative z-10 flex-1 overflow-y-auto px-3 py-4 space-y-0.5">

          {/* User card */}
          {user && (
            <div
              className="flex items-center gap-3 px-3 py-3 mb-3 rounded-2xl"
              style={{
                background: isDark ? "rgba(139,92,246,0.11)" : "rgba(99,102,241,0.07)",
                border: `1px solid ${isDark ? "rgba(139,92,246,0.24)" : "rgba(99,102,241,0.18)"}`,
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
                <p className={`text-xs truncate ${isDark ? "text-white/38" : "text-gray-400"}`}>
                  {profile?.store_name || (isAdmin ? "Administrator" : "Customer")}
                </p>
              </div>
            </div>
          )}

          <p className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 ${isDark ? "text-white/20" : "text-gray-400"}`}>
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
                <NavIcon icon={icon} className={isActive(to) ? "text-amber-400" : isDark ? "text-white/42" : "text-gray-400"} />
              </div>
              {label}
              {to === "/buy-airtime" && (
                <span className="ml-2 text-[8px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded">
                  Soon
                </span>
              )}
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
              <p className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 ${isDark ? "text-white/20" : "text-gray-400"}`}>
                Account
              </p>
              {[
                { to: isAdmin ? "/admin" : "/dashboard", label: "Dashboard", icon: LayoutDashboard },
                { to: "/dashboard/wallet", label: "My Wallet", icon: Wallet },
                { to: "/dashboard/transactions", label: "My Transactions", icon: ClipboardList },
                ...(agentApproved ? [{ to: "/dashboard/my-store", label: "My Store", icon: Store }] : []),
                { to: "/dashboard/account-settings", label: "Account Settings", icon: Settings },
              ].map(({ to, label, icon: Icon }) => (
                <Link
                  key={to} to={to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${itemIdle}`}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>
                    <Icon className={`w-4 h-4 ${isDark ? "text-white/42" : "text-gray-400"}`} />
                  </div>
                  {label}
                </Link>
              ))}
              {isAdmin && (
                <Link to="/admin"
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${itemIdle}`}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-400/[0.12]">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                  </div>
                  Admin Panel
                  <span className="ml-auto text-[10px] font-bold text-amber-400/80 bg-amber-400/[0.12] border border-amber-400/20 px-1.5 py-0.5 rounded-md">
                    Admin
                  </span>
                </Link>
              )}
            </>
          )}

          <div className="h-px my-2" style={{ background: drawerDivider }} />

          {user ? (
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400/60 hover:text-red-400 transition-all"
              style={{ background: "transparent" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.08)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-red-500/[0.09]">
                <LogOut className="w-4 h-4 text-red-400/60" />
              </div>
              Sign Out
            </button>
          ) : (
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-bold text-black transition-all active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                boxShadow: "0 0 28px rgba(251,191,36,0.40), 0 2px 10px rgba(245,158,11,0.28), inset 0 1px 0 rgba(255,255,255,0.32)",
              }}
            >
              <Zap className="w-4 h-4" /> Get Started — It&apos;s Free
            </Link>
          )}
        </div>
      </div>
    </>
  );
};

export default Navbar;
