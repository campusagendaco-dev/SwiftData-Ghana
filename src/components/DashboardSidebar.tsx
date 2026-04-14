import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard, ShoppingCart, UserPlus, LogOut, X, Settings, ClipboardList, Wallet, CreditCard, FileText, User } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dashboard/wallet", label: "Bulk Orders", icon: ShoppingCart },
  { to: "/dashboard/afa", label: "AFA Registration", icon: UserPlus },
  { to: "/dashboard/orders", label: "Orders", icon: ClipboardList },
  { to: "/dashboard/withdraw", label: "Withdrawals", icon: Wallet },
  { to: "/dashboard/pricing", label: "Store Pricing", icon: CreditCard },
  { to: "/dashboard/flyer", label: "Flyer Generator", icon: FileText },
  { to: "/dashboard/settings", label: "Store Settings", icon: Settings },
];

interface DashboardSidebarProps {
  open: boolean;
  onClose: () => void;
}

const DashboardSidebar = ({ open, onClose }: DashboardSidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const topupRef = (profile as any)?.topup_reference;
  const agentId = topupRef ? `DH-${topupRef}` : "DH-Agent";

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed md:sticky top-0 left-0 z-50 w-64 h-screen flex flex-col transition-transform duration-200 ease-in-out md:translate-x-0",
          "bg-[#162316]",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="p-5 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0 shadow-md">
              <span className="text-[#162316] font-black text-[10px] text-center leading-tight">DATA<br/>HIVE</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">DataHive GH</p>
              <p className="text-white/50 text-xs">Agent Console</p>
            </div>
          </div>
          <button onClick={onClose} className="md:hidden text-white/50 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-white/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">{profile?.full_name || "Agent"}</p>
              <p className="text-amber-400 text-xs truncate">{agentId}</p>
            </div>
          </div>
          <div className="mt-2">
            <span className="bg-amber-400 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
              Agent
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-3 mb-2">Menu</p>
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-[#243824] text-white"
                      : "text-white/70 hover:text-white hover:bg-white/5"
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
};

export default DashboardSidebar;
