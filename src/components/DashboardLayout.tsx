import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ChevronRight,
  CloudOff,
  Eye,
  EyeOff,
  Grid2x2,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  Sun,
  User,
  UserCog,
  Users,
  Wallet,
  WifiOff,
  X,
  ClipboardList,
} from "lucide-react";
import DashboardSidebar from "@/components/DashboardSidebar";
import { NotificationCenter } from "./NotificationCenter";
import CommandPalette from "@/components/CommandPalette";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useConnectivity } from "@/hooks/useConnectivity";
import { useMaskedBalance } from "@/hooks/useMaskedBalance";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSafeAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { buildNavCtx, findActive, itemLabel, visibleGroups } from "@/components/dashboard/navConfig";

const LOW_BALANCE_THRESHOLD = 10; // GHS
const COLLAPSE_KEY = "swiftdash_sidebar_collapsed_v1";

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [alertDismissed, setAlertDismissed] = useState(false);
  const { user, profile, signOut, openAccountSwitcher } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isChallengeGameRoute = location.pathname.includes("/challenges") || location.pathname.includes("/games");
  const { isDark, toggleDark } = useAppTheme();
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const { isOnline, quality } = useConnectivity();
  const { isMasked, toggleMask, maskValue } = useMaskedBalance();
  const [commandOpen, setCommandOpen] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<any[]>([]);

  const ctx = useMemo(() => buildNavCtx(profile), [profile]);
  const active = useMemo(() => findActive(location.pathname, visibleGroups(ctx)), [location.pathname, ctx]);
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  const balance = walletBalance ?? 0;
  const showLowBalanceAlert =
    isPaidAgent && !alertDismissed && walletBalance !== null && walletBalance < LOW_BALANCE_THRESHOLD && walletBalance >= 0;
  const firstName = profile?.full_name?.split(" ")[0] || "User";
  const degraded = !isOnline || quality === "poor";

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  }, []);

  // Hide floating bubbles while the mobile menu is open.
  useEffect(() => {
    if (!sidebarOpen) return;
    document.documentElement.setAttribute("data-dash-drawer", "1");
    return () => document.documentElement.removeAttribute("data-dash-drawer");
  }, [sidebarOpen]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Keep the page title in step with the section.
  useEffect(() => {
    if (isChallengeGameRoute) return;
    const label = active ? itemLabel(active.item, ctx) : "Dashboard";
    document.title = `${label} · SwiftData`;
  }, [active, ctx, isChallengeGameRoute]);

  // Floating widgets read this to sit above the mobile tab bar.
  useEffect(() => {
    if (isChallengeGameRoute) return;
    document.documentElement.setAttribute("data-dash-tabbar", "1");
    return () => document.documentElement.removeAttribute("data-dash-tabbar");
  }, [isChallengeGameRoute]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("wallets")
      .select("balance")
      .eq("agent_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[Wallet] balance fetch failed:", error);
          return;
        }
        setWalletBalance(Number((data as any)?.balance || 0));
      });

    supabase
      .from("ai_recommendations")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_acted_upon", false)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled && data) setAiRecommendations(data);
      });

    const channel = supabase
      .channel(`wallet_header_${user.id}_${Math.random().toString(36).substring(7)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wallets", filter: `agent_id=eq.${user.id}` }, (payload: any) => {
        if (payload.new?.balance === undefined) return;
        const newBal = Number(payload.new.balance);
        const oldBal = Number(payload.old?.balance || 0);
        if (newBal > oldBal) import("@/lib/sound").then((m) => m.playSuccessSound());
        setWalletBalance(newBal);
      })
      .subscribe();
    return () => {
      cancelled = true;
      safeRemoveChannel(channel);
    };
  }, [user]);

  const dismissRec = async (id: string, thenGo?: string) => {
    await (supabase.from("ai_recommendations" as any) as any).update({ is_acted_upon: true }).eq("id", id);
    setAiRecommendations((prev) => prev.filter((r) => r.id !== id));
    if (thenGo) navigate(thenGo);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const tabs = [
    { to: "/dashboard", label: "Home", icon: LayoutDashboard, on: location.pathname === "/dashboard" },
    { to: "/dashboard/buy-data/mtn", label: "Buy", icon: ShoppingCart, on: location.pathname.startsWith("/dashboard/buy-") },
    { to: "/dashboard/wallet", label: "Wallet", icon: Wallet, on: location.pathname === "/dashboard/wallet" },
    ctx.hasStore && ctx.isPaidAgent
      ? { to: "/dashboard/my-store", label: "Store", icon: Store, on: location.pathname === "/dashboard/my-store" }
      : { to: "/dashboard/transactions", label: "Orders", icon: ClipboardList, on: location.pathname === "/dashboard/transactions" },
  ];

  return (
    <div className="dash-shell relative flex min-h-[100dvh] w-full bg-background text-foreground">
      {/* Soft top light — gives the canvas depth without competing with content */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-72 opacity-70 dark:opacity-100"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.07), transparent 70%)" }}
      />

      {!isChallengeGameRoute && (
        <DashboardSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      )}

      <div className="relative flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden">
        {!isChallengeGameRoute && (
          <header
            className="shrink-0 sticky top-0 z-40 border-b border-border/70 dark:border-white/[0.06] bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70"
            style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
          >
            <div className="h-14 sm:h-16 flex items-center gap-2 sm:gap-3 px-3 sm:px-6">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
                className="md:hidden h-9 w-9 -ml-1 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Menu className="h-5 w-5" />
              </button>

              {/* Breadcrumbs */}
              <nav aria-label="Breadcrumb" className="min-w-0 flex items-center gap-1.5 text-sm">
                {active && active.group.id !== "overview" ? (
                  <>
                    <span className="hidden sm:inline text-muted-foreground truncate">{active.group.label}</span>
                    <ChevronRight className="hidden sm:inline h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                    <span className="font-semibold text-foreground truncate">{itemLabel(active.item, ctx)}</span>
                  </>
                ) : (
                  <span className="font-semibold text-foreground truncate">{active ? itemLabel(active.item, ctx) : "Dashboard"}</span>
                )}
              </nav>

              <div className="flex-1" />

              {/* Command search */}
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="hidden lg:flex items-center gap-2 h-9 w-64 xl:w-72 rounded-xl border border-border/80 bg-card px-3 text-[13px] text-muted-foreground hover:text-foreground hover:border-border transition-colors dark:bg-white/[0.03] dark:border-white/[0.08]"
              >
                <Search className="h-4 w-4" />
                <span>Search or jump to…</span>
                <kbd className="ml-auto rounded-md border border-border bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">Ctrl K</kbd>
              </button>
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                aria-label="Search"
                className="lg:hidden h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Search className="h-[18px] w-[18px]" />
              </button>

              {degraded && (
                <span
                  className={cn(
                    "hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold ring-1 ring-inset",
                    !isOnline ? "bg-rose-500/10 text-rose-600 ring-rose-500/25 dark:text-rose-400" : "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400"
                  )}
                >
                  {!isOnline ? <CloudOff className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                  {!isOnline ? "Offline" : "Weak signal"}
                </span>
              )}

              {/* Wallet chip */}
              <div className="flex items-center h-9 rounded-xl border border-border/80 bg-card pl-2.5 pr-1 gap-1.5 dark:bg-white/[0.03] dark:border-white/[0.08]">
                <Wallet className="h-4 w-4 text-muted-foreground hidden sm:block" />
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/wallet")}
                  className="text-[13px] font-semibold tabular-nums text-foreground"
                  title="Wallet balance"
                >
                  {walletBalance === null ? <span className="inline-block h-3 w-14 rounded bg-muted animate-pulse align-middle" /> : `₵${maskValue(balance)}`}
                </button>
                <button type="button" onClick={toggleMask} aria-label={isMasked ? "Show balance" : "Hide balance"} className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground">
                  {isMasked ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/wallet")}
                  aria-label="Top up wallet"
                  title="Top up"
                  className="h-7 rounded-lg bg-primary text-primary-foreground px-2 sm:px-2.5 flex items-center gap-1 text-[12px] font-semibold hover:brightness-105 active:scale-95 transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Top up</span>
                </button>
              </div>

              <button
                type="button"
                onClick={toggleDark}
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                title={isDark ? "Light mode" : "Dark mode"}
                className="hidden sm:flex h-9 w-9 rounded-xl items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
              </button>

              <NotificationCenter isDark={isDark} />

              {/* Profile menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Account menu" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                    <Avatar className="h-8 w-8 sm:h-9 sm:w-9 ring-1 ring-border">
                      <AvatarImage src={getSafeAvatarUrl((profile as any)?.avatar_url, user?.id || user?.email)} />
                      <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">{firstName.charAt(0)}</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-sm font-semibold text-foreground truncate">{profile?.full_name || "Your account"}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email || profile?.phone}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/dashboard/profile")} className="gap-2 rounded-lg">
                    <User className="h-4 w-4" /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate("/dashboard/account-settings")} className="gap-2 rounded-lg">
                    <UserCog className="h-4 w-4" /> Security
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openAccountSwitcher} className="gap-2 rounded-lg">
                    <Users className="h-4 w-4" /> Switch account
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={toggleDark} className="gap-2 rounded-lg sm:hidden">
                    {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {isDark ? "Light mode" : "Dark mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleSignOut} className="gap-2 rounded-lg text-rose-600 focus:text-rose-600 dark:text-rose-400">
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
        )}

        <main
          className={cn(
            "relative flex-1 overflow-y-auto overflow-x-hidden",
            !isChallengeGameRoute && "pb-[calc(76px+env(safe-area-inset-bottom,0px))] md:pb-0"
          )}
        >
          {!isChallengeGameRoute && (showLowBalanceAlert || aiRecommendations.length > 0) && (
            <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-4 space-y-2">
              {showLowBalanceAlert && (
                <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <p className="text-[13px] text-foreground flex-1 min-w-0">
                    <span className="font-semibold">Low balance:</span> ₵{maskValue(balance)} left. Top up to keep selling without delays.
                  </p>
                  <button type="button" onClick={() => navigate("/dashboard/wallet")} className="text-[13px] font-semibold text-amber-700 dark:text-amber-400 hover:underline shrink-0">
                    Top up
                  </button>
                  <button type="button" onClick={() => setAlertDismissed(true)} aria-label="Dismiss" className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              {aiRecommendations.slice(0, 1).map((rec) => (
                <div key={rec.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.06] px-3.5 py-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="h-8 w-8 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-400">Sales advisor</p>
                      <p className="text-[13px] text-foreground">{rec.message}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => dismissRec(rec.id, "/dashboard/pricing")} className="h-8 px-3 rounded-lg bg-violet-600 text-white text-[13px] font-semibold hover:bg-violet-500">
                      Update prices
                    </button>
                    <button type="button" onClick={() => dismissRec(rec.id)} aria-label="Dismiss" className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={cn("max-w-7xl mx-auto w-full", !isChallengeGameRoute && "dash-page")}>
            <Outlet />
          </div>
        </main>

        {/* Mobile tab bar */}
        {!isChallengeGameRoute && (
          <nav
            aria-label="Quick navigation"
            className="md:hidden fixed inset-x-0 bottom-0 z-[90] border-t border-border/70 dark:border-white/[0.07] bg-background/90 backdrop-blur-xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <ul className="grid grid-cols-5 h-16">
              {tabs.map((t) => (
                <li key={t.to}>
                  <Link
                    to={t.to}
                    aria-current={t.on ? "page" : undefined}
                    className={cn("h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", t.on ? "text-foreground" : "text-muted-foreground")}
                  >
                    <span className={cn("h-7 w-12 rounded-full flex items-center justify-center transition-colors", t.on && "bg-primary/15")}>
                      <t.icon className={cn("h-5 w-5", t.on && "text-primary")} />
                    </span>
                    {t.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className={cn("w-full h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium", sidebarOpen ? "text-foreground" : "text-muted-foreground")}
                >
                  <span className="h-7 w-12 rounded-full flex items-center justify-center">
                    <Grid2x2 className="h-5 w-5" />
                  </span>
                  More
                </button>
              </li>
            </ul>
          </nav>
        )}
      </div>

      <CommandPalette open={commandOpen} setOpen={setCommandOpen} />
    </div>
  );
};

export default DashboardLayout;
