import { useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AdminNotifications from "@/components/AdminNotifications";
import { LayoutDashboard, Users, ShieldCheck, ShoppingCart, LogOut, Menu, Wallet, Bell, Package, CreditCard, Activity, Settings, ChevronRight, BarChart3, Ticket, LifeBuoy, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, path: "/admin" },
  { label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
  { label: "Agents", icon: ShieldCheck, path: "/admin/agents" },
  { label: "Orders", icon: ShoppingCart, path: "/admin/orders" },
  { label: "Packages", icon: Package, path: "/admin/packages" },
  { label: "Promo Codes", icon: Ticket, path: "/admin/promotions" },
  { label: "Wallet Top-Up", icon: CreditCard, path: "/admin/wallet-topup" },
  { label: "Withdrawals", icon: Wallet, path: "/admin/withdrawals" },
  { label: "Support Tickets", icon: LifeBuoy, path: "/admin/tickets" },
  { label: "Notifications", icon: Bell, path: "/admin/notifications" },
  { label: "Users", icon: Users, path: "/admin/users" },
  { label: "System Health", icon: Activity, path: "/admin/system-health" },
  { label: "Audit Logs", icon: FileSearch, path: "/admin/audit-logs" },
  { label: "Settings", icon: Settings, path: "/admin/settings" },
];

const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    onNavigate?.();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] border-r border-white/5 relative overflow-hidden">
      {/* Decorative Glow */}
      <div className="absolute top-0 left-0 w-full h-32 bg-amber-500/10 blur-[50px] pointer-events-none" />

      {/* Logo */}
      <div className="p-6 flex items-center gap-4 relative z-10">
        <div className="bg-white/5 p-2 rounded-xl border border-white/10 shadow-lg backdrop-blur-sm">
          <img src="/logo.png" alt="SwiftData Ghana" className="w-8 h-8 shrink-0" />
        </div>
        <div>
          <p className="text-white font-black tracking-tight leading-none text-lg">Admin<span className="text-amber-400">Pro</span></p>
          <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">Control Center</p>
        </div>
      </div>

      <nav className="flex-1 px-4 overflow-y-auto space-y-1 py-2 relative z-10 scrollbar-none">
        <p className="text-white/30 text-[10px] font-black uppercase tracking-[0.2em] px-2 mb-4 mt-2">Main Menu</p>
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onNavigate}
                className={`group flex items-center justify-between px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-amber-400/10 text-amber-400 border border-amber-400/20 shadow-[0_0_15px_rgba(251,191,36,0.05)]"
                    : "text-white/60 hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-amber-400" : "text-white/40 group-hover:text-white/80"}`} />
                  {item.label}
                </div>
                {isActive && <ChevronRight className="w-4 h-4 text-amber-400/50" />}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="p-4 relative z-10 mt-auto">
        <button
          onClick={handleSignOut}
          className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold text-white bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all text-red-400 shadow-sm"
        >
          <LogOut className="w-4 h-4" />
          Sign Out safely
        </button>
      </div>
    </div>
  );
};

const AdminLayout = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-[#030305] text-white selection:bg-amber-400/30">
      <AdminNotifications />
      
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[280px] flex-col shrink-0">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        {/* Subtle Background Elements */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-500/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-amber-500/5 blur-[150px] rounded-full pointer-events-none" />

        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-3 p-4 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/5 sticky top-0 z-30">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10 rounded-xl">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[85vw] max-w-[280px] bg-transparent border-none">
              <SidebarContent onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-3">
            <div className="bg-white/5 p-1.5 rounded-lg border border-white/10">
              <img src="/logo.png" alt="SwiftData Ghana" className="w-6 h-6 shrink-0" />
            </div>
            <span className="font-display text-lg font-black tracking-tight">Admin<span className="text-amber-400">Pro</span></span>
          </div>
        </header>

        {/* Scrollable Main Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-10 relative z-10 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
