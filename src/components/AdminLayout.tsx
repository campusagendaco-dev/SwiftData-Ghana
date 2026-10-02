import { useState, useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import AdminNotifications from "@/components/AdminNotifications";
import {
  LayoutDashboard, Users, ShieldCheck, ShoppingCart, LogOut, Menu,
  Wallet, Bell, Package, CreditCard, Activity, Settings, ChevronRight,
  BarChart3, Ticket, LifeBuoy, FileSearch, Key, TrendingUp, Sun, Moon,
  Sparkles, Image as ImageIcon, Users2, ScrollText,
  Megaphone, Flag, MessageSquare, Banknote, UserCheck, LineChart, Brain,
  ShieldAlert, Search, Command, Zap, Phone, Lightbulb, RotateCcw, ListCheck, Send, PhoneCall, GraduationCap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TraditionalBackground } from "@/components/TraditionalBackground";

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
      { label: "Airtime Orders", icon: Phone,        path: "/admin/airtime-orders", permKey: "orders" },
      { label: "Mash Up Orders", icon: Zap,          path: "/admin/mashup-orders", permKey: "orders" },
      { label: "Utility Orders", icon: Lightbulb,    path: "/admin/utility-orders", permKey: "orders" },
      { label: "Standard Orders", icon: Package,     path: "/admin/standard-orders", permKey: "orders" },
      { label: "Checker Orders",  icon: GraduationCap, path: "/admin/checker-orders", permKey: "orders" },
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

// ── COMMAND PALETTE COMPONENT ──────────────────────────────────────────────────
const AdminCommandPalette = ({ open, setOpen, onNavigate, allowedItems }: { open: boolean, setOpen: (v: boolean) => void, onNavigate: (p: string) => void, allowedItems: NavItem[] }) => {
  const [query, setQuery] = useState("");
  const { isDark } = useAppTheme();
  
  const filtered = query ? allowedItems.filter(i => i.label.toLowerCase().includes(query.toLowerCase())) : [];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 backdrop-blur-sm" style={{ backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)" }} onClick={() => setOpen(false)}>
      <div 
        className={`w-full max-w-2xl rounded-3xl overflow-hidden border shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] animate-in fade-in zoom-in-95 duration-200 ${
          isDark ? "bg-[#111116]/95 border-white/10 backdrop-blur-3xl" : "bg-white/95 border-gray-200 backdrop-blur-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center gap-3 px-5 py-4 border-b ${isDark ? "border-white/10" : "border-gray-100"}`}>
          <Search className={`w-5 h-5 ${isDark ? "text-white/40" : "text-gray-400"}`} />
          <input
            autoFocus
            type="text"
            placeholder="Search commands, pages, or settings..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`flex-1 bg-transparent border-none outline-none text-lg font-semibold ${isDark ? "text-white placeholder:text-white/30" : "text-gray-900 placeholder:text-gray-400"}`}
          />
          <div className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border ${isDark ? "bg-white/5 border-white/10 text-white/40" : "bg-gray-100 border-gray-200 text-gray-500"}`}>
            ESC
          </div>
        </div>
        
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {query && filtered.length === 0 ? (
            <div className="p-8 text-center">
              <Search className={`w-8 h-8 mx-auto mb-3 ${isDark ? "text-white/20" : "text-gray-300"}`} />
              <p className={`text-sm font-semibold ${isDark ? "text-white/50" : "text-gray-500"}`}>No results found.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {(query ? filtered : allowedItems.slice(0, 6)).map((item) => (
                <button
                  key={item.path}
                  onClick={() => { onNavigate(item.path); setOpen(false); }}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-all hover:scale-[0.99] group ${
                    isDark ? "hover:bg-amber-400/10 text-white/70 hover:text-white" : "hover:bg-amber-50 text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors ${
                      isDark ? "bg-white/5 border-white/10 group-hover:bg-amber-400/20 group-hover:border-amber-400/30 group-hover:text-amber-400" : "bg-gray-50 border-gray-200 group-hover:bg-amber-100 group-hover:border-amber-200 group-hover:text-amber-600"
                    }`}>
                      <item.icon className="w-4 h-4" />
                    </div>
                    <span className="font-semibold">{item.label}</span>
                  </div>
                  <ChevronRight className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? "text-amber-400" : "text-amber-600"}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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
  const isRestrictedByPerms = markupsObj.hasOwnProperty("admin_permissions") && perms.length < 8 && !isMasterAdminEmail;

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

const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { signOut, profile } = useAuth();
  const { isDark, toggleDark } = useAppTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    onNavigate?.();
    navigate("/login", { replace: true });
  };

  const isActive = (path: string) => location.pathname === path;

  // Granular Sub-Admin Filter
  const { isRestrictedSubAdmin, userPerms } = getSubAdminInfo(profile);

  const filteredSections = NAV_SECTIONS.map((section) => {
    if (!isRestrictedSubAdmin) return section;
    const allowedItems = section.items.filter((item) => {
      if (SUPER_ADMIN_ONLY_PATHS.has(item.path)) return false;
      if (item.path === "/admin/account-settings") return true;
      return item.permKey ? userPerms.includes(item.permKey) : false;
    });
    return { ...section, items: allowedItems };
  }).filter((section) => section.items.length > 0);

  return (
    <div className={`flex flex-col h-full relative overflow-hidden ${isDark ? "bg-[#0a0a0f]" : "bg-white"}`}>
      {/* Ambient glow */}
      <div className={`absolute top-0 left-0 w-full h-32 blur-[50px] pointer-events-none ${isDark ? "bg-amber-500/8" : "bg-amber-400/5"}`} />

      {/* Logo */}
      <div className="p-5 flex items-center gap-3 relative z-10">
        <div className="relative shrink-0">
          <div className={`p-2 rounded-xl border shadow-sm ${isDark ? "bg-white/5 border-white/10" : "bg-gray-50 border-gray-200"}`}>
            <img src="/logo.png" alt="SwiftData Ghana" className="w-8 h-8" />
          </div>
          <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center border-2 shadow-lg ${isDark ? "border-[#0a0a0f]" : "border-white"}`}>
            <ShieldCheck className="w-3 h-3 text-white" />
          </div>
        </div>
        <div className="min-w-0">
          <p className={`font-black tracking-tight leading-none text-base ${isDark ? "text-white" : "text-gray-900"}`}>
            Admin<span className="text-amber-500">Pro</span>
          </p>
          <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${isDark ? "text-white/35" : "text-gray-400"}`}>
            {isRestrictedSubAdmin ? "Sub-Admin Portal" : "Control Center"}
          </p>
        </div>
      </div>

      {/* User info strip */}
      {profile && (
        <div className={`mx-4 mb-3 px-3 py-2.5 rounded-xl border flex items-center gap-2.5 ${isDark ? "bg-white/[0.03] border-white/5" : "bg-gray-50 border-gray-200"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isDark ? "bg-amber-400/15 border border-amber-400/20" : "bg-amber-50 border border-amber-200"}`}>
            <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="min-w-0">
            <p className={`text-xs font-bold truncate leading-none ${isDark ? "text-white/90" : "text-gray-800"}`}>{profile.full_name || "Admin"}</p>
            <p className={`text-[10px] mt-0.5 truncate ${isDark ? "text-white/35" : "text-gray-400"}`}>
              {isRestrictedSubAdmin ? "Sub-Administrator" : "Super Administrator"}
            </p>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 overflow-y-auto py-1 relative z-10 scrollbar-none space-y-4">
        {filteredSections.map((section) => (
          <div key={section.title}>
            <p className={`text-[10px] font-black uppercase tracking-[0.2em] px-2 mb-1.5 ${isDark ? "text-white/25" : "text-gray-400"}`}>
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onNavigate}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 border ${
                      active
                        ? isDark
                          ? "bg-amber-400/10 text-amber-400 border-amber-400/20 shadow-[0_0_12px_rgba(251,191,36,0.04)]"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                        : isDark
                          ? "text-white/55 hover:text-white hover:bg-white/5 border-transparent"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <item.icon className={`w-4 h-4 shrink-0 transition-colors ${
                        active
                          ? "text-amber-500"
                          : isDark
                            ? "text-white/35 group-hover:text-white/70"
                            : "text-gray-400 group-hover:text-gray-600"
                      }`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {active && <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-amber-400/40" : "text-amber-500/50"}`} />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer controls */}
      <div className="p-3 relative z-10 space-y-2">
        <button
          onClick={toggleDark}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
            isDark ? "bg-white/5 border-white/10 text-white/70 hover:bg-white/10" : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-gray-600" />}
          <span>{isDark ? "Light Interface" : "Dark Interface"}</span>
        </button>

        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-red-500 border border-red-500/20 bg-red-500/8 hover:bg-red-500/15 transition-all"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </div>
  );
};

const AdminLayout = () => {
  const [open, setOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const { isDark, toggleDark } = useAppTheme();
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
      if (e.key === "Escape") setCmdOpen(false);
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const { isRestrictedSubAdmin, userPerms } = getSubAdminInfo(profile);

  const allowedNavItems = NAV_SECTIONS.flatMap(s => s.items).filter(item => {
    if (!isRestrictedSubAdmin) return true;
    if (SUPER_ADMIN_ONLY_PATHS.has(item.path)) return false;
    if (item.path === "/admin/account-settings") return true;
    return item.permKey ? userPerms.includes(item.permKey) : false;
  });

  const isCurrentPathAllowed = () => {
    if (!isRestrictedSubAdmin) return true;

    const cleanPath = location.pathname.split("?")[0].replace(/\/$/, "");

    // Immediately reject all Super Admin only paths for restricted sub-admins
    if (SUPER_ADMIN_ONLY_PATHS.has(cleanPath) || SUPER_ADMIN_ONLY_PATHS.has(location.pathname)) {
      return false;
    }

    if (location.pathname === "/admin/account-settings") return true;

    const mappedKey = ROUTE_PERM_MAP[cleanPath];

    if (mappedKey) {
      return userPerms.includes(mappedKey);
    }

    const currentItem = NAV_SECTIONS.flatMap(s => s.items).find(i => i.path === cleanPath);
    if (currentItem?.permKey) {
      return userPerms.includes(currentItem.permKey);
    }

    // Block any unmapped /admin route for restricted sub-admins
    if (cleanPath.startsWith("/admin")) {
      return false;
    }

    return true;
  };

  const currentPage = NAV_SECTIONS.flatMap((s) => s.items).find(
    (item) => location.pathname === item.path,
  );

  const pathAllowed = isCurrentPathAllowed();

  // Auto-redirect sub-admins away from unpermitted root paths (e.g. landing on /admin when lacking "overview" permission)
  useEffect(() => {
    if (isRestrictedSubAdmin && !pathAllowed) {
      const firstAllowed = allowedNavItems[0]?.path || "/admin/account-settings";
      if (firstAllowed && location.pathname !== firstAllowed) {
        navigate(firstAllowed, { replace: true });
      }
    }
  }, [isRestrictedSubAdmin, pathAllowed, location.pathname, allowedNavItems, navigate]);

  return (
    <div className={`min-h-screen flex selection:bg-amber-400/30 bg-[#050508] relative ${isDark ? "text-white" : "text-gray-900 bg-gray-50"}`}>
      <TraditionalBackground className="fixed inset-0 z-0 opacity-10 dark:opacity-20 pointer-events-none" />
      <AdminNotifications />
      <AdminCommandPalette open={cmdOpen} setOpen={setCmdOpen} onNavigate={(path) => navigate(path)} allowedItems={allowedNavItems} />

      {/* Desktop Sidebar - FLOATING GLASS */}
      <aside className="hidden md:flex w-[280px] flex-col shrink-0 sticky top-0 h-screen p-4 pr-2">
        <div className={`flex-1 rounded-[24px] overflow-hidden border backdrop-blur-3xl shadow-2xl flex flex-col ${
          isDark ? "bg-[#0a0a0f]/60 border-white/10" : "bg-white/80 border-gray-200"
        }`}>
          <SidebarContent />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Deep Ambient Background Mesh */}
        <div className="hidden md:block fixed inset-0 z-0 pointer-events-none overflow-hidden opacity-80">
          <div className={`absolute top-0 right-0 w-[600px] h-[600px] blur-[150px] rounded-full mix-blend-screen transition-colors duration-2000 ${isDark ? "bg-indigo-500/10" : "bg-blue-400/5"}`} />
          <div className={`absolute bottom-0 left-1/4 w-[500px] h-[500px] blur-[150px] rounded-full mix-blend-screen transition-colors duration-2000 ${isDark ? "bg-amber-500/10" : "bg-amber-400/5"}`} />
          <div className={`absolute -top-1/4 left-1/3 w-[800px] h-[400px] blur-[150px] rounded-full mix-blend-screen transition-colors duration-2000 ${isDark ? "bg-emerald-500/5" : "bg-emerald-400/5"}`} />
        </div>

        {/* Top bar - FLOATING ISLAND */}
        <div className="px-4 md:px-6 pt-4 pb-2 z-30 sticky top-0">
          <header className="glass-panel-cyber flex items-center gap-4 px-5 h-[64px] rounded-[24px]">
            {/* Mobile hamburger */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`md:hidden rounded-xl ${isDark ? "text-white/70 hover:text-white hover:bg-white/10" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"}`}
                >
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className={`p-0 w-[85vw] max-w-[280px] border-y-0 border-l-0 shadow-2xl ${
                  isDark ? "bg-[#0a0a0f] text-white border-r border-white/10" : "bg-white text-gray-900 border-r border-gray-200"
                }`}
              >
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <SheetDescription className="sr-only">
                  Access administrative navigation links and tools.
                </SheetDescription>
                <SidebarContent onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>

            {/* Mobile branding */}
            <div className="md:hidden flex items-center gap-2">
              <div className="relative">
                <div className={`p-1.5 rounded-lg border ${isDark ? "bg-white/5 border-white/10" : "bg-white border-gray-200"}`}>
                  <img src="/logo.png" alt="SwiftData Ghana" className="w-5 h-5" />
                </div>
              </div>
              <span className={`font-black tracking-tight text-base ${isDark ? "text-white" : "text-gray-900"}`}>
                Admin<span className="text-amber-500">Pro</span>
              </span>
            </div>

            {/* Page title & Cmd+K prompt */}
            <div className="hidden md:flex items-center gap-3 flex-1">
              {currentPage && (
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg border shadow-sm ${isDark ? "bg-white/5 border-white/10" : "bg-gray-50 border-gray-200"}`}>
                    <currentPage.icon className={`w-4 h-4 ${isDark ? "text-white/70" : "text-gray-600"}`} />
                  </div>
                  <span className={`text-sm font-black tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>{currentPage.label}</span>
                </div>
              )}
              <div className={`h-4 w-px mx-1 ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
              <button 
                onClick={() => setCmdOpen(true)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors group ${
                  isDark ? "bg-black/20 border-white/5 hover:border-white/15 text-white/40 hover:text-white/70" : "bg-gray-50 border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-600"
                }`}
              >
                <Command className="w-3.5 h-3.5 group-hover:text-amber-500 transition-colors" />
                Search or jump to...
                <span className={`ml-2 px-1.5 py-0.5 rounded flex items-center gap-0.5 font-mono text-[9px] font-black border ${isDark ? "bg-white/5 border-white/10 text-white/30" : "bg-white border-gray-200 text-gray-500"}`}>
                  <Command className="w-2.5 h-2.5" /> K
                </span>
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2.5">
              {/* Dark/light toggle */}
              <button
                onClick={toggleDark}
                className={`hidden md:flex w-9 h-9 items-center justify-center rounded-xl transition-all border ${
                  isDark ? "text-white/50 hover:text-amber-400 hover:bg-amber-400/10 border-white/5 hover:border-amber-400/20" : "text-gray-500 hover:text-amber-600 hover:bg-amber-50 border-gray-200 hover:border-amber-200"
                }`}
                title={isDark ? "Light Mode" : "Dark Mode"}
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              <div className={`badge-status-glow flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-black shadow-inner uppercase tracking-widest ${
                isDark ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-emerald-50 border-emerald-200 text-emerald-600"
              }`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                {isRestrictedSubAdmin ? "Sub-Admin Active" : "Live System"}
              </div>
            </div>
          </header>
        </div>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 relative z-10 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent [will-change:transform] [-webkit-overflow-scrolling:touch]">
          <div className="mx-auto max-w-7xl space-y-6">
            {pathAllowed ? (
              <Outlet />
            ) : (
              <div className="py-20 text-center glass-card-neo rounded-3xl border border-rose-500/30 p-8 max-w-xl mx-auto space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto text-rose-400">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-foreground">Access Restricted for Sub-Admin</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your sub-admin role does not have permission to access the <strong>{currentPage?.label || location.pathname}</strong> module. Please contact a Super Administrator to grant you access.
                </p>
                <Button
                  onClick={() => navigate(allowedNavItems[0]?.path || "/admin/account-settings")}
                  className="rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs h-10 px-5 border-0 shadow-md"
                >
                  Go to Permitted Page
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
