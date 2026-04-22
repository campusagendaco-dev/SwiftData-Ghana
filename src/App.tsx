import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DashboardLayout from "@/components/DashboardLayout";
import AdminLayout from "@/components/AdminLayout";
import Index from "./pages/Index";
import AgentProgram from "./pages/AgentProgram";
import Dashboard from "./pages/Dashboard";
import DashboardPricing from "./pages/DashboardPricing";
import DashboardOrders from "./pages/DashboardOrders";
import DashboardWithdraw from "./pages/DashboardWithdraw";
import DashboardWallet from "./pages/DashboardWallet";
import DashboardFlyer from "./pages/DashboardFlyer";
import DashboardSettings from "./pages/DashboardSettings";
import DashboardSubAgents from "./pages/DashboardSubAgents";
import DashboardResultCheckers from "./pages/DashboardResultCheckers";
import DashboardBuyDataNetwork from "./pages/DashboardBuyDataNetwork";
import DashboardMyStore from "./pages/DashboardMyStore";
import DashboardReportIssue from "./pages/DashboardReportIssue";
import DashboardAccountSettings from "./pages/DashboardAccountSettings";
import DashboardSubAgentPricing from "./pages/DashboardSubAgentPricing";
import AuthPage from "./pages/AuthPage";
import BuyData from "./pages/BuyData";
import AuthCallback from "./pages/AuthCallback";
import { ThemeProvider } from "@/contexts/ThemeContext";
import ThemeSelector from "@/components/ThemeSelector";
import WhatsAppButton from "@/components/WhatsAppButton";
import TutorialModal from "@/components/TutorialModal";
import ForgotPassword from "./pages/ForgotPassword";
import VerifyOtp from "./pages/VerifyOtp";
import ResetPassword from "./pages/ResetPassword";
import AgentPending from "./pages/AgentPending";
import AgentStore from "./pages/AgentStore";
import OrderStatus from "./pages/OrderStatus";
import PurchaseSuccess from "./pages/PurchaseSuccess";
import AdminOverview from "./pages/AdminOverview";
import AdminAgents from "./pages/AdminAgents";
import AdminOrders from "./pages/AdminOrders";
import AdminUsers from "./pages/AdminUsers";
import AdminWithdrawals from "./pages/AdminWithdrawals";
import AdminNotificationsPage from "./pages/AdminNotificationsPage";
import AdminPackages from "./pages/AdminPackages";
import AdminWalletTopup from "./pages/AdminWalletTopup";
import AdminSystemHealth from "./pages/AdminSystemHealth";
import AdminSettings from "./pages/AdminSettings";
import AdminAnalytics from "./pages/AdminAnalytics";
import AdminPromotions from "./pages/AdminPromotions";
import AdminTickets from "./pages/AdminTickets";
import AdminAuditLogs from "./pages/AdminAuditLogs";
import SubAgentSignup from "./pages/SubAgentSignup";
import SubAgentPending from "./pages/SubAgentPending";
import DashboardDeveloperAPI from "./pages/DashboardDeveloperAPI";
import APIDocumentation from "./pages/APIDocumentation";
import DeveloperPortal from "./pages/DeveloperPortal";
import Maintenance from "./pages/Maintenance";
import NotFound from "./pages/NotFound";
import LoadingScreen from "@/components/LoadingScreen";
import InstallPrompt from "@/components/InstallPrompt";

const queryClient = new QueryClient();


/** Authenticated dashboard guard that keeps admins on the admin dashboard */
const DashboardGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
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
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
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
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);
  // Minimum splash time — guarantees the loading animation is visible for at least 2 s
  const [splashReady, setSplashReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSplashReady(true), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadMaintenance = async () => {
      try {
        const maintenanceResult = await Promise.race([
          supabase.functions.invoke("maintenance-mode", {
            body: { action: "get" },
          }),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("maintenance-timeout")), 6000);
          }),
        ]);
        const { data, error } = maintenanceResult as { data: any; error: any };

        if (!mounted) return;

        if (error) {
          setMaintenance({ is_enabled: false, message: "" });
        } else if (data && !(data as any).error) {
          setMaintenance({
            is_enabled: Boolean((data as any).is_enabled),
            message: String((data as any).message || ""),
          });
        } else {
          setMaintenance({ is_enabled: false, message: "" });
        }
      } catch {
        if (!mounted) return;
        setMaintenance({ is_enabled: false, message: "" });
      } finally {
        if (mounted) setMaintenanceLoading(false);
      }
    };

    loadMaintenance();
    const firstLoadSafetyTimeout = window.setTimeout(() => {
      if (mounted) setMaintenanceLoading(false);
    }, 7000);

    const interval = window.setInterval(loadMaintenance, 30000);

    return () => {
      mounted = false;
      window.clearTimeout(firstLoadSafetyTimeout);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadSystemSettings = async () => {
      const { data } = await supabase.functions.invoke("system-settings", {
        body: { action: "get" },
      });
      if (!active || !data) return;
      setDarkModeEnabled(Boolean((data as any).dark_mode_enabled));
    };

    loadSystemSettings();
    const interval = window.setInterval(loadSystemSettings, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkModeEnabled);
  }, [darkModeEnabled]);

  const isDashboard = location.pathname.startsWith("/dashboard");
  const isAdmin = location.pathname.startsWith("/admin");
  const isAgentStore = location.pathname.startsWith("/store/");
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

  if (maintenance.is_enabled && !user && !isAdminUser && !isMaintenanceBypassRoute) {
    return <Maintenance message={maintenance.message} />;
  }

  return (
    <>
      {!isDashboard && !isAgentStore && !isAdmin && <Navbar />}
      <Routes>
        {/* Public pages */}
        <Route path="/" element={<Index />} />
        <Route path="/agent-program" element={<AgentProgram />} />
        <Route path="/store/:slug" element={<AgentStore />} />
        <Route path="/order-status" element={<OrderStatus />} />
        <Route path="/purchase-success" element={<PurchaseSuccess />} />
        <Route path="/api-docs" element={<APIDocumentation />} />
        <Route path="/developers" element={<DeveloperPortal />} />

        {/* Auth pages */}
        <Route path="/login" element={<AuthPage />} />
        <Route path="/agent/login" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-otp" element={<VerifyOtp />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />

        {/* Public buy page — no login required */}
        <Route path="/buy-data" element={<BuyData />} />

        {/* Sub agent routes */}
        <Route path="/store/:slug/sub-agent" element={<SubAgentSignup />} />
        <Route path="/sub-agent/pending" element={<SubAgentPendingGuard><SubAgentPending /></SubAgentPendingGuard>} />

        {/* Agent flow */}
        <Route path="/agent/pending" element={<PendingGuard><AgentPending /></PendingGuard>} />

        {/* User dashboard */}
        <Route path="/dashboard" element={<DashboardGuard><DashboardLayout /></DashboardGuard>}>
          <Route index element={<Dashboard />} />
          <Route path="wallet" element={<DashboardWallet />} />
          <Route path="transactions" element={<DashboardOrders />} />
          <Route path="buy-data" element={<Navigate to="/dashboard/buy-data/mtn" replace />} />
          <Route path="buy-data/mtn" element={<DashboardBuyDataNetwork network="MTN" />} />
          <Route path="buy-data/telecel" element={<DashboardBuyDataNetwork network="Telecel" />} />
          <Route path="buy-data/airteltigo" element={<DashboardBuyDataNetwork network="AirtelTigo" />} />
          <Route path="my-store" element={<DashboardMyStore />} />
          <Route path="report-issue" element={<DashboardReportIssue />} />
          <Route path="account-settings" element={<DashboardAccountSettings />} />

          {/* Paid agent-only pages */}
          <Route path="cheaper-prices" element={<AgentFeatureGuard><DashboardPricing /></AgentFeatureGuard>} />
          <Route path="withdrawals" element={<AgentFeatureGuard><DashboardWithdraw /></AgentFeatureGuard>} />
          <Route path="store-settings" element={<AgentFeatureGuard><DashboardSettings /></AgentFeatureGuard>} />
          <Route path="subagents" element={<ParentAgentOnlyGuard><DashboardSubAgents /></ParentAgentOnlyGuard>} />
          <Route path="subagent-pricing" element={<ParentAgentOnlyGuard><DashboardSubAgentPricing /></ParentAgentOnlyGuard>} />
          <Route path="flyer" element={<AgentFeatureGuard><DashboardFlyer /></AgentFeatureGuard>} />
          <Route path="/dashboard/api" element={<AgentFeatureGuard><DashboardDeveloperAPI /></AgentFeatureGuard>} />
          <Route path="result-checker" element={<AgentFeatureGuard><DashboardResultCheckers /></AgentFeatureGuard>} />

          {/* Legacy aliases */}
          <Route path="orders" element={<Navigate to="/dashboard/transactions" replace />} />
          <Route path="withdraw" element={<Navigate to="/dashboard/withdrawals" replace />} />
          <Route path="pricing" element={<Navigate to="/dashboard/cheaper-prices" replace />} />
          <Route path="sub-agents" element={<Navigate to="/dashboard/subagents" replace />} />
          <Route path="result-checkers" element={<Navigate to="/dashboard/result-checker" replace />} />
          <Route path="settings" element={<Navigate to="/dashboard/store-settings" replace />} />
        </Route>

        {/* Admin dashboard */}
        <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
          <Route index element={<AdminOverview />} />
          <Route path="agents" element={<AdminAgents />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="withdrawals" element={<AdminWithdrawals />} />
          <Route path="notifications" element={<AdminNotificationsPage />} />
          <Route path="packages" element={<AdminPackages />} />
          <Route path="wallet-topup" element={<AdminWalletTopup />} />
          <Route path="system-health" element={<AdminSystemHealth />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="promotions" element={<AdminPromotions />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="audit-logs" element={<AdminAuditLogs />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      {!isDashboard && !isAgentStore && !isAdmin && <Footer />}
      {!isDashboard && !isAdmin && <TutorialModal />}
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AppContent />
            <ThemeSelector />
            <WhatsAppButton />
            <InstallPrompt />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
