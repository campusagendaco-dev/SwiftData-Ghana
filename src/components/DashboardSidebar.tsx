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
  ChevronRight,
  Zap,
  Activity,
  Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const userNavItems = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/profile", label: "My Profile", icon: User },
  { to: "/dashboard/wallet", label: "Wallet", icon: Wallet },
  { to: "/dashboard/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/dashboard/buy-data/mtn", label: "Buy Data - MTN", icon: ShoppingCart },
  { to: "/dashboard/buy-data/telecel", label: "Buy Data - Telecel", icon: ShoppingCart },
  { to: "/dashboard/buy-data/airteltigo", label: "Buy Data - AirtelTigo", icon: ShoppingCart },
  { to: "/dashboard/my-store", label: "My Store", icon: Store },
  { to: "/dashboard/report-issue", label: "Report Issue", icon: Flag },
  { to: "/dashboard/customers", label: "Address Book", icon: Users2 },
  { to: "/dashboard/account-settings", label: "Account Settings", icon: UserCog },
];

const agentNavItems = [
  { to: "/dashboard/cheaper-prices", label: "Cheaper Prices", icon: CreditCard },
  { to: "/dashboard/withdrawals", label: "Withdrawals", icon: HandCoins },
  { to: "/dashboard/store-settings", label: "Store Settings", icon: Settings },
  { to: "/dashboard/subagents", label: "Subagents", icon: Users2 },
  { to: "/dashboard/subagent-pricing", label: "Subagent Pricing", icon: SlidersHorizontal },
  { to: "/dashboard/flyer", label: "Flyer Generator", icon: FileText },
  { to: "/dashboard/marketing", label: "Marketing Tools", icon: Zap },
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
  const { profile, signOut, user: authUser } = useAuth();
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
      {/* Mobile Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed md:sticky top-0 left-0 z-50 w-72 h-screen flex flex-col transition-all duration-300 ease-in-out md:translate-x-0 border-r border-white/5 shadow-2xl",
          "bg-[#0d140d]/95 backdrop-blur-xl",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* ── Premium Logo Section ── */}
        <div className="p-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute -inset-1 bg-primary/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
              <img src="/logo.png" alt="Logo" className="w-10 h-10 shrink-0 relative" />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center border-2 border-[#0d140d] shadow-lg">
                <ShieldCheck className="w-2.5 h-2.5 text-white" />
              </div>
            </div>
            <div>
              <p className="text-white font-black text-sm tracking-tight leading-tight group-hover:text-primary transition-colors">SwiftData GH</p>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Agent Console</p>
            </div>
          </Link>
          <button onClick={onClose} className="md:hidden p-2 rounded-full hover:bg-white/5 text-white/50 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Enhanced User Profile Section ── */}
        <div className="px-5 py-6">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
              <Zap className="w-12 h-12" />
            </div>
            <div className="flex items-center gap-3 relative z-10">
              <div className="relative">
                <Avatar className="w-11 h-11 border-2 border-primary/20 p-0.5">
                  <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${authUser?.id}`} />
                  <AvatarFallback className="bg-primary/10 text-xs">{profile?.full_name?.charAt(0) || "U"}</AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0d140d]"></div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-black truncate">{profile?.full_name || "User"}</p>
                <p className="text-primary text-[10px] font-mono font-bold">{accountId}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between relative z-10">
              <Badge className={cn(
                "h-5 text-[9px] font-black uppercase tracking-widest border-none",
                isPaidAgent ? "bg-amber-400 text-black shadow-[0_0_10px_rgba(251,191,36,0.3)]" : "bg-white/10 text-white/50"
              )}>
                {isPaidAgent ? "Pro Agent" : "Regular"}
              </Badge>
              <div className="flex items-center gap-1 text-green-500 text-[10px] font-bold">
                <Activity className="w-3 h-3" />
                Online
              </div>
            </div>
          </div>
        </div>

        {/* ── Sophisticated Navigation ── */}
        <nav className="flex-1 px-4 py-2 space-y-8 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {/* User Menu */}
          <div>
            <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-4 flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-white/20"></span>
              Core Services
            </p>
            <div className="space-y-1">
              {userNavItems.map((item) => {
                const isActive = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200",
                      isActive 
                        ? "text-white bg-gradient-to-r from-primary/20 to-transparent border-l-2 border-primary shadow-lg shadow-primary/5" 
                        : "text-white/50 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className={cn(
                        "w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                        isActive ? "text-primary" : "text-white/30 group-hover:text-white/60"
                      )} />
                      {item.label}
                    </div>
                    {isActive && <ChevronRight className="w-3 h-3 text-primary" />}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Agent Menu */}
          {isPaidAgent && (
            <div>
              <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-4 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-amber-400/40"></span>
                Business Suite
              </p>
              <div className="space-y-1">
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
                          "group flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200",
                          isActive 
                            ? "text-white bg-gradient-to-r from-amber-400/10 to-transparent border-l-2 border-amber-400 shadow-lg shadow-amber-400/5" 
                            : "text-white/50 hover:text-white hover:bg-white/5"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <item.icon className={cn(
                            "w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                            isActive ? "text-amber-400" : "text-white/30 group-hover:text-white/60"
                          )} />
                          {item.label}
                        </div>
                        {isActive && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                      </Link>
                    );
                  })}
              </div>
            </div>
          )}
        </nav>

        {/* ── Premium Footer ── */}
        <div className="p-4 border-t border-white/5">
          <button
            onClick={handleSignOut}
            className="flex items-center justify-center gap-3 w-full h-12 rounded-xl text-sm font-black text-red-400/80 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            Sign Out Securely
          </button>
        </div>
      </aside>
    </>
  );
};

export default DashboardSidebar;

