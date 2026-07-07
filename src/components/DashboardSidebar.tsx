import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Bell,
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
  ChevronDown,
  Zap,
  Activity,
  Star,
  MessageCircle,
  Gift,
  Send,
  Bot,
  CalendarClock,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useConnectivity } from "@/hooks/useConnectivity";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Clock } from "lucide-react";


const userNavItems = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/profile", label: "My Profile", icon: User },
  { to: "/dashboard/account-settings", label: "Account & Security", icon: UserCog },
  { to: "/dashboard/wallet", label: "Account Balance", icon: Wallet },
  { to: "/dashboard/schedule", label: "Auto-Renewal", icon: CalendarClock },
  { to: "/dashboard/direct-debit", label: "MTN Direct Debit", icon: CreditCard },
  { to: "/dashboard/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/dashboard/notifications", label: "Inbox Notifications", icon: Bell },
  { to: "/dashboard/buy-data/mtn", label: "Buy Data", icon: ShoppingCart },
  { to: "/dashboard/buy-airtime", label: "Buy Airtime", icon: CreditCard },
  { to: "/dashboard/utilities", label: "Utility Bills", icon: Zap },
  { to: "/dashboard/afa", label: "AFA Registration", icon: ShieldCheck },
  // { to: "/dashboard/airtime-to-cash", label: "Airtime to Cash", icon: CreditCard },
  { to: "/dashboard/my-store", label: "My Store", icon: Store },
  { to: "/dashboard/report-issue", label: "Report Issue", icon: Flag },
  { to: "/dashboard/customers", label: "Address Book", icon: Users2 },
  { to: "/dashboard/referral", label: "Referral Program", icon: Gift },
];

const agentNavItems = [
  { to: "/dashboard/agent-prices", label: "Agent Prices", icon: CreditCard },
  { to: "/dashboard/withdrawals", label: "Withdrawals", icon: HandCoins },
  { to: "/dashboard/store-settings", label: "Store Settings", icon: Settings },
  { to: "/dashboard/subagents", label: "Subagents", icon: Users2 },
  { to: "/dashboard/subagent-pricing", label: "Subagent Pricing", icon: SlidersHorizontal },
  { to: "/dashboard/flyer", label: "Flyer Generator", icon: FileText },
  { to: "/dashboard/marketing", label: "Marketing Tools", icon: Zap },
  { to: "/dashboard/result-checker", label: "Result Checker", icon: GraduationCap },
  { to: "/dashboard/api", label: "My API Access", icon: Key },
  { to: "/dashboard/agent-dev-hub", label: "Agent Developer Hub", icon: Users2 },
  { to: "/dashboard/bulk", label: "Bulk Disbursement", icon: Send },
  { to: "/dashboard/whatsapp-bot", label: "WhatsApp Bot", icon: Bot },
  { to: "/dashboard/swift-vendor", label: "Swift Vendor", icon: Zap },
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
  const { theme, isDark } = useAppTheme();
  const { isOnline, quality } = useConnectivity();
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved || profile?.api_access_enabled);
  const [time, setTime] = useState(new Date());
  const [parentStore, setParentStore] = useState<{
    store_name: string | null;
    store_logo_url: string | null;
    store_primary_color: string | null;
  } | null>(null);
  const [businessSuiteOpen, setBusinessSuiteOpen] = useState(() => 
    agentNavItems.some(item => location.pathname === item.to)
  );

  // Auto-expand if the route changes to an agent page
  useEffect(() => {
    const isActive = agentNavItems.some(item => location.pathname === item.to);
    if (isActive) {
      setBusinessSuiteOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    const fetchParentStore = async () => {
      if (profile?.is_sub_agent && profile.parent_agent_id) {
        const { data } = await supabase
          .from("agent_stores")
          .select("store_name, store_logo_url, store_primary_color")
          .eq("user_id", profile.parent_agent_id)
          .maybeSingle();
        if (data) {
          setParentStore(data);
        }
      }
    };
    fetchParentStore();
  }, [profile]);

  useEffect(() => {
    const tick = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);


  const topupRef = (profile as any)?.topup_reference;
  const accountId = topupRef ? `DH-${topupRef}` : "DH-USER";

  const hasStore = !!(profile?.store_name && profile.store_name.trim() !== "");

  const visibleAgentItemsCount = agentNavItems
    .filter(
      (item) => !((profile as any)?.is_sub_agent && !(profile as any)?.is_agent && ["/dashboard/subagents", "/dashboard/subagent-pricing"].includes(item.to)),
    )
    .filter(
      (item) => hasStore || !["/dashboard/store-settings", "/dashboard/subagents", "/dashboard/subagent-pricing", "/dashboard/whatsapp-bot"].includes(item.to)
    ).length;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <>
      {/* Mobile Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm md:hidden transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed md:sticky top-0 left-0 z-[1000] w-72 h-[100dvh] flex flex-col transition-all duration-300 ease-in-out md:translate-x-0 border-r shadow-2xl",
          isDark ? "bg-[#0d140d]/95 backdrop-blur-xl border-white/5" : "bg-white border-gray-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* ── Premium Logo Section ── */}
        <div className="p-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute -inset-1 bg-primary/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
              {parentStore?.store_logo_url ? (
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-white flex items-center justify-center border border-white/10 shrink-0 relative">
                  <img src={parentStore.store_logo_url} alt="Logo" className="w-full h-full object-contain" />
                </div>
              ) : (
                <img src="/logo.png" alt="Logo" className="w-10 h-10 shrink-0 relative" />
              )}
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center border-2 border-[#0d140d] shadow-lg">
                <ShieldCheck className="w-2.5 h-2.5 text-white" />
              </div>
            </div>
            <div>
              <p className={cn("font-black text-sm tracking-tight leading-tight group-hover:text-primary transition-colors truncate max-w-[140px]", isDark ? "text-white" : "text-gray-900")}>
                {parentStore?.store_name || "SwiftData GH"}
              </p>
              <p className={cn("text-[10px] font-bold uppercase tracking-widest truncate max-w-[140px]", isDark ? "text-white/40" : "text-gray-400")}>
                {parentStore ? "Reseller Partner" : "Agent Console"}
              </p>
            </div>
          </Link>
          <button 
            onClick={onClose} 
            aria-label="Close sidebar menu"
            title="Close Menu"
            className={cn(
              "md:hidden p-2 rounded-full transition-colors",
              isDark ? "hover:bg-white/5 text-white/50 hover:text-white" : "hover:bg-gray-100 text-gray-400 hover:text-gray-900"
            )}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Enhanced User Profile Section ── */}
        <div className="px-5 py-6">
          <div className={cn(
            "p-4 rounded-2xl border relative overflow-hidden group transition-all",
            isDark ? "bg-white/5 border-white/10" : "bg-gray-50 border-gray-200"
          )}>
            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
              <Zap className="w-12 h-12" />
            </div>
            <div className="flex items-center gap-3 relative z-10">
              <div className="relative">
                <Avatar className="w-11 h-11 border-2 border-primary/20 p-0.5">
                  <AvatarImage src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${authUser?.id}`} />
                  <AvatarFallback className="bg-primary/10 text-xs">{profile?.full_name?.charAt(0) || "U"}</AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0d140d]"></div>
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-black truncate", isDark ? "text-white" : "text-gray-900")}>{profile?.full_name || "User"}</p>
                <p className="text-primary text-[10px] font-mono font-bold">{accountId}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between relative z-10">
              <Badge className={cn(
                "h-5 text-[9px] font-black uppercase tracking-widest border-none",
                profile?.api_access_enabled
                  ? "bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                  : isPaidAgent 
                    ? "bg-amber-400 text-black shadow-[0_0_10px_rgba(251,191,36,0.3)]" 
                    : "bg-white/10 text-white/50"
              )}>
                {profile?.api_access_enabled ? "API Partner" : isPaidAgent ? "Pro Agent" : "Regular"}
              </Badge>
              
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex items-center gap-1 text-[10px] font-bold opacity-60",
                  isDark ? "text-white/60" : "text-gray-500"
                )}>
                  <Clock className="w-3 h-3" />
                  {format(time, "hh:mm:ss a")}
                </div>
                
                <div className={cn(
                  "w-1 h-1 rounded-full bg-white/10 hidden sm:block"
                )} />

                <div className={cn(
                  "flex items-center gap-1 text-[10px] font-bold transition-colors",
                  !isOnline ? "text-red-500" : quality === "poor" ? "text-amber-500" : "text-green-500"
                )}>
                  {!isOnline ? <WifiOff className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
                  {!isOnline ? "Offline" : "Online"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Sophisticated Navigation ── */}
        <nav className="flex-1 px-4 py-2 space-y-8 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {/* User Menu */}
          <div>
            <p className={cn("px-4 text-[10px] font-black uppercase tracking-[0.2em] mb-4 flex items-center gap-2", isDark ? "text-white/20" : "text-gray-400")}>
              <span className={cn("w-1 h-1 rounded-full", isDark ? "bg-white/20" : "bg-gray-300")}></span>
              Core Services
            </p>
            <div className="space-y-1">
              {userNavItems
                .filter(item => item.to !== "/dashboard/my-store" || hasStore)
                .map((item) => {
                  const isActive = location.pathname === item.to || (item.to === "/dashboard/buy-data/mtn" && location.pathname.startsWith("/dashboard/buy-data/"));
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200",
                      isActive 
                        ? (isDark ? "text-white bg-gradient-to-r from-primary/20 to-transparent border-l-2 border-primary shadow-lg shadow-primary/5" : "text-gray-900 bg-amber-50 border-l-2 border-primary")
                        : (isDark ? "text-white/50 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100")
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className={cn(
                        "w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                        isActive 
                          ? "text-primary" 
                          : (isDark ? "text-white/30 group-hover:text-white/60" : "text-gray-400 group-hover:text-gray-900")
                      )} />
                      {item.label}
                    </div>
                    {["/dashboard/buy-airtime", "/dashboard/afa"].includes(item.to) && (
                      <Badge className="text-[8px] h-4 bg-emerald-500 text-white border-none uppercase font-black px-1.5 shadow-[0_0_10px_rgba(16,185,129,0.4)] animate-pulse">
                        NEW
                      </Badge>
                    )}
                    {isActive && <ChevronRight className="w-3 h-3 text-primary" />}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Agent Menu */}
          {isPaidAgent && (
            <div className="space-y-2">
              <button
                onClick={() => setBusinessSuiteOpen(!businessSuiteOpen)}
                className={cn(
                  "w-full px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-between transition-all",
                  isDark 
                    ? "text-white/50 hover:text-white hover:bg-white/5" 
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full animate-pulse", 
                    isDark ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                  )}></span>
                  Business Suite
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!businessSuiteOpen && (
                    <Badge className={cn(
                      "text-[8px] h-4.5 border-none uppercase font-black px-1.5 animate-pulse",
                      isDark ? "bg-amber-400/20 text-amber-400 animate-pulse" : "bg-amber-500/10 text-amber-600 animate-pulse"
                    )}>
                      {visibleAgentItemsCount} Tools
                    </Badge>
                  )}
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", businessSuiteOpen ? "transform rotate-180" : "")} />
                </div>
              </button>

              <AnimatePresence initial={false}>
                {businessSuiteOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                    className="overflow-hidden"
                  >
                    <div className={cn(
                      "p-2 space-y-1 rounded-2xl border backdrop-blur-xl shadow-lg relative overflow-hidden",
                      isDark
                        ? "bg-gradient-to-b from-white/[0.07] to-white/[0.02] border-white/[0.08] shadow-black/40"
                        : "bg-gradient-to-b from-black/[0.03] to-black/[0.01] border-black/[0.05] shadow-white/40"
                    )}>
                      {/* Ambient background glow inside liquid glass */}
                      <div className="absolute -top-12 -right-12 w-24 h-24 bg-amber-400/5 rounded-full blur-2xl pointer-events-none" />
                      
                      {agentNavItems
                        .filter(
                          (item) => !((profile as any)?.is_sub_agent && !(profile as any)?.is_agent && ["/dashboard/subagents", "/dashboard/subagent-pricing"].includes(item.to)),
                        )
                        .filter(
                          (item) => hasStore || !["/dashboard/store-settings", "/dashboard/subagents", "/dashboard/subagent-pricing", "/dashboard/whatsapp-bot"].includes(item.to)
                        )
                        .map((item) => {
                          const isActive = location.pathname === item.to;
                          return (
                            <Link
                              key={item.to}
                              to={item.to}
                              onClick={onClose}
                              className={cn(
                                "group flex items-center justify-between px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 relative overflow-hidden",
                                isActive 
                                  ? (isDark 
                                      ? "text-white bg-amber-400/10 border-l-2 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.1)]" 
                                      : "text-black bg-amber-500/10 border-l-2 border-amber-500")
                                  : (isDark 
                                      ? "text-white/60 hover:text-white hover:bg-white/5" 
                                      : "text-gray-600 hover:text-gray-900 hover:bg-black/5")
                              )}
                            >
                              <div className="flex items-center gap-3 relative z-10">
                                <item.icon className={cn(
                                  "w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110",
                                  isActive 
                                    ? "text-amber-400" 
                                    : (isDark ? "text-white/30 group-hover:text-white/60" : "text-gray-400 group-hover:text-gray-900")
                                )} />
                                {item.to === "/dashboard/agent-prices" && profile?.api_access_enabled ? "API Prices" : item.label}
                              </div>
                              {["/dashboard/swift-vendor", "/dashboard/subagents", "/dashboard/subagent-pricing", "/dashboard/afa"].includes(item.to) && (
                                <Badge className="text-[8px] h-4 bg-emerald-500 text-white border-none uppercase font-black px-1.5 shadow-[0_0_10px_rgba(16,185,129,0.4)] animate-pulse relative z-10">
                                  NEW
                                </Badge>
                              )}
                              {isActive && <Star className="w-3 h-3 text-amber-400 fill-amber-400 relative z-10" />}
                            </Link>
                          );
                        })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </nav>

        {/* ── Premium Footer ── */}
        <div className={cn("p-4 border-t", isDark ? "border-white/5" : "border-gray-100")}>
          <button
            onClick={handleSignOut}
            className={cn(
              "flex items-center justify-center gap-3 w-full h-12 rounded-xl text-sm font-black transition-all duration-200",
              isDark 
                ? "text-red-400/80 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20" 
                : "text-red-600 hover:text-white hover:bg-red-500 border border-red-500/10"
            )}
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

