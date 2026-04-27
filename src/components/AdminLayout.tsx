import { useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import AdminNotifications from "@/components/AdminNotifications";
import {
  LayoutDashboard, Users, ShieldCheck, ShoppingCart, LogOut, Menu,
  Wallet, Bell, Package, CreditCard, Activity, Settings, ChevronRight,
  BarChart3, Ticket, LifeBuoy, FileSearch, Key, TrendingUp, Sun, Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const NAV_SECTIONS = [
  {
    title: "Main",
    items: [
      { label: "Overview",   icon: LayoutDashboard, path: "/admin" },
      { label: "Analytics",  icon: BarChart3,        path: "/admin/analytics" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Agents",       icon: ShieldCheck,  path: "/admin/agents" },
      { label: "Orders",       icon: ShoppingCart, path: "/admin/orders" },
      { label: "Packages",     icon: Package,      path: "/admin/packages" },
      { label: "Promo Codes",  icon: Ticket,       path: "/admin/promotions" },
      { label: "Wallet Top-Up",icon: CreditCard,   path: "/admin/wallet-topup" },
      { label: "Withdrawals",  icon: Wallet,        path: "/admin/withdrawals" },
      { label: "Profits",      icon: TrendingUp,   path: "/admin/profits" },
    ],
  },
  {
    title: "Support & Users",
    items: [
      { label: "Support Tickets", icon: LifeBuoy,   path: "/admin/tickets" },
      { label: "Notifications",   icon: Bell,        path: "/admin/notifications" },
      { label: "Users",           icon: Users,       path: "/admin/users" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "System Health", icon: Activity,   path: "/admin/system-health" },
      { label: "Audit Logs",    icon: FileSearch, path: "/admin/audit-logs" },
      { label: "API Users",     icon: Key,        path: "/admin/api-users" },
      { label: "Settings",      icon: Settings,   path: "/admin/settings" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "My Security",   icon: Key,        path: "/admin/account-settings" },
    ],
  },
];

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

  return (
    <div className={`flex flex-col h-full border-r relative overflow-hidden ${isDark ? "bg-[#0a0a0f] border-white/5" : "bg-white border-gray-200"}`}>
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
          <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${isDark ? "text-white/35" : "text-gray-400"}`}>Control Center</p>
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
            <p className={`text-[10px] mt-0.5 truncate ${isDark ? "text-white/35" : "text-gray-400"}`}>Administrator</p>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 overflow-y-auto py-1 relative z-10 scrollbar-none space-y-4">
        {NAV_SECTIONS.map((section) => (
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
        {/* Dark/Light toggle */}
        <button
          onClick={toggleDark}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
            isDark
              ? "text-white/55 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border-white/5"
              : "text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border-gray-200"
          }`}
        >
          {isDark
            ? <><Sun className="w-4 h-4 text-amber-400" /><span>Switch to Light Mode</span></>
            : <><Moon className="w-4 h-4 text-gray-500" /><span>Switch to Dark Mode</span></>
          }
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
  const { isDark, toggleDark } = useAppTheme();
  const location = useLocation();

  const currentPage = NAV_SECTIONS.flatMap((s) => s.items).find(
    (item) => location.pathname === item.path,
  );

  return (
    <div className={`min-h-screen flex selection:bg-amber-400/30 ${isDark ? "bg-[#030305] text-white" : "bg-gray-50 text-gray-900"}`}>
      <AdminNotifications />

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[260px] flex-col shrink-0 sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Ambient blobs */}
        <div className={`fixed top-0 right-0 w-[500px] h-[500px] blur-[120px] rounded-full pointer-events-none ${isDark ? "bg-blue-500/4" : "bg-blue-400/3"}`} />
        <div className={`fixed bottom-0 left-1/3 w-[400px] h-[400px] blur-[150px] rounded-full pointer-events-none ${isDark ? "bg-amber-500/4" : "bg-amber-400/3"}`} />

        {/* Top bar */}
        <header className={`sticky top-0 z-30 flex items-center gap-4 px-4 md:px-6 h-[60px] border-b backdrop-blur-xl ${
          isDark ? "bg-[#030305]/90 border-white/5" : "bg-gray-50/95 border-gray-200"
        }`}>
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
            <SheetContent side="left" className="p-0 w-[85vw] max-w-[260px] bg-transparent border-none">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
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

          {/* Page title — desktop */}
          {currentPage && (
            <div className="hidden md:flex items-center gap-2">
              <currentPage.icon className={`w-4 h-4 ${isDark ? "text-white/40" : "text-gray-400"}`} />
              <span className={`text-sm font-semibold ${isDark ? "text-white/70" : "text-gray-700"}`}>{currentPage.label}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Dark/light toggle — desktop only in header */}
            <button
              onClick={toggleDark}
              className={`hidden md:flex w-8 h-8 items-center justify-center rounded-xl transition-all ${
                isDark ? "text-white/50 hover:text-white hover:bg-white/8" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
              title={isDark ? "Light Mode" : "Dark Mode"}
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className={`h-5 w-px ${isDark ? "bg-white/8" : "bg-gray-200"}`} />

            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold ${
              isDark ? "bg-amber-400/8 border-amber-400/15 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-700"
            }`}>
              <ShieldCheck className="w-3.5 h-3.5" />
              Admin
            </div>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 relative z-10 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
