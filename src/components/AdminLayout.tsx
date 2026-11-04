import { useState, useEffect, useCallback } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { toast } from "sonner";
import AdminNotifications from "@/components/AdminNotifications";
import {
  LayoutDashboard, Users, ShieldCheck, ShoppingCart, LogOut, Menu,
  Wallet, Bell, Package, CreditCard, Activity, Settings, ChevronRight, ChevronDown, ChevronsLeft, ChevronsRight,
  BarChart3, Ticket, LifeBuoy, FileSearch, Key, TrendingUp, Sun, Moon,
  Sparkles, Image as ImageIcon, Users2, ScrollText,
  Megaphone, Flag, MessageSquare, Banknote, UserCheck, LineChart, Brain,
  ShieldAlert, Search, Zap, Phone, Lightbulb, RotateCcw, ListCheck, Send, PhoneCall, GraduationCap, Bot, RefreshCw, Loader2, X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface NavItem {
  label: string;
  icon: any;
  path: string;
  permKey?: string;
}

export interface NavSection {
  title: string;
  permKey?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Main",
    permKey: "overview",
    items: [
      { label: "Overview",   icon: LayoutDashboard, path: "/admin", permKey: "overview" },
      { label: "Analytics",  icon: BarChart3,        path: "/admin/analytics", permKey: "overview" },
    ],
  },
  {
    title: "Operations & Orders",
    permKey: "orders",
    items: [
      { label: "Orders",       icon: ShoppingCart, path: "/admin/orders", permKey: "orders" },
      { label: "Bot Orders",   icon: Bot,          path: "/admin/bot-orders", permKey: "orders" },
      { label: "Airtime Orders", icon: Phone,        path: "/admin/airtime-orders", permKey: "orders" },
      { label: "Mash Up Orders", icon: Zap,          path: "/admin/mashup-orders", permKey: "orders" },
      { label: "Utility Orders", icon: Lightbulb,    path: "/admin/utility-orders", permKey: "orders" },
      { label: "Standard Orders", icon: Package,     path: "/admin/standard-orders", permKey: "orders" },
      { label: "Checker Orders",  icon: GraduationCap, path: "/admin/checker-orders", permKey: "orders" },
      { label: "AFA Registrations", icon: UserCheck, path: "/admin/afa-orders", permKey: "orders" },
      { label: "Refunded Orders", icon: RotateCcw, path: "/admin/refunded-orders", permKey: "orders" },
      { label: "Non-Beneficiary List", icon: ListCheck, path: "/admin/beneficiary-orders", permKey: "orders" },
      { label: "Submitted Numbers", icon: PhoneCall, path: "/admin/submitted-numbers", permKey: "orders" },
      { label: "Submit Beneficiary Numbers", icon: Send, path: "/submit-numbers", permKey: "orders" },
      { label: "API Orders",    icon: ShoppingCart, path: "/admin/api-orders", permKey: "orders" },
    ],
  },
  {
    title: "Agents & Network",
    permKey: "agents",
    items: [
      { label: "Swift Vendor Master", icon: ShieldAlert, path: "/admin/swift-vendor", permKey: "agents" },
      { label: "Agents",       icon: ShieldCheck,  path: "/admin/agents", permKey: "agents" },
      { label: "Sub-Agents",   icon: Users2,       path: "/admin/sub-agents", permKey: "agents" },
      { label: "Agent Performance", icon: UserCheck,   path: "/admin/agent-performance", permKey: "agents" },
    ],
  },
  {
    title: "Packages & Pricing",
    permKey: "packages",
    items: [
      { label: "Packages",     icon: Package,      path: "/admin/packages", permKey: "packages" },
      { label: "Korba Hub",    icon: Activity,     path: "/admin/korba", permKey: "packages" },
      { label: "Korba Packages", icon: Package,    path: "/admin/korba/packages", permKey: "packages" },
      { label: "Promo Codes",  icon: Ticket,       path: "/admin/promotions", permKey: "packages" },
    ],
  },
  {
    title: "Financials & Profits",
    permKey: "finance",
    items: [
      { label: "Wallet Top-Up",icon: CreditCard,   path: "/admin/wallet-topup", permKey: "finance" },
      { label: "Wallet Ledger", icon: ShieldCheck,  path: "/admin/wallet-ledger", permKey: "finance" },
      { label: "Withdrawals",  icon: Wallet,        path: "/admin/withdrawals", permKey: "finance" },
      { label: "Reconciliation", icon: CreditCard,   path: "/admin/reconciliation", permKey: "finance" },
      { label: "Profits",          icon: TrendingUp,  path: "/admin/profits", permKey: "finance" },
      { label: "P&L Report",        icon: LineChart,   path: "/admin/pnl", permKey: "finance" },
      { label: "Credit Mgmt",       icon: Banknote,    path: "/admin/credit-management", permKey: "finance" },
    ],
  },
  {
    title: "Communications",
    permKey: "communications",
    items: [
      { label: "Broadcast",         icon: Megaphone,   path: "/admin/broadcast", permKey: "communications" },
      { label: "WhatsApp Stickers", icon: Sparkles,    path: "/admin/stickers", permKey: "communications" },
      { label: "Voice Calls (mNotify)", icon: PhoneCall, path: "/admin/voice-sms", permKey: "communications" },
      { label: "Promo Banners",     icon: ImageIcon,   path: "/admin/banners", permKey: "communications" },
      { label: "SMS Templates",  icon: MessageSquare, path: "/admin/sms-templates", permKey: "communications" },
    ],
  },
  {
    title: "Support & Engagement",
    permKey: "support",
    items: [
      { label: "Support Tickets", icon: LifeBuoy,   path: "/admin/tickets", permKey: "support" },
      { label: "Notifications",   icon: Bell,        path: "/admin/notifications", permKey: "support" },
      { label: "Engagement Hub",  icon: Sparkles,    path: "/admin/engagement", permKey: "support" },
      { label: "Game Challenges", icon: Sparkles,    path: "/admin/challenges", permKey: "support" },
    ],
  },
  {
    title: "Users & Accounts",
    permKey: "users",
    items: [
      { label: "Users",           icon: Users,       path: "/admin/users", permKey: "users" },
      { label: "API Users",     icon: Key,        path: "/admin/api-users", permKey: "users" },
    ],
  },
  {
    title: "System & AI",
    permKey: "system",
    items: [
      { label: "Security",      icon: ShieldCheck, path: "/admin/security", permKey: "system" },
      { label: "System Health", icon: Activity,    path: "/admin/system-health", permKey: "system" },
      { label: "Sentinel AI",   icon: Brain,       path: "/admin/sentinel", permKey: "system" },
      { label: "AI Intelligence Hub", icon: Brain, path: "/admin/ai-strategy", permKey: "system" },
      { label: "API Network Intelligence", icon: Activity, path: "/admin/api-network", permKey: "system" },
      { label: "System Logs",    icon: ScrollText,    path: "/admin/system-logs", permKey: "system" },
      { label: "Feature Flags",  icon: Flag,          path: "/admin/feature-flags", permKey: "system" },
      { label: "Audit Logs",     icon: FileSearch,    path: "/admin/audit-logs", permKey: "system" },
      { label: "Settings",      icon: Settings,   path: "/admin/settings", permKey: "system" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "My Security",   icon: Key,        path: "/admin/account-settings" },
    ],
  },
];


export const getSubAdminInfo = (profile: any) => {
  if (!profile) return { isRestrictedSubAdmin: false, userPerms: [] as string[] };
  
  const rawMarkups = profile.markups;
  let markupsObj: Record<string, any> = {};
  if (typeof rawMarkups === "string") {
    try { markupsObj = JSON.parse(rawMarkups); } catch (e) { markupsObj = {}; }
  } else if (rawMarkups && typeof rawMarkups === "object") {
    markupsObj = rawMarkups;
  }

  const perms: string[] = Array.isArray(markupsObj.admin_permissions)
    ? markupsObj.admin_permissions
    : (Array.isArray(profile.admin_permissions)
      ? profile.admin_permissions
      : (Array.isArray(profile.metadata?.admin_permissions) ? profile.metadata.admin_permissions : []));

  const email = (profile.email || "").toLowerCase().trim();

  // Known Main Admin master emails and explicit Super Admin flags
  const isMasterAdminEmail = email === "swiftdatagh.me@gmail.com" || email === "tabuaaeunice780@gmail.com";
  const isExplicitSuperAdmin = isMasterAdminEmail ||
    profile.is_super_admin === true ||
    markupsObj.is_super_admin === true ||
    markupsObj.is_sub_admin === false ||
    profile.is_sub_admin === false;

  // A profile is ONLY a restricted sub-admin if explicitly set to sub-admin with limited permissions and not a master admin
  const isSubAdminFlag = (markupsObj.is_sub_admin === true || profile.is_sub_admin === true) && !isMasterAdminEmail;
  const isRestrictedByPerms = Object.prototype.hasOwnProperty.call(markupsObj, "admin_permissions") && perms.length < 8 && !isMasterAdminEmail;

  const isRestrictedSubAdmin = !isExplicitSuperAdmin && (isSubAdminFlag || isRestrictedByPerms);

  return { 
    isRestrictedSubAdmin, 
    userPerms: isRestrictedSubAdmin ? perms : ["orders", "agents", "packages", "finance", "communications", "support", "users", "system", "overview"] 
  };
};

export const SUPER_ADMIN_ONLY_PATHS = new Set([
  // Main Dashboard & Analytics
  "/admin",
  "/admin/analytics",

  // Internal Beneficiary & Number Submission Tools (Image 1)
  "/admin/beneficiary-orders",
  "/admin/non-beneficiary",
  "/admin/submitted-numbers",
  "/admin/submitted-beneficiaries",
  "/submit-numbers",

  // System, Health, Security, AI & Settings (Image 2)
  "/admin/security",
  "/admin/system-health",
  "/admin/sentinel",
  "/admin/ai-strategy",
  "/admin/api-network",
  "/admin/system-logs",
  "/admin/feature-flags",
  "/admin/audit-logs",
  "/admin/settings",
]);

export const ROUTE_PERM_MAP: Record<string, string> = {
  "/admin": "overview",
  "/admin/analytics": "overview",
  "/admin/orders": "orders",
  "/admin/refunded-orders": "orders",
  "/admin/refunds": "orders",
  "/admin/beneficiary-orders": "orders",
  "/admin/non-beneficiary": "orders",
  "/admin/submitted-numbers": "orders",
  "/admin/submitted-beneficiaries": "orders",
  "/submit-numbers": "orders",
  "/admin/airtime-orders": "orders",
  "/admin/mashup-orders": "orders",
  "/admin/utility-orders": "orders",
  "/admin/standard-orders": "orders",
  "/admin/checker-orders": "orders",
  "/admin/api-orders": "orders",
  "/admin/swift-vendor": "agents",
  "/admin/agents": "agents",
  "/admin/sub-agents": "agents",
  "/admin/agent-performance": "agents",
  "/admin/packages": "packages",
  "/admin/korba": "packages",
  "/admin/korba/packages": "packages",
  "/admin/promotions": "packages",
  "/admin/wallet-topup": "finance",
  "/admin/withdrawals": "finance",
  "/admin/wallet-ledger": "finance",
  "/admin/reconciliation": "finance",
  "/admin/profits": "finance",
  "/admin/pnl": "finance",
  "/admin/credit-management": "finance",
  "/admin/broadcast": "communications",
  "/admin/voice-sms": "communications",
  "/admin/banners": "communications",
  "/admin/sms-templates": "communications",
  "/admin/tickets": "support",
  "/admin/notifications": "support",
  "/admin/engagement": "support",
  "/admin/users": "users",
  "/admin/api-users": "users",
  "/admin/security": "system",
  "/admin/system-health": "system",
  "/admin/sentinel": "system",
  "/admin/ai-strategy": "system",
  "/admin/api-network": "system",
  "/admin/system-logs": "system",
  "/admin/feature-flags": "system",
  "/admin/audit-logs": "system",
  "/admin/settings": "system",
};


// ── Admin console shell ─────────────────────────────────────────────────────────

const COLLAPSE_KEY = "swiftadmin_sidebar_collapsed_v1";
const CLOSED_KEY = "swiftadmin_closed_sections_v1";

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

const useAllowedSections = () => {
  const { profile } = useAuth();
  const { isRestrictedSubAdmin, userPerms } = getSubAdminInfo(profile);
  const sections = NAV_SECTIONS.map((section) => {
    if (!isRestrictedSubAdmin) return section;
    const items = section.items.filter((item) => {
      if (SUPER_ADMIN_ONLY_PATHS.has(item.path)) return false;
      if (item.path === "/admin/account-settings") return true;
      return item.permKey ? userPerms.includes(item.permKey) : false;
    });
    return { ...section, items };
  }).filter((section) => section.items.length > 0);
  return { sections, isRestrictedSubAdmin, userPerms };
};

/* ───────────── Command palette ───────────── */

const AdminCommandPalette = ({
  open,
  setOpen,
  onNavigate,
  allowedItems,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onNavigate: (p: string) => void;
  allowedItems: NavItem[];
}) => {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const q = query.trim().toLowerCase();
  const results = q ? allowedItems.filter((i) => i.label.toLowerCase().includes(q)) : allowedItems.slice(0, 8);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);
  useEffect(() => setCursor(0), [query]);

  if (!open) return null;

  const go = (path: string) => {
    onNavigate(path);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4 bg-black/45 backdrop-blur-[3px]" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Search admin"
        className="w-full max-w-xl rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(results.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter" && results[cursor]) {
                go(results[cursor].path);
              }
            }}
            placeholder="Jump to a page…"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="py-10 text-center text-sm text-muted-foreground">No pages match “{query}”.</li>
          ) : (
            results.map((item, i) => (
              <li key={item.path}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(item.path)}
                  className={cn("w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px]", i === cursor ? "bg-muted text-foreground" : "text-muted-foreground")}
                >
                  <span className="h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 font-medium">{item.label}</span>
                  {i === cursor && <ChevronRight className="h-4 w-4" />}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};

/* ───────────── Sidebar ───────────── */

const AdminSidebar = ({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
  activeQueueCount,
  pendingWithdrawalsCount,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeQueueCount: number;
  pendingWithdrawalsCount: number;
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, openAccountSwitcher, savedAccounts } = useAuth();
  const { sections, isRestrictedSubAdmin } = useAllowedSections();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<string[]>(() => readJson<string[]>(CLOSED_KEY, []));
  const rail = collapsed && !open;
  const q = query.trim().toLowerCase();

  const shown = q
    ? sections
        .map((s) => ({ ...s, items: s.items.filter((i) => `${i.label} ${s.title}`.toLowerCase().includes(q)) }))
        .filter((s) => s.items.length)
    : sections;

  const toggleSection = (title: string) =>
    setClosed((prev) => {
      const next = prev.includes(title) ? prev.filter((x) => x !== title) : [...prev, title];
      writeJson(CLOSED_KEY, next);
      return next;
    });

  const badgeFor = (path: string) =>
    path === "/admin/orders" && activeQueueCount > 0
      ? { n: activeQueueCount, cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" }
      : path === "/admin/withdrawals" && pendingWithdrawalsCount > 0
      ? { n: pendingWithdrawalsCount, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" }
      : null;

  const handleSignOut = async () => {
    await signOut();
    onClose();
    navigate("/login", { replace: true });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn("fixed inset-0 z-[999] bg-black/50 backdrop-blur-[2px] md:hidden transition-opacity", open ? "opacity-100" : "opacity-0 pointer-events-none")}
        onClick={onClose}
        aria-hidden
      />
      <aside
        aria-label="Admin navigation"
        className={cn(
          "fixed md:sticky top-0 left-0 z-[1000] h-[100dvh] shrink-0 flex flex-col w-[284px]",
          "bg-background md:bg-background/40 md:backdrop-blur-xl border-r border-border/70 dark:border-white/[0.06]",
          "transition-[transform,width] duration-200 ease-out md:translate-x-0",
          open ? "translate-x-0 shadow-2xl md:shadow-none" : "-translate-x-full",
          rail ? "md:w-[72px]" : "md:w-[264px]"
        )}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className={cn("h-16 shrink-0 flex items-center", rail ? "justify-center px-2" : "px-4 gap-3")}>
          <Link to={isRestrictedSubAdmin ? "/admin/orders" : "/admin"} onClick={onClose} className="flex items-center gap-2.5 min-w-0">
            <span className="relative h-8 w-8 shrink-0 rounded-lg bg-white ring-1 ring-black/5 flex items-center justify-center">
              <img src="/logo.png" alt="" className="h-full w-full object-contain" />
              <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground ring-2 ring-background flex items-center justify-center">
                <ShieldCheck className="h-2.5 w-2.5" />
              </span>
            </span>
            {!rail && (
              <span className="min-w-0 leading-tight">
                <span className="block text-[15px] font-bold tracking-[-0.01em] text-foreground truncate">SwiftData Admin</span>
                <span className="block text-[11px] text-muted-foreground truncate">{isRestrictedSubAdmin ? "Sub-admin access" : "Control center"}</span>
              </span>
            )}
          </Link>
          {!rail && (
            <button type="button" onClick={onClose} aria-label="Close menu" className="md:hidden ml-auto h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {!rail && (
          <div className="px-3 pb-2 shrink-0">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter menu…"
                aria-label="Filter menu"
                className="h-9 w-full rounded-lg border border-border/80 bg-card pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:ring-2 focus:ring-primary/40 dark:bg-white/[0.03] dark:border-white/[0.08]"
              />
            </label>
          </div>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 no-scrollbar" style={{ WebkitOverflowScrolling: "touch" }}>
          {shown.map((section) => {
            const isClosed = !q && !rail && closed.includes(section.title);
            const hasActive = section.items.some((i) => location.pathname === i.path);
            const sectionBadge = section.items.map((i) => badgeFor(i.path)?.n || 0).reduce((a, b) => a + b, 0);
            return (
              <div key={section.title} className="pt-3">
                {!rail ? (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.title)}
                    aria-expanded={!isClosed}
                    className="w-full flex items-center justify-between px-2.5 pb-1.5 text-[11px] font-semibold text-muted-foreground/80 hover:text-foreground transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      {section.title}
                      {isClosed && (hasActive || sectionBadge > 0) ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                    </span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isClosed && "-rotate-90")} />
                  </button>
                ) : (
                  <div className="mx-3 mb-2 h-px bg-border/70" />
                )}
                {!isClosed && (
                  <ul className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = location.pathname === item.path;
                      const badge = badgeFor(item.path);
                      const link = (
                        <Link
                          to={item.path}
                          onClick={onClose}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "group/item relative flex items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                            rail ? "h-10 w-10 justify-center mx-auto" : "h-9 px-2.5",
                            active
                              ? "bg-foreground/[0.06] text-foreground dark:bg-white/[0.08]"
                              : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05]"
                          )}
                        >
                          {active && !rail ? <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary" aria-hidden /> : null}
                          <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground/80 group-hover/item:text-foreground")} />
                          {!rail && <span className="truncate flex-1">{item.label}</span>}
                          {badge &&
                            (rail ? (
                              <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
                            ) : (
                              <span className={cn("rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums", badge.cls)}>{badge.n}</span>
                            ))}
                        </Link>
                      );
                      return (
                        <li key={item.path}>
                          {rail ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{link}</TooltipTrigger>
                              <TooltipContent side="right" className="text-xs font-medium">
                                {item.label}
                                {badge ? ` · ${badge.n}` : ""}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            link
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          {q && shown.length === 0 && <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">Nothing matches “{query}”.</p>}
        </nav>

        <div className={cn("shrink-0 border-t border-border/70 dark:border-white/[0.06] p-3", rail && "px-2")}>
          {!rail ? (
            <div className="flex items-center gap-2.5 rounded-xl p-1.5">
              <span className="h-9 w-9 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-[13px] font-semibold text-foreground truncate">{profile?.full_name || "Admin"}</p>
                <p className="text-[11px] text-muted-foreground truncate">{isRestrictedSubAdmin ? "Sub-administrator" : "Super administrator"}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openAccountSwitcher();
                }}
                title="Switch account"
                aria-label="Switch account"
                className="relative h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Users className="h-4 w-4" />
                {savedAccounts.length > 1 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">{savedAccounts.length}</span>
                )}
              </button>
              <button type="button" onClick={handleSignOut} title="Sign out" aria-label="Sign out" className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={handleSignOut} aria-label="Sign out" className="mx-auto h-10 w-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10">
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Sign out</TooltipContent>
            </Tooltip>
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cn(
              "hidden md:flex mt-1 items-center gap-2 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
              rail ? "mx-auto h-10 w-10 justify-center" : "w-full h-8 px-2.5"
            )}
            aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          >
            {rail ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!rail && "Collapse"}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
};


/* ───────────── Orders hub tabs ───────────── */

const OrdersHubTabs = ({ items, activeQueueCount }: { items: NavItem[]; activeQueueCount: number }) => {
  const location = useLocation();
  const short = (label: string) => label.replace(/ Orders$/, "").replace("Non-Beneficiary List", "Non-beneficiary").replace("Submitted Numbers", "Submitted numbers").replace("AFA Registrations", "AFA");
  return (
    <nav aria-label="Order types" className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar">
      <ul className="flex items-center gap-1 px-4 sm:px-0 min-w-max border-b border-border/70 dark:border-white/[0.07]">
        {items.map((i) => {
          const active = location.pathname === i.path;
          return (
            <li key={i.path}>
              <Link
                to={i.path}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex items-center gap-1.5 h-10 px-3 text-[13px] font-semibold whitespace-nowrap transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <i.icon className="h-4 w-4" />
                {i.path === "/admin/orders" ? "All orders" : short(i.label)}
                {i.path === "/admin/orders" && activeQueueCount > 0 && (
                  <span className="rounded-md bg-sky-500/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-sky-700 dark:text-sky-300">{activeQueueCount}</span>
                )}
                {active && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

/* ───────────── Layout ───────────── */

const AdminLayout = () => {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => readJson<boolean>(COLLAPSE_KEY, false));
  const [cmdOpen, setCmdOpen] = useState(false);
  const [activeQueueCount, setActiveQueueCount] = useState(0);
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState(0);
  const [expressMode, setExpressMode] = useState(false);
  const [togglingExpress, setTogglingExpress] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date>(new Date());
  const [heartbeatOk, setHeartbeatOk] = useState(true);
  const { isDark, toggleDark } = useAppTheme();
  const { profile, user, signOut, openAccountSwitcher } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const fetchLiveHeaderTelemetry = useCallback(async () => {
    try {
      const [ordersCountRes, withdrawalsCountRes, bzProviderRes] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["processing", "pending"]),
        supabase.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("providers").select("id, settings, is_active").eq("handler_type", "bundlezone").limit(1).maybeSingle(),
      ]);
      if (typeof ordersCountRes.count === "number") setActiveQueueCount(ordersCountRes.count);
      if (typeof withdrawalsCountRes.count === "number") setPendingWithdrawalsCount(withdrawalsCountRes.count);
      if (bzProviderRes.data) {
        const bzSettings = (bzProviderRes.data as any).settings || {};
        setExpressMode(Boolean(bzSettings.express_mode_enabled));
      }
      setHeartbeatOk(!ordersCountRes.error);
      setLastHeartbeat(new Date());
    } catch {
      setHeartbeatOk(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveHeaderTelemetry();
    const interval = setInterval(fetchLiveHeaderTelemetry, 45000);
    const channel = supabase
      .channel("admin_header_telemetry")
      .on("postgres_changes", { event: "*", schema: "public", table: "system_settings" }, () => {
        fetchLiveHeaderTelemetry();
      })
      .subscribe();
    return () => {
      clearInterval(interval);
      safeRemoveChannel(channel);
    };
  }, [fetchLiveHeaderTelemetry]);

  const handleToggleExpressMode = async () => {
    if (togglingExpress) return;
    setTogglingExpress(true);
    const nextVal = !expressMode;
    try {
      const { data: bzProv, error: fetchErr } = await supabase
        .from("providers")
        .select("id, settings, is_active")
        .eq("handler_type", "bundlezone")
        .limit(1)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!bzProv) throw new Error("BundleZone provider not found");
      const nextSettings = { ...((bzProv as any).settings || {}), express_mode_enabled: nextVal };
      const { error } = await supabase
        .from("providers")
        .update({ is_active: nextVal ? true : (bzProv as any).is_active, settings: nextSettings } as any)
        .eq("id", bzProv.id);
      if (error) throw error;
      setExpressMode(nextVal);
      toast.success(nextVal ? "MTN Express mode on: MTN orders now route via BundleZone Express" : "MTN Express mode off: standard provider priority is active");
      window.dispatchEvent(new CustomEvent("swiftdata:admin-refresh"));
    } catch (err: any) {
      toast.error(err?.message || "Failed to toggle Express mode");
    } finally {
      setTogglingExpress(false);
    }
  };

  const handleQuickReconcileAndSync = async () => {
    if (syncingNow) return;
    setSyncingNow(true);
    const toastId = toast.loading("Reconciling orders and syncing providers…");
    try {
      const [retryRes, bulkCheckRes] = await Promise.allSettled([
        supabase.functions.invoke("cron-auto-retry", { body: {} }),
        supabase.functions.invoke("check-order-status", { body: { auto_bulk: true } }),
        supabase.functions.invoke("system-payout-v1", { body: { action: "get_provider_balance" } }),
      ]);
      await fetchLiveHeaderTelemetry();
      window.dispatchEvent(new CustomEvent("swiftdata:admin-refresh"));
      const retried = retryRes.status === "fulfilled" ? Number(retryRes.value.data?.dispatched ?? retryRes.value.data?.retried ?? 0) : 0;
      const fulfilled = bulkCheckRes.status === "fulfilled" ? Number(bulkCheckRes.value.data?.fulfilled ?? 0) : 0;
      toast.success(`Sync complete${fulfilled > 0 ? ` · ${fulfilled} order(s) fulfilled` : ""}${retried > 0 ? ` · ${retried} re-dispatched` : ""}`, { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || "Sync ran into an error", { id: toastId });
    } finally {
      setSyncingNow(false);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if (e.key === "Escape") setCmdOpen(false);
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  const { isRestrictedSubAdmin, userPerms } = getSubAdminInfo(profile);

  const allowedNavItems = NAV_SECTIONS.flatMap((s) => s.items).filter((item) => {
    if (!isRestrictedSubAdmin) return true;
    if (SUPER_ADMIN_ONLY_PATHS.has(item.path)) return false;
    if (item.path === "/admin/account-settings") return true;
    return item.permKey ? userPerms.includes(item.permKey) : false;
  });

  const isCurrentPathAllowed = () => {
    if (!isRestrictedSubAdmin) return true;
    const cleanPath = location.pathname.split("?")[0].replace(/\/$/, "");
    if (SUPER_ADMIN_ONLY_PATHS.has(cleanPath) || SUPER_ADMIN_ONLY_PATHS.has(location.pathname)) return false;
    if (location.pathname === "/admin/account-settings") return true;
    const mappedKey = ROUTE_PERM_MAP[cleanPath];
    if (mappedKey) return userPerms.includes(mappedKey);
    const currentItem = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.path === cleanPath);
    if (currentItem?.permKey) return userPerms.includes(currentItem.permKey);
    if (cleanPath.startsWith("/admin")) return false;
    return true;
  };

  const currentSection = NAV_SECTIONS.find((s) => s.items.some((i) => i.path === location.pathname));
  const currentPage = currentSection?.items.find((i) => i.path === location.pathname);
  const pathAllowed = isCurrentPathAllowed();

  useEffect(() => {
    if (isRestrictedSubAdmin && !pathAllowed) {
      const firstAllowed = allowedNavItems[0]?.path || "/admin/account-settings";
      if (firstAllowed && location.pathname !== firstAllowed) navigate(firstAllowed, { replace: true });
    }
  }, [isRestrictedSubAdmin, pathAllowed, location.pathname, allowedNavItems, navigate]);

  useEffect(() => {
    document.title = `${currentPage?.label || "Admin"} · SwiftData Admin`;
  }, [currentPage?.label]);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      writeJson(COLLAPSE_KEY, !c);
      return !c;
    });

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="admin-shell relative flex min-h-[100dvh] w-full bg-transparent text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-72 opacity-70 dark:opacity-100"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.06), transparent 70%)" }}
      />
      <AdminNotifications />
      <AdminCommandPalette open={cmdOpen} setOpen={setCmdOpen} onNavigate={(path) => navigate(path)} allowedItems={allowedNavItems} />

      <AdminSidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        activeQueueCount={activeQueueCount}
        pendingWithdrawalsCount={pendingWithdrawalsCount}
      />

      <div className="relative flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden">
        <header
          className="shrink-0 sticky top-0 z-40 border-b border-border/60 dark:border-white/[0.06] bg-background/60 backdrop-blur-xl"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
        >
          <div className="h-14 sm:h-16 flex items-center gap-2 sm:gap-3 px-3 sm:px-6">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="md:hidden h-9 w-9 -ml-1 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Menu className="h-5 w-5" />
            </button>

            <nav aria-label="Breadcrumb" className="min-w-0 flex items-center gap-1.5 text-sm">
              {currentSection && currentPage && currentSection.title !== "Main" ? (
                <>
                  <span className="hidden sm:inline text-muted-foreground truncate">{currentSection.title}</span>
                  <ChevronRight className="hidden sm:inline h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  <span className="font-semibold text-foreground truncate">{currentPage.label}</span>
                </>
              ) : (
                <span className="font-semibold text-foreground truncate">{currentPage?.label || "Admin"}</span>
              )}
            </nav>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="hidden lg:flex items-center gap-2 h-9 w-56 xl:w-64 rounded-xl border border-border/80 bg-card px-3 text-[13px] text-muted-foreground hover:text-foreground transition-colors dark:bg-white/[0.03] dark:border-white/[0.08]"
            >
              <Search className="h-4 w-4" />
              <span>Jump to…</span>
              <kbd className="ml-auto rounded-md border border-border bg-muted px-1.5 py-px text-[10px] font-medium">Ctrl K</kbd>
            </button>
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              aria-label="Search"
              className="lg:hidden h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Search className="h-[18px] w-[18px]" />
            </button>

            {!isRestrictedSubAdmin && (
              <>
                <button
                  type="button"
                  onClick={handleToggleExpressMode}
                  disabled={togglingExpress}
                  role="switch"
                  aria-checked={expressMode}
                  title={expressMode ? "MTN Express mode is on (BundleZone Express). Click to turn off." : "Turn on MTN Express mode (BundleZone Express)."}
                  className={cn(
                    "hidden lg:flex shrink-0 whitespace-nowrap items-center gap-2 h-9 pl-2.5 pr-2 rounded-xl border text-[12.5px] font-semibold transition-colors",
                    expressMode ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border/80 bg-card text-muted-foreground hover:text-foreground dark:bg-white/[0.03] dark:border-white/[0.08]"
                  )}
                >
                  {togglingExpress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className={cn("h-4 w-4", expressMode && "fill-current")} />}
                  MTN Express
                  <span className={cn("relative h-4 w-7 rounded-full transition-colors", expressMode ? "bg-amber-500" : "bg-muted-foreground/30")}>
                    <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]", expressMode ? "left-3.5" : "left-0.5")} />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleQuickReconcileAndSync}
                  disabled={syncingNow}
                  title={`Reconcile active orders and sync providers · last checked ${lastHeartbeat.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                  className="flex shrink-0 whitespace-nowrap items-center gap-1.5 h-9 px-2.5 rounded-xl border border-border/80 bg-card text-[12.5px] font-semibold text-foreground hover:bg-muted transition-colors dark:bg-white/[0.03] dark:border-white/[0.08]"
                >
                  <RefreshCw className={cn("h-4 w-4", syncingNow && "animate-spin")} />
                  <span className="hidden xl:inline">{syncingNow ? "Syncing…" : "Sync & check"}</span>
                  {activeQueueCount > 0 && <span className="rounded-md bg-sky-500/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-sky-700 dark:text-sky-300">{activeQueueCount}</span>}
                </button>
              </>
            )}

            <span
              title={heartbeatOk ? `Systems responding · checked ${lastHeartbeat.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Can't reach the database right now"}
              className={cn(
                "hidden sm:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl text-[12px] font-semibold",
                heartbeatOk ? "text-emerald-700 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", heartbeatOk ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} />
              <span className="hidden md:inline">{heartbeatOk ? "Live" : "Degraded"}</span>
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Account menu" className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                  <span className="text-[13px] font-semibold">{(profile?.full_name || "A").charAt(0).toUpperCase()}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-semibold truncate">{profile?.full_name || "Admin"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/admin/account-settings")} className="gap-2 rounded-lg">
                  <Key className="h-4 w-4" /> My security
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openAccountSwitcher} className="gap-2 rounded-lg">
                  <Users className="h-4 w-4" /> Switch account
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleDark} className="gap-2 rounded-lg">
                  {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {isDark ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                {!isRestrictedSubAdmin && (
                  <DropdownMenuItem onSelect={handleToggleExpressMode} className="gap-2 rounded-lg lg:hidden">
                    <Zap className="h-4 w-4" /> MTN Express: {expressMode ? "on" : "off"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSignOut} className="gap-2 rounded-lg text-rose-600 focus:text-rose-600 dark:text-rose-400">
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="relative flex-1 overflow-y-auto overflow-x-hidden bg-white/20 dark:bg-black/15 [-webkit-overflow-scrolling:touch]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6">
            {pathAllowed && currentSection?.title === "Operations & Orders" && (
              <OrdersHubTabs items={(allowedNavItems.filter((i) => currentSection.items.some((c) => c.path === i.path)) as NavItem[]).filter((i) => i.path.startsWith("/admin"))} activeQueueCount={activeQueueCount} />
            )}
            {pathAllowed ? (
              <Outlet />
            ) : (
              <div className="mx-auto max-w-md rounded-2xl border border-border bg-card/90 p-8 text-center">
                <span className="mx-auto h-12 w-12 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
                  <ShieldAlert className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">You don’t have access to this page</h3>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Your sub-admin role can’t open <strong className="text-foreground">{currentPage?.label || location.pathname}</strong>. Ask a super admin to grant access.
                </p>
                <button
                  type="button"
                  onClick={() => navigate(allowedNavItems[0]?.path || "/admin/account-settings")}
                  className="mt-5 h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-105"
                >
                  Go to a page I can use
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
