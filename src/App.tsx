import { Toaster } from "@/components/ui/toaster";
// App Entry Configuration
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { invokePublicFunction } from "@/lib/public-function-client";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DashboardLayout from "@/components/DashboardLayout";
import AdminLayout from "@/components/AdminLayout";
import { ThemeProvider } from "@/contexts/ThemeContext";
import WhatsAppButton from "@/components/WhatsAppButton";
import FreeDataButton from "@/components/FreeDataButton";
import TutorialModal from "@/components/TutorialModal";
import InstallPrompt from "@/components/InstallPrompt";
import AudioUnlocker from "@/components/AudioUnlocker";
import NotificationPopup from "@/components/NotificationPopup";
import { OfflineAlert } from "@/components/OfflineAlert";
import { useRegisterSW } from "virtual:pwa-register/react";
import LoadingScreen from "@/components/LoadingScreen";
import { TraditionalBackground } from "@/components/TraditionalBackground";
import IpBlocked from "./pages/IpBlocked";
import Maintenance from "./pages/Maintenance";
import { SecurityGuard } from "@/components/SecurityGuard";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { ChunkErrorBoundary } from "@/components/ChunkErrorBoundary";
import AIConcierge from "@/components/AIConcierge";
import { getActiveStoreDomain } from "@/lib/app-base-url";

// Route-level code splitting — each page chunk loads only when first visited
const Index = lazy(() => import("./pages/Index"));
const AgentProgram = lazy(() => import("./pages/AgentProgram"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DashboardPricing = lazy(() => import("./pages/DashboardPricing"));
const DashboardOrders = lazy(() => import("./pages/DashboardOrders"));
const DashboardWithdraw = lazy(() => import("./pages/DashboardWithdraw"));
const DashboardWallet = lazy(() => import("./pages/DashboardWallet"));
const DashboardFlyer = lazy(() => import("./pages/DashboardFlyer"));
const DashboardSettings = lazy(() => import("./pages/DashboardSettings"));
const DashboardSubAgents = lazy(() => import("./pages/DashboardSubAgents"));
const DashboardResultCheckers = lazy(() => import("./pages/DashboardResultCheckers"));
const DashboardBuyDataNetwork = lazy(() => import("./pages/DashboardBuyDataNetwork"));
const DashboardBuyAirtime = lazy(() => import("./pages/DashboardBuyAirtime"));
const DashboardMyStore = lazy(() => import("./pages/DashboardMyStore"));
const DashboardDirectDebit = lazy(() => import("./pages/DashboardDirectDebit"));
const DashboardReportIssue = lazy(() => import("./pages/DashboardReportIssue"));
const DashboardAccountSettings = lazy(() => import("./pages/DashboardAccountSettings"));
const DashboardProfile = lazy(() => import("./pages/DashboardProfile"));
const DashboardSubAgentPricing = lazy(() => import("./pages/DashboardSubAgentPricing"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const BuyData = lazy(() => import("./pages/BuyData"));
const BuyAirtime = lazy(() => import("./pages/BuyAirtime"));
const BuyUtility = lazy(() => import("./pages/BuyUtility"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const VerifyOtp = lazy(() => import("./pages/VerifyOtp"));
const VerifyMfa = lazy(() => import("./pages/VerifyMfa"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AgentPending = lazy(() => import("./pages/AgentPending"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const AgentStore = lazy(() => import("./pages/AgentStore"));
const OrderStatus = lazy(() => import("./pages/OrderStatus"));
const PurchaseSuccess = lazy(() => import("./pages/PurchaseSuccess"));
const DashboardLeaderboard = lazy(() => import("./pages/DashboardLeaderboard"));
const AdminOverview = lazy(() => import("./pages/AdminOverview"));
const AdminAgents = lazy(() => import("./pages/AdminAgents"));
const AdminOrders = lazy(() => import("./pages/AdminOrders"));
const AdminAirtimeOrders = lazy(() => import("./pages/AdminAirtimeOrders"));
const AdminMashUpOrders = lazy(() => import("./pages/AdminMashUpOrders"));
const AdminUtilityOrders = lazy(() => import("./pages/AdminUtilityOrders"));
const AdminStandardOrders = lazy(() => import("./pages/AdminStandardOrders"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const AdminWithdrawals = lazy(() => import("./pages/AdminWithdrawals"));
const AdminNotificationsPage = lazy(() => import("./pages/AdminNotificationsPage"));
const AdminPackages = lazy(() => import("./pages/AdminPackages"));
const AdminKorbaHub = lazy(() => import("./pages/AdminKorbaHub"));
const AdminKorbaPackages = lazy(() => import("./pages/AdminKorbaPackages"));
const AdminWalletTopup = lazy(() => import("./pages/AdminWalletTopup"));
const AdminSystemHealth = lazy(() => import("./pages/AdminSystemHealth"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const AdminPromotions = lazy(() => import("./pages/AdminPromotions"));
const AdminTickets = lazy(() => import("./pages/AdminTickets"));
const AdminAuditLogs = lazy(() => import("./pages/AdminAuditLogs"));
const AdminSecurity = lazy(() => import("./pages/AdminSecurity"));
const AdminAPIUsers = lazy(() => import("./pages/AdminAPIUsers"));
const AdminProfits = lazy(() => import("./pages/AdminProfits"));
const AdminAgentPerformance = lazy(() => import("./pages/AdminAgentPerformance"));
const AdminPnL = lazy(() => import("./pages/AdminPnL"));
const AdminBanners = lazy(() => import("./pages/AdminBanners"));
const AdminEngagement = lazy(() => import("./pages/AdminEngagement"));
const AdminReconciliation = lazy(() => import("./pages/AdminReconciliation"));
const AdminSubAgents = lazy(() => import("./pages/AdminSubAgents"));
const AdminSystemLogs = lazy(() => import("./pages/AdminSystemLogs"));
const AdminAPIOrders = lazy(() => import("./pages/AdminAPIOrders"));
const AdminBroadcast = lazy(() => import("./pages/AdminBroadcast"));
const AdminFeatureFlags = lazy(() => import("./pages/AdminFeatureFlags"));
const AdminSmsTemplates = lazy(() => import("./pages/AdminSmsTemplates"));
const AdminCreditManagement = lazy(() => import("./pages/AdminCreditManagement"));
const AdminSentinelAI = lazy(() => import("./pages/AdminSentinelAI"));
const AdminSwiftVendorPro = lazy(() => import("./pages/AdminSwiftVendorPro"));
const AdminAIStrategy = lazy(() => import("./pages/AdminAIStrategy"));
const AdminAPINetwork = lazy(() => import("./pages/AdminAPINetwork"));
const SubAgentSignup = lazy(() => import("./pages/SubAgentSignup"));
const SubAgentPending = lazy(() => import("./pages/SubAgentPending"));
const DashboardDeveloperAPI = lazy(() => import("./pages/DashboardDeveloperAPI"));
const APIDocumentation = lazy(() => import("./pages/APIDocumentation"));
const DeveloperPortal = lazy(() => import("./pages/DeveloperPortal"));
const NotFound = lazy(() => import("./pages/NotFound"));
const DashboardCustomers = lazy(() => import("./pages/DashboardCustomers"));
const DashboardMarketing = lazy(() => import("./pages/DashboardMarketing"));
const DashboardUtilities = lazy(() => import("./pages/DashboardUtilities"));
const DashboardAfa = lazy(() => import("./pages/DashboardAfa"));
const DashboardAirtimeCash = lazy(() => import("./pages/DashboardAirtimeCash"));
const DashboardReferral = lazy(() => import("./pages/DashboardReferral"));
const DashboardBulk = lazy(() => import("./pages/DashboardBulk"));
const DashboardSchedule = lazy(() => import("./pages/DashboardSchedule"));
const DashboardWhatsAppBot = lazy(() => import("./pages/DashboardWhatsAppBot"));
const MyOrders = lazy(() => import("./pages/MyOrders"));
const DashboardSwiftVendor = lazy(() => import("./pages/DashboardSwiftVendor"));
const DashboardAgentDevHub = lazy(() => import("./pages/DashboardAgentDevHub"));
const AgentDevAPIDocs = lazy(() => import("./pages/AgentDevAPIDocs"));
const DashboardNotifications = lazy(() => import("./pages/DashboardNotifications"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));

const queryClient = new QueryClient();


/** Authenticated dashboard guard that keeps admins on the admin dashboard and unapproved agents/sub-agents on pending */
const DashboardGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, isAdmin, loading, isMfaChallenged } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (isMfaChallenged) return <Navigate to="/verify-mfa" replace />;
  
  // Bypass admin enforcement ONLY when visiting account settings (essential for setting up mandatory MFA)
  if (isAdmin && !location.pathname.includes("/dashboard/account-settings")) {
    return <Navigate to="/admin" replace />;
  }
  
  // Strict check for sub-agents
  if (profile?.is_sub_agent && !profile?.sub_agent_approved) {
    return <Navigate to="/sub-agent/pending" replace />;
  }

  // Strict check for main agents
  if (profile?.is_agent && !profile?.agent_approved) {
    return <Navigate to="/agent/pending" replace />;
  }

  // Ensure approved agents have completed store onboarding
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  if (isPaidAgent && !profile?.onboarding_complete) {
    return <Navigate to="/onboarding" replace />;
  }
  
  return <>{children}</>;
};

/** Agent-only feature guard */
const AgentFeatureGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  if (!isPaidAgent) return <Navigate to="/dashboard/my-store" replace />;
  return <>{children}</>;
};

/** Parent agent-only guard (sub-agents cannot recruit or manage sub-agent network) */
const ParentAgentOnlyGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved);
  if (!isPaidAgent) return <Navigate to="/dashboard/my-store" replace />;
  if (profile?.is_sub_agent) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

/** Sub-agent pending guard */
const SubAgentPendingGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.is_sub_agent) return <Navigate to="/" replace />;
  if (profile?.sub_agent_approved) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

/** Admin guard */
const AdminGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, loading, isMfaChallenged, isMfaEnabled } = useAuth();
  const [ipAllowed, setIpAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (isAdmin && user) {
      const checkIp = async () => {
        try {
          const { data: roleData } = await supabase
            .from("user_roles")
            .select("allowed_ips")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .maybeSingle();

          const allowed = roleData?.allowed_ips as string[] | null;
          if (!allowed || allowed.length === 0) {
            setIpAllowed(true);
            return;
          }

          const res = await fetch("https://api.ipify.org?format=json");
          const { ip } = await res.json();
          setIpAllowed(allowed.includes(ip));
        } catch (e) {
          console.error("IP check failed:", e);
          setIpAllowed(true); // Fallback to allow if API fails, but logged
        }
      };
      checkIp();
    }
  }, [isAdmin, user]);

  if (loading || (isAdmin && ipAllowed === null)) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (isMfaChallenged) return <Navigate to="/verify-mfa" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  if (ipAllowed === false) return <Navigate to="/ip-blocked" replace />;

  // Force all Administrators to configure and use MFA before entering Admin controls
  if (!isMfaEnabled) {
    return <Navigate to="/dashboard/account-settings?force_admin_mfa=true" replace />;
  }
  
  return <>{children}</>;
};

/** Agent pending guard */
const PendingGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.is_agent) return <Navigate to="/agent-program" replace />;
  if (profile?.agent_approved) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const AppContent = () => {
  const { user, isAdmin: isAdminUser, loading: authLoading } = useAuth();
  const location = useLocation();
  const [maintenance, setMaintenance] = useState<{ is_enabled: boolean; message: string }>({
    is_enabled: false,
    message: "",
  });
  const [ipBlocked, setIpBlocked] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);
  // Minimum splash time — guarantees the loading animation is visible for at least 2 s
  const [splashReady, setSplashReady] = useState(false);
  useEffect(() => {
    // Short splash — just enough for auth to resolve, not a blank-screen risk
    const t = setTimeout(() => setSplashReady(true), 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadMaintenance = async () => {
      // Prevent polling errors when offline — but still unblock the loading state
      if (!window.navigator.onLine) {
        if (mounted) setMaintenanceLoading(false);
        return;
      }

      try {
        const maintenanceResult = await Promise.race([
          invokePublicFunction("maintenance-mode", {
            body: { action: "get" },
          }),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("maintenance-timeout")), 12000); // Increased timeout to allow retries
          }),
        ]);
        const { data, error } = maintenanceResult as { data: any; error: any };

        if (!mounted) return;

        if (error) throw error;
        
        if (data && !(data as any).error) {
          setMaintenance({
            is_enabled: Boolean((data as any).is_enabled),
            message: String((data as any).message || ""),
          });
          setIpBlocked(Boolean((data as any).is_blocked));
        } else {
          setMaintenance({ is_enabled: false, message: "" });
          setIpBlocked(false);
        }
      } catch (e) {
        if (!mounted) return;
        console.warn("[Maintenance] Fallback: Connection closed or timeout.", e);
        setMaintenance({ is_enabled: false, message: "" });
        setIpBlocked(false);
      } finally {
        if (mounted) setMaintenanceLoading(false);
      }
    };

    loadMaintenance();
    const firstLoadSafetyTimeout = window.setTimeout(() => {
      if (mounted) setMaintenanceLoading(false);
    }, 4000);

    const interval = window.setInterval(loadMaintenance, 30000);

    return () => {
      mounted = false;
      window.clearTimeout(firstLoadSafetyTimeout);
      window.clearInterval(interval);
    };
  }, []);

  const activeDomain = getActiveStoreDomain();
  const isAdminSubdomain = window.location.hostname.startsWith("senyo.");
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const isDashboard = location.pathname.startsWith("/dashboard");
  const isAdmin = location.pathname.startsWith("/admin");
  const isAgentStore = location.pathname.startsWith("/store/") || (!!activeDomain && !isDashboard && !isAdmin);
  const isMaintenanceBypassRoute =
    location.pathname.startsWith("/admin") ||
    location.pathname === "/login" ||
    location.pathname === "/agent/login" ||
    location.pathname === "/reset-password" ||
    location.pathname === "/auth/callback" ||
    location.pathname === "/auth";
  if (authLoading || maintenanceLoading || !splashReady) {
    return <LoadingScreen />;
  }

  if (ipBlocked && !isAdminUser) {
    return <IpBlocked />;
  }

  if (maintenance.is_enabled && !user && !isAdminUser && !isMaintenanceBypassRoute) {
    return <Maintenance message={maintenance.message} />;
  }

  return (
    <>
      {location.pathname !== "/" && <TraditionalBackground />}
      <div className="relative z-10 min-h-screen flex flex-col">
        {!isDashboard && !isAgentStore && !isAdmin && <Navbar />}
        <ChunkErrorBoundary>
        <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Public pages */}
        <Route path="/" element={isAdminSubdomain ? <Navigate to="/admin" replace /> : (activeDomain ? <AgentStore /> : <Index />)} />
        <Route path="/agent-program" element={<AgentProgram />} />
        <Route path="/store/:slug" element={<AgentStore />} />
        <Route path="/store/:slug/order-status" element={<OrderStatus />} />
        <Route path="/store/:slug/my-orders" element={<MyOrders />} />
        <Route path="/order-status" element={<OrderStatus />} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/delivery-tracker" element={<Navigate to="/order-status" replace />} />
        <Route 
          path="/products" 
          element={
            <Navigate 
              to={{ 
                pathname: "/buy-data", 
                search: window.location.search 
              }} 
              replace 
            />
          } 
        />
        <Route path="/purchase-success" element={<PurchaseSuccess />} />
        <Route path="/api-docs" element={<APIDocumentation />} />
        <Route path="/docs/agent-api" element={<AgentDevAPIDocs />} />
        <Route path="/developers" element={<DeveloperPortal />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />

        {/* Auth pages */}
        <Route path="/login" element={<AuthPage />} />
        <Route path="/agent/login" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-otp" element={<VerifyOtp />} />
        <Route path="/verify-mfa" element={<VerifyMfa />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />

        {/* Public buy page — no login required */}
        <Route path="/buy-data" element={<BuyData />} />
        <Route path="/buy-airtime" element={<BuyAirtime />} />
        <Route path="/buy-utility" element={<BuyUtility />} />

        {/* Sub agent routes */}
        <Route path="/store/:slug/sub-agent" element={<SubAgentSignup />} />
        <Route path="/sub-agent/pending" element={<SubAgentPendingGuard><SubAgentPending /></SubAgentPendingGuard>} />

        {/* Agent flow */}
        <Route path="/agent/pending" element={<PendingGuard><AgentPending /></PendingGuard>} />
        <Route path="/onboarding" element={<Onboarding />} />

        {/* User dashboard */}
        <Route path="/dashboard" element={<DashboardGuard><DashboardLayout /></DashboardGuard>}>
          <Route index element={<Dashboard />} />
          <Route path="wallet" element={<DashboardWallet />} />
          <Route path="transactions" element={<DashboardOrders />} />
          <Route path="notifications" element={<DashboardNotifications />} />
          <Route path="buy-data" element={<Navigate to="/dashboard/buy-data/mtn" replace />} />
          <Route path="buy-data/mtn" element={<DashboardBuyDataNetwork network="MTN" />} />
          <Route path="buy-data/mtn-mash-up" element={<DashboardBuyDataNetwork network="MTN Mash Up" />} />
          <Route path="buy-data/telecel" element={<DashboardBuyDataNetwork network="Telecel" />} />
          <Route path="buy-data/airteltigo" element={<DashboardBuyDataNetwork network="AirtelTigo" />} />
          <Route path="buy-airtime" element={<DashboardBuyAirtime />} />
          <Route path="utilities" element={<DashboardUtilities />} />
          <Route path="afa" element={<DashboardAfa />} />
          <Route path="airtime-to-cash" element={<DashboardAirtimeCash />} />
          <Route path="my-store" element={<DashboardMyStore />} />
          <Route path="direct-debit" element={<DashboardDirectDebit />} />
          <Route path="report-issue" element={<DashboardReportIssue />} />
          <Route path="account-settings" element={<DashboardAccountSettings />} />
          <Route path="profile" element={<DashboardProfile />} />
          <Route path="customers" element={<DashboardCustomers />} />
          <Route path="referral" element={<DashboardReferral />} />
          <Route path="bulk" element={<AgentFeatureGuard><DashboardBulk /></AgentFeatureGuard>} />
          <Route path="schedule" element={<DashboardSchedule />} />

          {/* Paid agent-only pages */}
          <Route path="agent-prices" element={<AgentFeatureGuard><DashboardPricing /></AgentFeatureGuard>} />
          <Route path="withdrawals" element={<AgentFeatureGuard><DashboardWithdraw /></AgentFeatureGuard>} />
          <Route path="store-settings" element={<AgentFeatureGuard><DashboardSettings /></AgentFeatureGuard>} />
          <Route path="subagents" element={<ParentAgentOnlyGuard><DashboardSubAgents /></ParentAgentOnlyGuard>} />
          <Route path="subagent-pricing" element={<ParentAgentOnlyGuard><DashboardSubAgentPricing /></ParentAgentOnlyGuard>} />
          <Route path="flyer" element={<AgentFeatureGuard><DashboardFlyer /></AgentFeatureGuard>} />
          <Route path="/dashboard/api" element={<AgentFeatureGuard><DashboardDeveloperAPI /></AgentFeatureGuard>} />
          <Route path="result-checker" element={<AgentFeatureGuard><DashboardResultCheckers /></AgentFeatureGuard>} />
          <Route path="agent-dev-hub" element={<AgentFeatureGuard><DashboardAgentDevHub /></AgentFeatureGuard>} />
          <Route path="leaderboard" element={<AgentFeatureGuard><DashboardLeaderboard /></AgentFeatureGuard>} />
          <Route path="marketing" element={<AgentFeatureGuard><DashboardMarketing /></AgentFeatureGuard>} />
          <Route path="whatsapp-bot" element={<AgentFeatureGuard><DashboardWhatsAppBot /></AgentFeatureGuard>} />
          <Route path="swift-vendor" element={<AgentFeatureGuard><DashboardSwiftVendor /></AgentFeatureGuard>} />

          {/* Legacy aliases */}
          <Route path="orders" element={<Navigate to="/dashboard/transactions" replace />} />
          <Route path="withdraw" element={<Navigate to="/dashboard/withdrawals" replace />} />
          <Route path="pricing" element={<Navigate to="/dashboard/agent-prices" replace />} />
          <Route path="cheaper-prices" element={<Navigate to="/dashboard/agent-prices" replace />} />
          <Route path="sub-agents" element={<Navigate to="/dashboard/subagents" replace />} />
          <Route path="result-checkers" element={<Navigate to="/dashboard/result-checker" replace />} />
          <Route path="settings" element={<Navigate to="/dashboard/store-settings" replace />} />
        </Route>

        {/* Admin dashboard */}
        <Route path="/admin" element={(isAdminSubdomain || isLocal) ? <AdminGuard><AdminLayout /></AdminGuard> : <Navigate to="/" replace />}>
          <Route index element={<AdminOverview />} />
          <Route path="agents" element={<AdminAgents />} />
          <Route path="sub-agents" element={<AdminSubAgents />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="airtime-orders" element={<AdminAirtimeOrders />} />
          <Route path="mashup-orders" element={<AdminMashUpOrders />} />
          <Route path="utility-orders" element={<AdminUtilityOrders />} />
          <Route path="standard-orders" element={<AdminStandardOrders />} />
          <Route path="api-orders" element={<AdminAPIOrders />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="reconciliation" element={<AdminReconciliation />} />
          <Route path="withdrawals" element={<AdminWithdrawals />} />
          <Route path="notifications" element={<AdminNotificationsPage />} />
          <Route path="packages" element={<AdminPackages />} />
          <Route path="korba" element={<AdminKorbaHub />} />
          <Route path="korba/packages" element={<AdminKorbaPackages />} />
          <Route path="wallet-topup" element={<AdminWalletTopup />} />
          <Route path="system-health" element={<AdminSystemHealth />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="promotions" element={<AdminPromotions />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="audit-logs" element={<AdminAuditLogs />} />
          <Route path="security" element={<AdminSecurity />} />
          <Route path="api-users" element={<AdminAPIUsers />} />
          <Route path="profits" element={<AdminProfits />} />
          <Route path="agent-performance" element={<AdminAgentPerformance />} />
          <Route path="pnl" element={<AdminPnL />} />
          <Route path="banners" element={<AdminBanners />} />
          <Route path="engagement" element={<AdminEngagement />} />
          <Route path="system-logs" element={<AdminSystemLogs />} />
          <Route path="broadcast" element={<AdminBroadcast />} />
          <Route path="feature-flags" element={<AdminFeatureFlags />} />
          <Route path="sms-templates" element={<AdminSmsTemplates />} />
          <Route path="credit-management" element={<AdminCreditManagement />} />
          <Route path="sentinel" element={<AdminSentinelAI />} />
          <Route path="swift-vendor" element={<AdminSwiftVendorPro />} />
          <Route path="ai-strategy" element={<AdminAIStrategy />} />
          <Route path="api-network" element={<AdminAPINetwork />} />
          <Route path="account-settings" element={<DashboardAccountSettings />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
        </ChunkErrorBoundary>
      {!isDashboard && !isAgentStore && !isAdmin && <Footer />}
        {!isDashboard && !isAdmin && <TutorialModal />}
        <AudioUnlocker />
        <NotificationPopup />
        <AIConcierge />
      </div>
    </>
  );
};

const App = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log("SW Registered");
      if (r) {
        // 1. Immediately check for updates on registration
        r.update().catch(console.error);

        // 2. Auto check for updates every 5 minutes even if user leaves app open
        setInterval(() => {
          r.update().catch(console.error);
        }, 5 * 60 * 1000);

        // 3. Listen to window focus and visibility change to catch updates immediately (perfect for iPhone PWAs)
        const checkUpdates = () => {
          console.log("App focused or visible, checking for service worker updates...");
          r.update().catch(console.error);
        };
        window.addEventListener("focus", checkUpdates);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkUpdates();
        });
      }
    },
    onRegisterError(error) {
      console.error("SW registration error", error);
    },
  });

  // Listen for controller changes (new service worker taking over) and reload
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      const handleControllerChange = () => {
        if (refreshing) return;
        refreshing = true;
        console.log("Service Worker controller changed. Reloading page to load latest version...");
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
      return () => {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      };
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <OfflineAlert />
          <UpdatePrompt needRefresh={needRefresh} onUpdate={() => updateServiceWorker(true)} />
          <Toaster />
          <Sonner />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
              <SecurityGuard>
                <AppContent />
              </SecurityGuard>
              <WhatsAppButton />
              <FreeDataButton />
              <InstallPrompt />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
