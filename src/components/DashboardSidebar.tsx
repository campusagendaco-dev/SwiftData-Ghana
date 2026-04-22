import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import {
  LayoutDashboard,
  Wallet,
  ClipboardList,
  ShoppingCart,
  Store,
  Flag,
  UserCog,
  CreditCard,
  HandCoins,
  Settings,
  Users2,
  SlidersHorizontal,
  FileText,
  GraduationCap,
  LogOut,
  X,
  User,
  Key,
  Trophy,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const userNavItems = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/wallet", label: "Wallet", icon: Wallet },
  { to: "/dashboard/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/dashboard/buy-data/mtn", label: "Buy Data - MTN", icon: ShoppingCart },
  { to: "/dashboard/buy-data/telecel", label: "Buy Data - Telecel", icon: ShoppingCart },
  { to: "/dashboard/buy-data/airteltigo", label: "Buy Data - AirtelTigo", icon: ShoppingCart },
  { to: "/dashboard/my-store", label: "My Store", icon: Store },
  { to: "/dashboard/report-issue", label: "Report Issue", icon: Flag },
  { to: "/dashboard/account-settings", label: "Account Settings", icon: UserCog },
];

const agentNavItems = [
  { to: "/dashboard/cheaper-prices", label: "Cheaper Prices", icon: CreditCard },
  { to: "/dashboard/withdrawals", label: "Withdrawals", icon: HandCoins },
  { to: "/dashboard/store-settings", label: "Store Settings", icon: Settings },
  { to: "/dashboard/subagents", label: "Subagents", icon: Users2 },
  { to: "/dashboard/subagent-pricing", label: "Subagent Pricing", icon: SlidersHorizontal },
  { to: "/dashboard/flyer", label: "Flyer Generator", icon: FileText },
  { to: "/dashboard/result-checker", label: "Result Checker", icon: GraduationCap },
  { to: "/dashboard/api", label: "Developer API", icon: Key },
  { to: "/dashboard/leaderboard", label: "Agent Leaderboard", icon: Trophy },
];

interface DashboardSidebarProps {
  open: boolean;
  onClose: () => void;
}

const DashboardSidebar = ({ open, onClose }: DashboardSidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { theme } = useAppTheme();
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);

  const topupRef = (profile as any)?.topup_reference;
  const accountId = topupRef ? `DH-${topupRef}` : "DH-USER";

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
            <div className="relative">
            <img src="/logo.png" alt="SwiftData Ghana" className="w-12 h-12 shrink-0" />
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center border-2 border-[#0d0d18] shadow-lg">
              <ShieldCheck className="w-3 h-3 text-white" />
            </div>
          </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">SwiftData GH</p>
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
              <p className="text-white text-sm font-semibold truncate">{profile?.full_name || "User"}</p>
              <p className="text-amber-400 text-xs truncate">{accountId}</p>
            </div>
          </div>
          <div className="mt-2">
            <span className="bg-amber-400 text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
              {isPaidAgent ? "Paid Agent" : "User"}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-3 mb-2">User Menu</p>
          <div className="space-y-0.5 mb-4">
            {userNavItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive ? "text-white" : "text-white/70 hover:text-white hover:bg-white/5"
                  )}
                  style={isActive ? { background: `hsl(${theme.primary}/0.22)`, borderLeft: `3px solid hsl(${theme.primary})` } : {}}
                >
                  <item.icon className="w-4 h-4 shrink-0" style={isActive ? { color: `hsl(${theme.primary})` } : {}} />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {isPaidAgent && (
            <>
              <p className="text-white/30 text-[10px] font-semibold uppercase tracking-wider px-3 mb-2">Agent Menu</p>
              <div className="space-y-0.5">
                {agentNavItems
                  .filter(
                    (item) => !((profile as any)?.is_sub_agent && ["/dashboard/subagents", "/dashboard/subagent-pricing"].includes(item.to)),
                  )
                  .map((item) => {
                    const isActive = location.pathname === item.to;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                          isActive ? "text-white" : "text-white/70 hover:text-white hover:bg-white/5"
                        )}
                        style={isActive ? { background: `hsl(${theme.primary}/0.22)`, borderLeft: `3px solid hsl(${theme.primary})` } : {}}
                      >
                        <item.icon className="w-4 h-4 shrink-0" style={isActive ? { color: `hsl(${theme.primary})` } : {}} />
                        {item.label}
                      </Link>
                    );
                  })}
              </div>
            </>
          )}
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
