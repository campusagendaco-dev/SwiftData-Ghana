import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import DashboardLayout from "@/components/DashboardLayout";
import AdminLayout from "@/components/AdminLayout";
import Index from "./pages/Index";
import BuyData from "./pages/BuyData";
import AgentProgram from "./pages/AgentProgram";
import Dashboard from "./pages/Dashboard";
import DashboardPricing from "./pages/DashboardPricing";
import DashboardAfa from "./pages/DashboardAfa";
import DashboardOrders from "./pages/DashboardOrders";
import DashboardWithdraw from "./pages/DashboardWithdraw";
import DashboardWallet from "./pages/DashboardWallet";
import DashboardSettings from "./pages/DashboardSettings";
import AuthUser from "./pages/AuthUser";
import ResetPassword from "./pages/ResetPassword";
import Onboarding from "./pages/Onboarding";
import AgentPending from "./pages/AgentPending";
import AgentStore from "./pages/AgentStore";
import AfaBundles from "./pages/AfaBundles";
import OrderStatus from "./pages/OrderStatus";
import AdminOverview from "./pages/AdminOverview";
import AdminAgents from "./pages/AdminAgents";
import AdminOrders from "./pages/AdminOrders";
import AdminUsers from "./pages/AdminUsers";
import AdminWithdrawals from "./pages/AdminWithdrawals";
import AdminNotificationsPage from "./pages/AdminNotificationsPage";
import AdminPackages from "./pages/AdminPackages";
import AdminWalletTopup from "./pages/AdminWalletTopup";
import AdminSystemHealth from "./pages/AdminSystemHealth";
import Maintenance from "./pages/Maintenance";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/** Requires auth — redirects to login */
const AuthGuard = ({ children, redirectTo = "/login" }: { children: React.ReactNode; redirectTo?: string }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
};

/** Agent onboarding guard */
const OnboardingRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (profile?.onboarding_complete) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

/** Agent dashboard guard — must be onboarded AND approved */
const DashboardGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.onboarding_complete) return <Navigate to="/onboarding" replace />;
  if (!profile?.agent_approved) return <Navigate to="/agent/pending" replace />;
  return <>{children}</>;
};

/** Admin guard */
const AdminGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

/** Agent pending guard */
const PendingGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.is_agent || !profile?.onboarding_complete) return <Navigate to="/onboarding" replace />;
  if (profile?.agent_approved) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const AppContent = () => {
  const { isAdmin: isAdminUser, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [maintenance, setMaintenance] = useState<{ is_enabled: boolean; message: string }>({
    is_enabled: false,
    message: "",
  });
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadMaintenance = async () => {
      const { data, error } = await supabase
        .from("maintenance_settings" as any)
        .select("is_enabled, message")
        .eq("id", 1)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setMaintenance({ is_enabled: false, message: "" });
      } else if (data) {
        setMaintenance({
          is_enabled: Boolean((data as any).is_enabled),
          message: String((data as any).message || ""),
        });
      } else {
        setMaintenance({ is_enabled: false, message: "" });
      }

      setMaintenanceLoading(false);
    };

    loadMaintenance();

    const channel = supabase
      .channel("maintenance-settings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "maintenance_settings" },
        () => {
          loadMaintenance();
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate("/reset-password", { replace: true });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  const isDashboard = location.pathname.startsWith("/dashboard");
  const isAdmin = location.pathname.startsWith("/admin");
  const isAgentStore = location.pathname.startsWith("/store/");
  const isMaintenanceBypassRoute =
    location.pathname.startsWith("/admin") ||
    location.pathname === "/login" ||
    location.pathname === "/agent/login" ||
    location.pathname === "/reset-password" ||
    location.pathname === "/auth";
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const isRecoveryLink =
    hashParams.get("type") === "recovery" ||
    searchParams.get("type") === "recovery" ||
    !!searchParams.get("token_hash") ||
    !!searchParams.get("code");

  if (authLoading || maintenanceLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  // If Supabase recovery link lands on any route other than /reset-password,
  // force redirect so user always sees the password change form.
  if (isRecoveryLink && location.pathname !== "/reset-password") {
    return <Navigate to={`/reset-password${location.search || ""}${location.hash || ""}`} replace />;
  }

  if (maintenance.is_enabled && !isAdminUser && !isMaintenanceBypassRoute) {
    return <Maintenance message={maintenance.message} />;
  }

  return (
    <>
      {!isDashboard && !isAgentStore && !isAdmin && <Navbar />}
      <Routes>
        {/* Public pages */}
        <Route path="/" element={<Index />} />
        <Route path="/agent-program" element={<AgentProgram />} />
        <Route path="/afa-bundles" element={<AfaBundles />} />
        <Route path="/store/:slug" element={<AgentStore />} />
        <Route path="/order-status" element={<OrderStatus />} />

        {/* Auth pages */}
        <Route path="/login" element={<AuthUser />} />
        <Route path="/agent/login" element={<Navigate to="/login" replace />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />

        {/* Protected: buy data requires login */}
        <Route path="/buy-data" element={<AuthGuard><BuyData /></AuthGuard>} />

        {/* Agent flow */}
        <Route path="/onboarding" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
        <Route path="/agent/pending" element={<PendingGuard><AgentPending /></PendingGuard>} />

        {/* Agent dashboard — requires approval */}
        <Route path="/dashboard" element={<DashboardGuard><DashboardLayout /></DashboardGuard>}>
          <Route index element={<Dashboard />} />
          <Route path="pricing" element={<DashboardPricing />} />
          <Route path="afa" element={<DashboardAfa />} />
          <Route path="orders" element={<DashboardOrders />} />
          <Route path="wallet" element={<DashboardWallet />} />
          <Route path="withdraw" element={<DashboardWithdraw />} />
          <Route path="settings" element={<DashboardSettings />} />
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
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      {!isDashboard && !isAgentStore && !isAdmin && <Footer />}
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
