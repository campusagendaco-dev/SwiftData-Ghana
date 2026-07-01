import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, RefreshCw, Search, Wallet, Activity, ArrowRight,
  Database, CheckCircle2, XCircle, AlertCircle, Clock, Filter,
  ShieldCheck, Smartphone, DollarSign, HelpCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

interface KorbaBundle {
  name: string;
  product_id: string;
  amount: string;
  validity: string;
  network: string;
}

interface OrderRow {
  id: string;
  created_at: string;
  customer_phone: string;
  customer_name: string | null;
  network: string | null;
  status: string;
  amount: number;
  order_type: string;
  package_size: string | null;
  failure_reason: string | null;
  profiles?: {
    full_name: string | null;
    email: string | null;
  };
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  paid: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  processing: "bg-sky-500/10 text-sky-500 border-sky-500/20",
  fulfilled: "bg-green-500/10 text-green-500 border-green-500/20",
  fulfillment_failed: "bg-red-500/10 text-red-500 border-red-500/20",
};

const AdminKorbaHub = () => {
  const { toast } = useToast();
  
  // OVA Balance state
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Proxy Health state
  const [proxyHealth, setProxyHealth] = useState<{ checked: boolean; healthy: boolean | null; error: string | null }>({
    checked: false,
    healthy: null,
    error: null
  });
  const [checkingHealth, setCheckingHealth] = useState(false);

  // Packages state
  const [bundles, setBundles] = useState<KorbaBundle[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [packageSearch, setPackageSearch] = useState("");
  const [packageNetworkTab, setPackageNetworkTab] = useState("all");

  // Payments state
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [verifyingOrderId, setVerifyingOrderId] = useState<string | null>(null);

  // Gateway Logs State
  const [gatewayLogs, setGatewayLogs] = useState<any[]>([]);
  const [loadingGatewayLogs, setLoadingGatewayLogs] = useState(false);

  const fetchGatewayLogs = useCallback(async (silent = false) => {
    if (!silent) setLoadingGatewayLogs(true);
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "get_korba_transactions" }
      });
      if (error) throw error;
      if (data?.success) {
        setGatewayLogs(data.results || []);
      } else {
        throw new Error(data?.error || "Failed to fetch gateway logs");
      }
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Gateway Logs Fetch Failed",
        description: e.message || "Failed to retrieve transactions from Korba API.",
        variant: "destructive"
      });
    } finally {
      if (!silent) setLoadingGatewayLogs(false);
    }
  }, [toast]);

  // Fetch OVA Balance
  const fetchBalance = useCallback(async (silent = false) => {
    if (!silent) setLoadingBalance(true);
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "get_korba_balance" }
      });
      if (error) throw error;
      if (data?.success) {
        setBalance(data.ova_balance);
        if (!silent) {
          toast({
            title: "Balance Synced",
            description: `Korba OVA Wallet balance is GHS ${Number(data.ova_balance).toFixed(2)}`,
          });
        }
      } else {
        throw new Error(data?.error || "Failed to fetch balance");
      }
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Balance Fetch Failed",
        description: e.message || "Failed to query OVA balance. Check function logs or credentials.",
        variant: "destructive"
      });
    } finally {
      if (!silent) setLoadingBalance(false);
    }
  }, [toast]);

  // Fetch Packages
  const fetchPackages = useCallback(async (silent = false) => {
    if (!silent) setLoadingPackages(true);
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "get_korba_packages" }
      });
      if (error) throw error;
      if (data?.success) {
        setBundles(data.bundles || []);
        if (!silent) {
          toast({
            title: "Packages Refreshed",
            description: `Successfully loaded ${data.bundles?.length || 0} bundles from Korba API.`,
          });
        }
      } else {
        throw new Error(data?.error || "Failed to fetch packages");
      }
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Packages Fetch Failed",
        description: e.message || "Failed to load Korba data packages.",
        variant: "destructive"
      });
    } finally {
      if (!silent) setLoadingPackages(false);
    }
  }, [toast]);

  // Check Database Proxy Health
  const checkProxyHealth = useCallback(async (silent = false) => {
    if (!silent) setCheckingHealth(true);
    try {
      const { data, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "check_proxy_health" }
      });
      if (error) throw error;
      if (data?.success) {
        setProxyHealth({
          checked: true,
          healthy: data.healthy,
          error: data.error || null
        });
        if (!silent) {
          toast({
            title: data.healthy ? "Proxy is Active" : "Proxy is Unresponsive",
            description: data.healthy 
              ? "Database HTTP proxy connection tested successfully." 
              : `Proxy failed: ${data.error || "Connection timed out."}`,
            variant: data.healthy ? "default" : "destructive"
          });
        }
      } else {
        throw new Error(data?.error || "Invalid response from health check function");
      }
    } catch (e: any) {
      console.error(e);
      setProxyHealth({
        checked: true,
        healthy: false,
        error: e.message || "Failed to call health check function"
      });
      if (!silent) {
        toast({
          title: "Health Check Failed",
          description: e.message || "Failed to execute database proxy health check.",
          variant: "destructive"
        });
      }
    } finally {
      if (!silent) setCheckingHealth(false);
    }
  }, [toast]);

  // Fetch Orders
  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoadingOrders(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("id, created_at, customer_phone, customer_name, network, status, amount, order_type, package_size, failure_reason, profiles(full_name, email)")
        .eq("payment_method", "korba")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders(data as any || []);
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Orders Load Failed",
        description: e.message || "Failed to fetch Korba payments list.",
        variant: "destructive"
      });
    } finally {
      if (!silent) setLoadingOrders(false);
    }
  }, [toast]);

  // Verify/Query Korba Transaction status
  const verifyKorbaTransaction = async (orderId: string) => {
    setVerifyingOrderId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("verify-payment", {
        body: { reference: orderId }
      });
      if (error) throw error;

      if (data?.status === "success" || data?.status === "fulfilled") {
        toast({
          title: "Payment Confirmed",
          description: `Transaction status query returned success. Order is marked as paid/fulfilled.`,
        });
      } else if (data?.status === "error") {
        toast({
          title: "Transaction Failed",
          description: data.error || "Korba returned a failed status for this payment.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Transaction Pending",
          description: data?.message || `Current Korba payment status: ${data?.status || "pending"}`,
        });
      }
      // Re-fetch orders to show updated status
      await fetchOrders(true);
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Query Failed",
        description: e.message || "Network request failed while verifying transaction.",
        variant: "destructive"
      });
    } finally {
      setVerifyingOrderId(null);
    }
  };

  // Initial load
  useEffect(() => {
    fetchBalance(true);
    fetchPackages(true);
    fetchOrders();
    checkProxyHealth(true);
    fetchGatewayLogs(true);
  }, [fetchBalance, fetchPackages, fetchOrders, checkProxyHealth, fetchGatewayLogs]);

  // Filter packages
  const filteredBundles = bundles.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(packageSearch.toLowerCase()) || 
                          b.product_id.toLowerCase().includes(packageSearch.toLowerCase());
    
    if (packageNetworkTab === "all") return matchesSearch;
    if (packageNetworkTab === "mtn") return matchesSearch && b.network === "MTN";
    if (packageNetworkTab === "telecel") return matchesSearch && b.network === "Vodafone/Telecel";
    if (packageNetworkTab === "airteltigo") return matchesSearch && b.network === "AirtelTigo";
    return matchesSearch;
  });

  // Filter orders
  const filteredOrders = orders.filter(o => {
    const matchesSearch = o.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
                          o.customer_phone.includes(orderSearch) ||
                          (o.customer_name || "").toLowerCase().includes(orderSearch.toLowerCase()) ||
                          (o.profiles?.full_name || "").toLowerCase().includes(orderSearch.toLowerCase());

    if (orderStatusFilter === "all") return matchesSearch;
    return matchesSearch && o.status === orderStatusFilter;
  });

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20">
              <Activity className="w-6 h-6 text-amber-600 dark:text-amber-500" />
            </div>
            <h1 className="text-3xl font-black tracking-tighter text-foreground uppercase">Korba Integration Hub</h1>
          </div>
          <p className="text-muted-foreground text-sm font-medium">
            Monitor fetched packages, check partner wallet balance, and track separate Korba Collections transactions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => {
              fetchBalance();
              fetchPackages();
              fetchOrders();
              checkProxyHealth(true);
              fetchGatewayLogs();
            }}
            disabled={loadingBalance || loadingPackages || loadingOrders || checkingHealth || loadingGatewayLogs}
            className="flex items-center gap-2 rounded-xl transition-all font-bold text-xs"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (loadingBalance || loadingPackages || loadingOrders || checkingHealth || loadingGatewayLogs) && "animate-spin")} />
            Sync Everything
          </Button>
        </div>
      </div>

      {/* OVA Balance Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card border-border shadow-sm overflow-hidden relative group md:col-span-1">
          <div className="absolute top-0 left-0 w-full h-1 bg-amber-500" />
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">OVA Wallet Balance</span>
              <Wallet className="w-4 h-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            {loadingBalance ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                <span className="text-sm text-muted-foreground">Querying Korba API...</span>
              </div>
            ) : (
              <div>
                <h3 className="text-3xl font-black tracking-tight text-foreground">
                  GHS {balance !== null ? balance.toFixed(2) : "?.??"}
                </h3>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    Synced: {new Date().toLocaleTimeString()}
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => fetchBalance()}
                    className="h-7 text-xs font-black text-amber-500 hover:text-amber-600 hover:bg-amber-500/5 px-2 rounded-lg"
                  >
                    Sync Balance
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Database Proxy Status Card */}
        <Card className="bg-card border-border shadow-sm overflow-hidden relative group md:col-span-1">
          <div className={cn(
            "absolute top-0 left-0 w-full h-1",
            !proxyHealth.checked ? "bg-muted" : proxyHealth.healthy ? "bg-emerald-500" : "bg-red-500"
          )} />
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">DB Proxy Health</span>
              <Database className={cn(
                "w-4 h-4",
                !proxyHealth.checked ? "text-muted-foreground" : proxyHealth.healthy ? "text-emerald-500" : "text-red-500"
              )} />
            </div>
          </CardHeader>
          <CardContent>
            {checkingHealth ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Checking health...</span>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  {!proxyHealth.checked ? (
                    <>
                      <HelpCircle className="w-5 h-5 text-muted-foreground" />
                      <span className="font-bold text-sm text-muted-foreground">Not Checked</span>
                    </>
                  ) : proxyHealth.healthy ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <span className="font-bold text-sm text-emerald-600 dark:text-emerald-500">Active / Connected</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-5 h-5 text-red-500" />
                      <span className="font-bold text-sm text-red-600 dark:text-red-500">Unresponsive</span>
                    </>
                  )}
                </div>
                
                {proxyHealth.checked && !proxyHealth.healthy && (
                  <p className="text-[10px] text-red-500 mt-1.5 font-mono leading-tight max-h-[36px] overflow-y-auto bg-red-500/5 p-1 border border-red-500/10 rounded">
                    {proxyHealth.error || "Connection timed out."}
                  </p>
                )}

                <div className="flex items-center justify-between mt-4">
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    {proxyHealth.checked && proxyHealth.healthy ? (
                      <span className="text-emerald-600 dark:text-emerald-500">Static IP routing active</span>
                    ) : proxyHealth.checked ? (
                      <span className="text-red-500 font-bold animate-pulse">Action required</span>
                    ) : (
                      "Verify database proxy"
                    )}
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => checkProxyHealth()}
                    className="h-7 text-xs font-black text-foreground hover:bg-muted px-2 rounded-lg"
                  >
                    Check Health
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Whitelist Settings Card */}
        <Card className="bg-card border-border shadow-sm overflow-hidden md:col-span-1 relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Korba Whitelist Settings</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground leading-normal space-y-2">
            <p>
              Your database has dedicated static IP: <code className="bg-muted px-1.5 py-0.5 rounded font-mono font-bold text-foreground">51.102.66.77</code>.
            </p>
            <p>
              Ensure this IP is whitelisted on your Korba Developer settings.
            </p>
            <p className="text-[10px] bg-amber-500/5 text-amber-600 dark:text-amber-500 border border-amber-500/10 rounded-lg p-2 leading-relaxed">
              <strong>If Proxy is Unresponsive:</strong> Run <code className="bg-amber-500/10 font-bold px-1 rounded">SELECT net.worker_restart();</code> in Supabase SQL editor, or perform a **Fast Reboot** in Project Settings.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="packages" className="space-y-6">
        <TabsList className="bg-muted p-1 rounded-xl">
          <TabsTrigger value="packages" className="rounded-lg font-bold text-xs">Fetched Korba Packages ({filteredBundles.length})</TabsTrigger>
          <TabsTrigger value="payments" className="rounded-lg font-bold text-xs">Korba Payments ({filteredOrders.length})</TabsTrigger>
          <TabsTrigger value="gateway-logs" className="rounded-lg font-bold text-xs">Gateway Logs ({gatewayLogs.length})</TabsTrigger>
        </TabsList>

        {/* Tab 1: Korba Packages */}
        <TabsContent value="packages" className="space-y-6 outline-none">
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-bold">Dynamic Product IDs</CardTitle>
                <CardDescription className="text-xs">
                  Fetched directly from Korba API. These are active products and prices on the merchant exchange.
                </CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search package name or product ID..." 
                    value={packageSearch}
                    onChange={(e) => setPackageSearch(e.target.value)}
                    className="pl-9 h-9 w-full sm:w-64 rounded-xl text-xs bg-background border-border"
                  />
                </div>
                <div className="flex bg-muted p-0.5 rounded-lg border border-border h-9">
                  {[
                    { label: "All", value: "all" },
                    { label: "MTN", value: "mtn" },
                    { label: "Telecel", value: "telecel" },
                    { label: "AirtelTigo", value: "airteltigo" }
                  ].map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => setPackageNetworkTab(tab.value)}
                      className={cn(
                        "px-3 text-xs font-bold rounded-md transition-all",
                        packageNetworkTab === tab.value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingPackages ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                  <p className="text-sm font-semibold text-muted-foreground">Fetching packages from Korba Xchange...</p>
                </div>
              ) : filteredBundles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                  <Database className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <h4 className="text-sm font-bold text-foreground">No Packages Found</h4>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    {packageSearch ? "No bundles match your search query." : "Failed to fetch Korba bundles, or no bundles are active."}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => fetchPackages()} className="mt-4 rounded-xl text-xs">
                    Retry Fetch
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 font-bold text-muted-foreground uppercase tracking-wider">
                        <th className="p-4">Network</th>
                        <th className="p-4">Package Name</th>
                        <th className="p-4">Product ID</th>
                        <th className="p-4 text-right">Merchant Cost</th>
                        <th className="p-4">Validity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredBundles.map((b, i) => (
                        <tr key={i} className="hover:bg-muted/10 transition-colors">
                          <td className="p-4 font-bold">
                            <Badge variant="outline" className={cn(
                              "font-black tracking-tight rounded-md",
                              b.network.includes("MTN") && "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
                              b.network.includes("Telecel") && "bg-red-500/10 text-red-500 border-red-500/20",
                              b.network.includes("Airtel") && "bg-cyan-500/10 text-cyan-600 border-cyan-500/20"
                            )}>
                              {b.network}
                            </Badge>
                          </td>
                          <td className="p-4 font-semibold text-foreground">{b.name}</td>
                          <td className="p-4 font-mono text-muted-foreground">{b.product_id}</td>
                          <td className="p-4 font-bold text-right text-foreground">GHS {Number(b.amount).toFixed(2)}</td>
                          <td className="p-4 text-muted-foreground">{b.validity || "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Korba Payments */}
        <TabsContent value="payments" className="space-y-6 outline-none">
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-bold">Korba Collections</CardTitle>
                <CardDescription className="text-xs">
                  All transactions initiated or paid via Korba. Update statuses manually using the real-time API query.
                </CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search by ID, Phone, Agent Name..." 
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    className="pl-9 h-9 w-full sm:w-64 rounded-xl text-xs bg-background border-border"
                  />
                </div>
                <div className="relative flex items-center gap-1.5 border border-border h-9 px-3 rounded-xl bg-background">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <select
                    value={orderStatusFilter}
                    onChange={(e) => setOrderStatusFilter(e.target.value)}
                    className="bg-transparent border-none text-xs font-bold outline-none text-foreground cursor-pointer pr-4"
                  >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="processing">Processing</option>
                    <option value="fulfilled">Fulfilled</option>
                    <option value="fulfillment_failed">Failed</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingOrders ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                  <p className="text-sm font-semibold text-muted-foreground">Loading orders...</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                  <Smartphone className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <h4 className="text-sm font-bold text-foreground">No Payments Logged</h4>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    {orderSearch ? "No orders match your filter criteria." : "There are no mobile money payments processed via Korba yet."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 font-bold text-muted-foreground uppercase tracking-wider">
                        <th className="p-4">Order ID & Date</th>
                        <th className="p-4">Agent (Reseller)</th>
                        <th className="p-4">Type & Recipient</th>
                        <th className="p-4 text-right">Amount</th>
                        <th className="p-4">Status</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredOrders.map((order) => {
                        const formattedDate = new Date(order.created_at).toLocaleString();
                        const isVerifying = verifyingOrderId === order.id;

                        return (
                          <tr key={order.id} className="hover:bg-muted/10 transition-colors">
                            <td className="p-4 space-y-1">
                              <span className="font-mono font-bold text-foreground block">{order.id.slice(0, 13)}...</span>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3 shrink-0" />
                                {formattedDate}
                              </span>
                            </td>
                            <td className="p-4 space-y-0.5">
                              <span className="font-bold text-foreground block">
                                {order.profiles?.full_name || "Guest Customer"}
                              </span>
                              <span className="text-[10px] text-muted-foreground font-semibold">
                                {order.profiles?.email || "No email"}
                              </span>
                            </td>
                            <td className="p-4 space-y-1">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="secondary" className="font-bold text-[10px] uppercase rounded-md tracking-wider">
                                  {order.order_type}
                                </Badge>
                                {order.network && (
                                  <span className="text-[10px] font-bold text-muted-foreground">
                                    ({order.network})
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] font-mono text-foreground font-semibold block">
                                Recipient: {order.customer_phone}
                              </span>
                              {order.package_size && (
                                <span className="text-[10px] text-muted-foreground block">
                                  Pack: {order.package_size}
                                </span>
                              )}
                            </td>
                            <td className="p-4 font-black text-right text-foreground">
                              GHS {order.amount.toFixed(2)}
                            </td>
                            <td className="p-4">
                              <Badge className={cn("rounded-md border font-black uppercase text-[10px] tracking-wider", STATUS_COLORS[order.status] || "bg-muted text-muted-foreground")}>
                                {order.status.replace("_", " ")}
                              </Badge>
                              {order.failure_reason && (
                                <span className="text-[10px] text-red-500 block max-w-[180px] truncate mt-1" title={order.failure_reason}>
                                  Err: {order.failure_reason}
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isVerifying || verifyingOrderId !== null}
                                onClick={() => verifyKorbaTransaction(order.id)}
                                className="h-8 rounded-lg font-bold text-xs bg-card hover:bg-muted border-border hover:text-foreground text-muted-foreground transition-all"
                              >
                                {isVerifying ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1 text-amber-500" />
                                ) : (
                                  <Activity className="w-3.5 h-3.5 mr-1" />
                                )}
                                Query Status
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gateway-logs" className="space-y-4">
          <Card className="bg-card border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base font-black uppercase tracking-wider text-foreground">Korba Gateway Transactions</CardTitle>
                <CardDescription className="text-xs">Live paginated history fetched directly from Korba API endpoint (`client_transactions/`)</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchGatewayLogs()}
                disabled={loadingGatewayLogs}
                className="h-8 text-xs font-bold rounded-lg"
              >
                <RefreshCw className={cn("w-3.5 h-3.5 mr-2", loadingGatewayLogs && "animate-spin")} />
                Refresh API Logs
              </Button>
            </CardHeader>
            <CardContent>
              {loadingGatewayLogs ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                  <span className="text-sm text-muted-foreground font-medium">Fetching logs from Korba Gateway...</span>
                </div>
              ) : gatewayLogs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm font-medium">
                  No gateway transactions returned or Korba credentials not active.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-muted-foreground font-black uppercase tracking-wider bg-muted/30">
                        <th className="py-3 px-4">Korba ID</th>
                        <th className="py-3 px-4">Client Ref</th>
                        <th className="py-3 px-4">Recipient</th>
                        <th className="py-3 px-4">Debit (GHS)</th>
                        <th className="py-3 px-4">Credit (GHS)</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Message</th>
                        <th className="py-3 px-4">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-medium">
                      {gatewayLogs.map((tx: any) => (
                        <tr key={tx.korba_transaction_id} className="hover:bg-muted/10 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-foreground">{tx.korba_transaction_id}</td>
                          <td className="py-3 px-4 font-mono text-muted-foreground">{tx.client_transaction_id}</td>
                          <td className="py-3 px-4 font-mono">{tx.customer_number || "-"}</td>
                          <td className="py-3 px-4 font-mono text-red-500 font-bold">{Number(tx.debit_amt || 0).toFixed(2)}</td>
                          <td className="py-3 px-4 font-mono text-emerald-500 font-bold">{Number(tx.credit_amt || 0).toFixed(2)}</td>
                          <td className="py-3 px-4">
                            <Badge className={cn(
                              "text-[10px] font-black uppercase rounded-lg border",
                              tx.transaction_status === "success" 
                                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                                : "bg-red-500/10 text-red-500 border-red-500/20"
                            )}>
                              {tx.transaction_status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 max-w-[200px] truncate text-muted-foreground" title={tx.exchange_message}>{tx.exchange_message || "-"}</td>
                          <td className="py-3 px-4 text-muted-foreground">{new Date(tx.time_created).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminKorbaHub;
