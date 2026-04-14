import { useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard, Users, ShieldCheck, ShoppingCart, LogOut, Menu, Wallet, Bell, Package, CreditCard, Activity, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, path: "/admin" },
  { label: "Agents", icon: ShieldCheck, path: "/admin/agents" },
  { label: "Orders", icon: ShoppingCart, path: "/admin/orders" },
  { label: "Packages", icon: Package, path: "/admin/packages" },
  { label: "Wallet Top-Up", icon: CreditCard, path: "/admin/wallet-topup" },
  { label: "Withdrawals", icon: Wallet, path: "/admin/withdrawals" },
  { label: "Notifications", icon: Bell, path: "/admin/notifications" },
  { label: "Users", icon: Users, path: "/admin/users" },
  { label: "System Health", icon: Activity, path: "/admin/system-health" },
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
    <div className="flex flex-col h-full bg-[#162316]">
      {/* Logo */}
      <div className="p-5 flex items-center gap-3 border-b border-white/10">
        <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0 shadow-md">
          <span className="text-[#162316] font-black text-[10px] text-center leading-tight">SWIFT<br/>DATA</span>
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-tight">SwiftData GH</p>
          <p className="text-white/50 text-xs">Admin Console</p>
        </div>
      </div>
      <nav className="flex-1 p-3 overflow-y-auto">
        <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-3 mb-2">Menu</p>
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onNavigate}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#243824] text-white"
                    : "text-white/70 hover:text-white hover:bg-white/5"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="p-3 border-t border-white/10">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
};

const AdminLayout = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex">
      <AdminNotifications />
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-[#162316] flex-col">
        <SidebarContent />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-3 p-3 bg-[#162316] sticky top-0 z-30">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-[85vw] max-w-[20rem] bg-[#162316] overflow-y-auto border-r-0">
              <SidebarContent onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
              <span className="text-[#162316] font-black text-[8px] text-center leading-tight">SWIFT<br/>DATA</span>
            </div>
            <span className="font-display text-base font-bold text-white">Admin</span>
            </div>
      </div>
    </div>
  );
};

export default AdminLayout;
