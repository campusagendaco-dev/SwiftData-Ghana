import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Globe, Clock, Phone, ShieldCheck, Users2, User,
  Wallet, ShoppingCart, AlertTriangle, Gift, Hash,
  Loader2, CheckCircle2, XCircle, AlertCircle, Ban,
  Plus, Minus, TrendingUp, Save, Key, Lock, RefreshCw,
  MessageSquare, Send, Copy, Check, Smartphone, Sparkles,
  ChevronDown, ChevronUp, Edit3, ArrowRight, ShieldAlert,
  Bell, Radio
} from "lucide-react";

interface UserRow {
  user_id: string;
  full_name: string;
  email: string;
  phone?: string;
  is_agent: boolean;
  agent_approved: boolean;
  is_sub_agent: boolean;
  sub_agent_approved: boolean;
  parent_agent_id: string | null;
  created_at: string;
  last_ip?: string | null;
  last_seen_at?: string | null;
  last_location?: string | null;
  login_count?: number;
  referral_code?: string | null;
  referred_by?: string | null;
  total_sales_volume?: number;
  parent_name?: string;
  is_suspended?: boolean;
  admin_notes?: string | null;
  avatar_url?: string | null;
}

interface Order {
  id: string;
  order_type: string;
  network?: string;
  package_size?: string;
  customer_phone?: string;
  amount: number;
  profit?: number;
  parent_profit?: number;
  status: string;
  failure_reason?: string | null;
  created_at: string;
}

function isBeneficiaryFailure(order: Pick<Order, "status" | "failure_reason">): boolean {
  if (order.status !== "fulfillment_failed") return false;
  const reason = (order.failure_reason || "").toLowerCase();
  return reason.includes("beneficiary") || reason.includes("not added");
}

const BENEFICIARY_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  submitted: { label: "in queue", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  whitelisted: { label: "in queue", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  in_queue: { label: "in queue", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
};

interface SharedAccount {
  user_id: string;
  full_name: string;
  email: string;
}

interface DrawerData {
  walletBalance: number;
  apiBalance: number;
  orders: Order[];
  sharedIpAccounts: SharedAccount[];
  referrerName?: string;
  totalSalesVolume?: number;
  totalOwnProfit?: number;
  totalCommissionsPaid?: number;
}

const STATUS_STYLES: Record<string, string> = {
  fulfilled: "text-green-400 bg-green-400/10 border-green-400/20",
  paid: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  pending: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  fulfillment_failed: "text-red-400 bg-red-400/10 border-red-400/20",
  failed: "text-red-400 bg-red-400/10 border-red-400/20",
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === "fulfilled") return <CheckCircle2 className="w-3 h-3" />;
  if (status === "fulfillment_failed" || status === "failed") return <XCircle className="w-3 h-3" />;
  return <AlertCircle className="w-3 h-3" />;
};

const avatarColor = (name: string) => {
  const colors = ["bg-amber-500", "bg-cyan-500", "bg-violet-500", "bg-emerald-500", "bg-rose-500", "bg-blue-500"];
  const idx = (name?.charCodeAt(0) ?? 0) % colors.length;
  return colors[idx];
};

const SMS_TEMPLATES = [
  {
    label: "👋 Welcome",
    text: "Hello {{name}}, welcome to SwiftData! Your account is active and ready. Explore data packages anytime at swiftdatagh.shop.",
  },
  {
    label: "💰 Top-up",
    text: "Hello {{name}}, your SwiftData wallet has been credited. Your current balance is {{balance}}. Thank you for choosing us!",
  },
  {
    label: "⚠️ Notice",
    text: "SwiftData Alert: Hi {{name}}, please check your account dashboard for an important notification regarding your services.",
  },
  {
    label: "🔐 Security",
    text: "Hello {{name}}, a security action (password/2FA update) was performed on your SwiftData account. Contact us if this was not you.",
  },
  {
    label: "⚡ Order Update",
    text: "Hello {{name}}, your recent SwiftData order has been processed. Check your transaction dashboard for live status.",
  },
];

const PUSH_TEMPLATES = [
  {
    label: "👋 General Notice",
    title: "🔔 Important Notice",
    text: "Hi {{name}}, we have an update on your SwiftData account. Tap to view your dashboard.",
  },
  {
    label: "💰 Wallet Credited",
    title: "💳 Wallet Credited",
    text: "Hi {{name}}, your wallet has been credited! Tap to view your new balance: {{balance}}.",
  },
  {
    label: "📦 Order Delivered",
    title: "📦 Order Delivered",
    text: "Hi {{name}}, your data bundle order was successfully delivered! Thank you for ordering.",
  },
  {
    label: "🛡️ Security Alert",
    title: "🛡️ Security Update",
    text: "Security Alert: A login or credentials update was performed on your SwiftData account.",
  },
];

const PRESET_AMOUNTS = [10, 50, 100, 200, 500];

interface Props {
  user: UserRow | null;
  onClose: () => void;
}

const UserDetailDrawer = ({ user, onClose }: Props) => {
  const { toast } = useToast();
  const { session } = useAuth();
  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSuspended, setIsSuspended] = useState(user?.is_suspended ?? false);
  const [suspending, setSuspending] = useState(false);
  const [adminNotes, setAdminNotes] = useState(user?.admin_notes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);
  const [walletType, setWalletType] = useState<"main" | "api">("main");
  const [beneficiaryStatus, setBeneficiaryStatus] = useState<Record<string, string>>({});

  // Communication & Dispatch States
  const [showCommCard, setShowCommCard] = useState(false);
  const [activeCommTab, setActiveCommTab] = useState<"sms" | "push">("sms");

  // SMS States
  const [smsPhone, setSmsPhone] = useState(user?.phone || "");
  const [smsMessage, setSmsMessage] = useState("");
  const [smsSending, setSmsSending] = useState(false);

  // Web Push States
  const [pushTitle, setPushTitle] = useState("SwiftData Ghana");
  const [pushBody, setPushBody] = useState("");
  const [pushUrl, setPushUrl] = useState("/dashboard");
  const [pushSending, setPushSending] = useState(false);
  const [pushSubscriptionCount, setPushSubscriptionCount] = useState<number>(0);

  // Dispatch History
  const [dispatchHistory, setDispatchHistory] = useState<Array<{ text: string; time: string; channel: "sms" | "push"; status: "sent" | "failed" }>>([]);

  // Phone editing
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState(user?.phone || "");
  const [savingPhone, setSavingPhone] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    setIsSuspended(user?.is_suspended ?? false);
    setAdminNotes(user?.admin_notes || "");
    setSmsPhone(user?.phone || "");
    setPhoneInput(user?.phone || "");
    setEditingPhone(false);
  }, [user?.user_id, user?.admin_notes, user?.is_suspended, user?.phone]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: "Copied to clipboard", description: text });
    setTimeout(() => setCopiedField(null), 2000);
  };

  const parseEdgeError = async (error: any, resData?: any): Promise<string> => {
    if (resData?.error) return resData.error;
    if (error) {
      try {
        const bodyText = await error.context?.text();
        if (bodyText) {
          const parsed = JSON.parse(bodyText);
          if (parsed.error) return parsed.error;
        }
      } catch {
        // Ignore error body JSON parse failures
      }
      return error.message || "Edge function invocation failed";
    }
    return "Unknown error";
  };

  const handleSuspend = async () => {
    if (!user) return;
    const next = !isSuspended;
    setSuspending(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "bulk_suspend_users", user_ids: [user.user_id], suspend: next },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      
      if (error || res?.error) {
        throw new Error(await parseEdgeError(error, res));
      }

      setIsSuspended(next);
      if (user) user.is_suspended = next;
      toast({ title: next ? "User suspended" : "User unsuspended", description: user.email });
    } catch (err: unknown) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSuspending(false);
    }
  };

  const [promoting, setPromoting] = useState(false);
  const handlePromoteAgent = async () => {
    if (!user) return;
    setPromoting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "approve_agent", user_id: user.user_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || res?.error) {
        throw new Error(await parseEdgeError(error, res));
      }
      
      toast({ title: "User promoted to Agent", description: user.email });
      onClose();
    } catch (err: any) {
      toast({ title: "Promotion failed", description: err.message, variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  };

  const [resetLinkSending, setResetLinkSending] = useState(false);
  const handleSendResetLink = async () => {
    if (!user) return;
    setResetLinkSending(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "send_reset_link", user_id: user.user_id, email: user.email },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || res?.error) throw new Error(await parseEdgeError(error, res));
      
      const link = res?.action_link;
      if (link) {
        navigator.clipboard.writeText(link);
        toast({ title: "Reset Link Generated! 🔗", description: "Copied recovery URL to clipboard & sent reset instructions." });
      } else {
        toast({ title: "Reset Email Sent 📧", description: `Password recovery link dispatched to ${user.email}.` });
      }
    } catch (err: any) {
      toast({ title: "Reset Link Failed", description: err.message, variant: "destructive" });
    } finally {
      setResetLinkSending(false);
    }
  };

  const [revokingSessions, setRevokingSessions] = useState(false);
  const handleRevokeSessions = async () => {
    if (!user) return;
    if (!window.confirm(`Are you sure you want to force logout ${user.full_name || user.email} from all devices?`)) return;
    setRevokingSessions(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("admin-user-actions", {
        body: { action: "revoke_sessions", user_id: user.user_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || res?.error) throw new Error(await parseEdgeError(error, res));
      toast({ title: "Sessions Revoked 🔒", description: `All active sessions for ${user.email} terminated.` });
    } catch (err: any) {
      toast({ title: "Revoke Failed", description: err.message, variant: "destructive" });
    } finally {
      setRevokingSessions(false);
    }
  };

  const handleSavePhone = async () => {
    if (!user) return;
    const clean = phoneInput.trim();
    setSavingPhone(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ phone: clean || null })
        .eq("user_id", user.user_id);
      if (error) throw error;

      user.phone = clean || undefined;
      setSmsPhone(clean);
      setEditingPhone(false);
      toast({
        title: clean ? "Phone Number Updated" : "Phone Number Removed",
        description: clean ? `Saved ${clean} to ${user.full_name || "user"}'s profile.` : "Profile phone cleared.",
      });
    } catch (err: any) {
      toast({ title: "Failed to update phone", description: err.message, variant: "destructive" });
    } finally {
      setSavingPhone(false);
    }
  };

  const handleSendDirectSms = async () => {
    if (!user) return;
    const targetPhone = (smsPhone || user.phone || "").trim();
    if (!targetPhone) {
      toast({ title: "Recipient Phone Required", description: "Please enter a valid phone number.", variant: "destructive" });
      return;
    }
    if (!smsMessage.trim()) {
      toast({ title: "Message Required", description: "Please enter an SMS message.", variant: "destructive" });
      return;
    }

    setSmsSending(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("admin-send-sms", {
        body: {
          target_type: "direct",
          phone: targetPhone,
          message: smsMessage.trim(),
          sender_id: "SwiftData",
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (error || res?.error) {
        throw new Error(await parseEdgeError(error, res));
      }

      toast({
        title: "SMS Dispatched Successfully! 🚀",
        description: `Delivered to ${targetPhone} via unified SMS gateway.`,
      });

      setDispatchHistory(prev => [
        { text: smsMessage.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), channel: "sms", status: "sent" },
        ...prev.slice(0, 4)
      ]);
      setSmsMessage("");
    } catch (err: any) {
      toast({
        title: "SMS Failed to Send",
        description: err.message || "Failed to send SMS message.",
        variant: "destructive",
      });
      setDispatchHistory(prev => [
        { text: smsMessage.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), channel: "sms", status: "failed" },
        ...prev.slice(0, 4)
      ]);
    } finally {
      setSmsSending(false);
    }
  };

  const handleSendWebPush = async () => {
    if (!user) return;
    if (!pushBody.trim()) {
      toast({ title: "Message Required", description: "Please enter a notification message.", variant: "destructive" });
      return;
    }

    setPushSending(true);
    try {
      const title = pushTitle.trim() || "SwiftData Ghana";
      const messageText = pushBody.trim();
      const targetUrl = pushUrl.trim() || "/dashboard";

      // 1. Dispatch Web Push notification to registered devices
      const { data: res, error } = await supabase.functions.invoke("send-push-notification", {
        body: {
          user_id: user.user_id,
          title,
          body: messageText,
          url: targetUrl,
          icon: "/pwa-192x192.png",
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      // 2. Also record in user_notifications table so it appears in customer's in-app notification center
      await supabase.from("user_notifications").insert({
        user_id: user.user_id,
        title,
        message: messageText,
        type: "system",
        data: { url: targetUrl },
      });

      const devicesSent = Number(res?.sent ?? 0);
      toast({
        title: "Web Push Notification Sent! 🔔",
        description: devicesSent > 0
          ? `Dispatched to ${devicesSent} active browser/device(s) & customer inbox.`
          : "Saved to customer's notification inbox (device push subscription inactive).",
      });

      setDispatchHistory(prev => [
        { text: `[PUSH] ${messageText}`, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), channel: "push", status: "sent" },
        ...prev.slice(0, 4)
      ]);
      setPushBody("");
    } catch (err: any) {
      toast({
        title: "Push Failed",
        description: err.message || "Failed to send web push notification.",
        variant: "destructive",
      });
      setDispatchHistory(prev => [
        { text: `[PUSH FAILED] ${pushBody.trim()}`, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), channel: "push", status: "failed" },
        ...prev.slice(0, 4)
      ]);
    } finally {
      setPushSending(false);
    }
  };

  const applySmsTemplate = (tpl: string) => {
    const firstName = user?.full_name?.split(" ")[0] || "Customer";
    const balanceStr = `GH₵ ${(data?.walletBalance ?? 0).toFixed(2)}`;
    const parsed = tpl
      .replace(/\{\{name\}\}/gi, firstName)
      .replace(/\{\{balance\}\}/gi, balanceStr);
    setSmsMessage(parsed);
  };

  const applyPushTemplate = (title: string, tpl: string) => {
    const firstName = user?.full_name?.split(" ")[0] || "Customer";
    const balanceStr = `GH₵ ${(data?.walletBalance ?? 0).toFixed(2)}`;
    setPushTitle(title);
    setPushBody(tpl.replace(/\{\{name\}\}/gi, firstName).replace(/\{\{balance\}\}/gi, balanceStr));
  };

  const handleManualTopup = async (isDeduction = false) => {
    if (!user || !topupAmount || isNaN(Number(topupAmount))) return;
    const amount = Number(topupAmount) * (isDeduction ? -1 : 1);
    const currentBalance = walletType === "api" ? (data?.apiBalance ?? 0) : (data?.walletBalance ?? 0);
    
    if (isDeduction && Math.abs(amount) > currentBalance) {
       if (!window.confirm("This will result in a negative balance. Continue?")) return;
    }

    setTopupLoading(true);
    try {
      const action = walletType === "api" ? "manual_api_topup" : "manual_topup";
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: action, user_id: user.user_id, amount: amount },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || res?.error) {
        throw new Error(await parseEdgeError(error, res));
      }
      
      setData(prev => prev ? { 
        ...prev, 
        walletBalance: walletType === "main" ? res.new_balance : prev.walletBalance,
        apiBalance: walletType === "api" ? res.new_balance : prev.apiBalance 
      } : prev);
      setTopupAmount("");
      toast({ 
        title: isDeduction ? `${walletType === "api" ? "API " : ""}Wallet Debited` : `${walletType === "api" ? "API " : ""}Wallet Credited`, 
        description: `${isDeduction ? "Removed" : "Added"} GH₵ ${Math.abs(amount).toFixed(2)} to ${user.full_name}'s ${walletType} wallet.` 
      });
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setTopupLoading(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!user) return;
    setSavingNotes(true);
    try {
      const { error } = await (supabase as any).from("profiles").update({ admin_notes: adminNotes }).eq("user_id", user.user_id);
      if (error) throw error;
      toast({ title: "Notes updated" });
    } catch (err: any) {
      toast({ title: "Failed to save notes", description: err.message, variant: "destructive" });
    } finally {
      setSavingNotes(false);
    }
  };

  const [mfaLoading, setMfaLoading] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleResetMfa = async () => {
    if (!user) return;
    if (!window.confirm(`⚠️ DANGER: Are you sure you want to COMPLETELY DISABLE Multi-Factor Authentication (MFA) for ${user.full_name || user.email}?\n\nThis will remove their active authenticator association and allow them to log in with only their password. Only do this if the user is locked out or has lost their mobile device.`)) {
      return;
    }

    setMfaLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "reset_user_mfa", user_id: user.user_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      
      if (error) {
        try {
          const bodyText = await (error as any).context?.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText);
            if (parsed.error) throw new Error(parsed.error);
          }
        } catch (innerErr: any) {
          if (innerErr.message && innerErr.message !== "Unexpected end of JSON input") throw innerErr;
        }
        throw new Error(error.message || "Edge function failed");
      }
      if (res?.error) throw new Error(res.error);
      
      toast({ 
        title: "MFA/2FA successfully disabled", 
        description: `Removed ${res.reset_count || 0} active MFA factor(s). User can now log in without a 2FA code.` 
      });
    } catch (err: any) {
      toast({ title: "MFA reset failed", description: err.message, variant: "destructive" });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user) return;
    const entered = window.prompt(`New password for ${user.email} (min 6 chars). Leave blank to auto-generate.`);
    if (entered !== null && entered.trim() && entered.trim().length < 6) {
      toast({ title: "Password too short", variant: "destructive" }); return;
    }
    setPwLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("system-payout-v1", {
        body: { action: "reset_password", user_id: user.user_id, new_password: entered?.trim() || undefined },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      
      if (error) {
        try {
          const bodyText = await (error as any).context?.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText);
            if (parsed.error) throw new Error(parsed.error);
          }
        } catch (innerErr: any) {
          if (innerErr.message && innerErr.message !== "Unexpected end of JSON input") throw innerErr;
        }
        throw new Error(error.message || "Edge function failed");
      }
      if (res?.error) throw new Error(res.error);

      toast({ title: "Password updated successfully", description: `Login: ${user.email}` });
    } catch (err: any) {
      toast({ title: "Failed to reset password", description: err.message, variant: "destructive" });
    } finally {
      setPwLoading(false);
    }
  };

  useEffect(() => {
    if (!user) { setData(null); return; }
    setLoading(true);
    setData(null);

    const load = async () => {
      const queries: Promise<any>[] = [
        supabase.from("wallets").select("balance, api_balance").eq("agent_id", user.user_id).maybeSingle(),
        supabase.from("orders").select("id, order_type, network, package_size, customer_phone, amount, profit, parent_profit, status, failure_reason, created_at")
          .eq("agent_id", user.user_id).order("created_at", { ascending: false }).limit(15),
        user.last_ip
          ? (supabase.from("profiles") as any).select("user_id, full_name, email").eq("last_ip", user.last_ip).neq("user_id", user.user_id).limit(5)
          : Promise.resolve({ data: [] }),
        user.referred_by
          ? supabase.from("profiles").select("full_name").eq("user_id", user.referred_by).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("user_sales_stats").select("total_sales_volume, total_own_profit, total_commissions_paid").eq("user_id", user.user_id).maybeSingle(),
        supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.user_id),
      ];

      const [walletRes, ordersRes, sharedRes, referrerRes, salesStatsRes, pushSubRes] = await Promise.all(queries);
      const orders = (ordersRes.data || []) as Order[];

      setData({
        walletBalance: Number(walletRes.data?.balance ?? 0),
        apiBalance: Number(walletRes.data?.api_balance ?? 0),
        orders,
        sharedIpAccounts: (sharedRes.data || []) as SharedAccount[],
        referrerName: referrerRes.data?.full_name ?? undefined,
        totalSalesVolume: Number(salesStatsRes.data?.total_sales_volume ?? 0),
        totalOwnProfit: Number(salesStatsRes.data?.total_own_profit ?? 0),
        totalCommissionsPaid: Number(salesStatsRes.data?.total_commissions_paid ?? 0),
      });
      setPushSubscriptionCount(Number(pushSubRes?.count ?? 0));
      setLoading(false);

      setBeneficiaryStatus({});
    };

    void load();
  }, [user?.user_id]);

  useEffect(() => {
    if (!user) return;
    const channelId = `user_drawer_beneficiary_${user.user_id}_${Math.random().toString(36).substring(7)}`;
    const ch = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "beneficiary_submissions" },
        (payload: any) => {
          const row = payload.new;
          if (!row?.phone_number) return;
          setBeneficiaryStatus((prev) => ({ ...prev, [row.phone_number]: row.status }));
        }
      )
      .subscribe();
    return () => { safeRemoveChannel(ch); };
  }, [user?.user_id]);

  if (!user) return null;

  const initials = (user.full_name || user.email || "?")
    .split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

  const roleLabel = user.is_sub_agent
    ? user.sub_agent_approved ? "Sub-Agent" : "Sub-Agent (Pending)"
    : user.is_agent
    ? user.agent_approved ? "Agent" : "Agent (Pending)"
    : "Customer";

  const roleColor = user.is_sub_agent
    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
    : user.is_agent
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : "bg-white/5 text-white/50 border-white/10";

  const flags = [
    isSuspended && { type: "danger", label: "This account is suspended", sub: "User is blocked from buying or placing orders" },
    data && data.sharedIpAccounts.length > 0 && {
      type: "danger",
      label: `IP shared with ${data.sharedIpAccounts.length} other account${data.sharedIpAccounts.length > 1 ? "s" : ""}`,
      sub: data.sharedIpAccounts.map(a => a.email).join(", "),
    },
    user.is_agent && !user.agent_approved && { type: "warn", label: "Agent approval pending", sub: "User requested agent verification" },
    user.is_sub_agent && !user.sub_agent_approved && { type: "warn", label: "Sub-agent approval pending", sub: "Waiting for parent or admin review" },
  ].filter(Boolean) as { type: string; label: string; sub: string }[];

  const charCount = smsMessage.length;
  const smsSegments = Math.ceil(charCount / 160) || 1;

  return (
    <Sheet open={!!user} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto bg-[#0a0a14] border-l border-white/10 p-0 text-white selection:bg-cyan-500 selection:text-black"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>User Detail</SheetTitle>
          <SheetDescription>Detailed info and actions for {user.full_name || user.email}.</SheetDescription>
        </SheetHeader>

        {/* ── Top Hero Card ── */}
        <div className="relative p-6 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent">
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <Avatar className="w-16 h-16 rounded-2xl border-2 border-white/15 shadow-xl">
                <AvatarImage src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.user_id}`} />
                <AvatarFallback className={`${avatarColor(user.full_name)} text-white font-black text-xl`}>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#0a0a14] ${isSuspended ? "bg-red-500" : "bg-emerald-500"}`} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-black text-white text-lg leading-tight truncate">{user.full_name || "Anonymous User"}</p>
              </div>

              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-white/50 truncate font-mono">{user.email}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(user.email, "email")}
                  className="text-white/30 hover:text-white transition-colors p-0.5"
                  title="Copy Email"
                >
                  {copiedField === "email" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>

              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${roleColor}`}>{roleLabel}</span>
                {isSuspended && (
                  <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border bg-red-500/20 text-red-400 border-red-500/30">
                    Suspended
                  </span>
                )}
                <span className="text-[10px] text-white/35 font-medium">Joined {new Date(user.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons Row */}
          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-white/5 flex-wrap">
            <Button
              size="sm"
              onClick={() => {
                setShowCommCard(prev => !prev || activeCommTab !== "sms");
                setActiveCommTab("sms");
              }}
              className={`h-8 px-3 text-xs gap-1.5 rounded-xl font-bold transition-all shadow-md ${
                showCommCard && activeCommTab === "sms"
                  ? "bg-cyan-500 text-black shadow-cyan-500/25" 
                  : "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/25"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Send SMS
            </Button>

            <Button
              size="sm"
              onClick={() => {
                setShowCommCard(prev => !prev || activeCommTab !== "push");
                setActiveCommTab("push");
              }}
              className={`h-8 px-3 text-xs gap-1.5 rounded-xl font-bold transition-all shadow-md ${
                showCommCard && activeCommTab === "push"
                  ? "bg-purple-500 text-white shadow-purple-500/25" 
                  : "bg-purple-500/15 text-purple-400 border border-purple-500/30 hover:bg-purple-500/25"
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              Web Push
              {pushSubscriptionCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
              )}
            </Button>

            <Button
              size="sm"
              onClick={handleSendResetLink}
              disabled={resetLinkSending}
              className="h-8 px-3 text-xs gap-1.5 rounded-xl font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all shadow-md"
            >
              {resetLinkSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
              Reset Link
            </Button>

            <Button
              size="sm"
              onClick={handleRevokeSessions}
              disabled={revokingSessions}
              className="h-8 px-3 text-xs gap-1.5 rounded-xl font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 transition-all shadow-md"
            >
              {revokingSessions ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              Revoke Sessions
            </Button>

            <Button
              size="sm"
              onClick={handleSuspend}
              disabled={suspending}
              className={`h-8 px-3 text-xs gap-1.5 rounded-xl border font-bold transition-all ${
                isSuspended
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
              }`}
            >
              {suspending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
              {isSuspended ? "Unsuspend" : "Suspend"}
            </Button>

            {!user.agent_approved && (
              <Button
                size="sm"
                onClick={handlePromoteAgent}
                disabled={promoting}
                className="h-8 px-3 text-xs gap-1.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 font-bold transition-all"
              >
                {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {user.is_agent ? "Approve Agent" : "Make Agent"}
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyToClipboard(user.user_id, "id")}
              className="h-8 px-2.5 text-[11px] text-white/40 hover:text-white rounded-xl gap-1.5 ml-auto border border-white/5"
            >
              {copiedField === "id" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>ID</span>
            </Button>
          </div>
        </div>

        {/* ── Phone Number Bar / Add Phone Banner ── */}
        <div className="px-6 pt-4">
          {user.phone ? (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Phone className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Contact Phone</p>
                  <p className="text-xs font-mono font-bold text-white tracking-wide">{user.phone}</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => copyToClipboard(user.phone!, "phone")}
                  className="p-1.5 text-white/40 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                  title="Copy Phone"
                >
                  {copiedField === "phone" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPhone(true);
                    setPhoneInput(user.phone || "");
                  }}
                  className="p-1.5 text-white/40 hover:text-cyan-400 rounded-lg hover:bg-white/5 transition-colors"
                  title="Edit Phone Number"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>No phone number on file</span>
                </div>
                {!editingPhone && (
                  <button
                    type="button"
                    onClick={() => setEditingPhone(true)}
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300 underline underline-offset-2"
                  >
                    + Add Phone
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Inline Phone Edit Form */}
          {editingPhone && (
            <div className="mt-2 p-3 rounded-2xl bg-white/[0.04] border border-cyan-500/30 space-y-2.5 animate-in fade-in-50 duration-200">
              <p className="text-[11px] font-bold text-cyan-400 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" />
                {user.phone ? "Update Phone Number" : "Attach Phone Number to Profile"}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="e.g. 0244123456 or 233244123456"
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50"
                />
                <Button
                  size="sm"
                  onClick={handleSavePhone}
                  disabled={savingPhone}
                  className="h-8 bg-cyan-500 hover:bg-cyan-600 text-black font-extrabold text-xs rounded-xl px-3 gap-1"
                >
                  {savingPhone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingPhone(false)}
                  disabled={savingPhone}
                  className="h-8 text-white/40 hover:text-white text-xs rounded-xl px-2"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── System Security Flags ── */}
        {flags.length > 0 && (
          <div className="px-6 pt-3 space-y-2">
            {flags.map((flag, i) => (
              <div
                key={i}
                className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-2xl border text-xs ${
                  flag.type === "danger"
                    ? "bg-red-500/10 border-red-500/25 text-red-400"
                    : "bg-amber-500/10 border-amber-500/25 text-amber-400"
                }`}
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">{flag.label}</p>
                  {flag.sub && <p className="text-[10px] opacity-70 mt-0.5 font-mono">{flag.sub}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── COMMUNICATIONS CONSOLE (SMS & WEB PUSH) ── */}
        <div className="px-6 pt-4">
          <div className={`rounded-2xl border transition-all overflow-hidden ${
            showCommCard 
              ? activeCommTab === "sms"
                ? "bg-gradient-to-b from-cyan-950/20 to-black/60 border-cyan-500/30 shadow-xl shadow-cyan-950/30"
                : "bg-gradient-to-b from-purple-950/20 to-black/60 border-purple-500/30 shadow-xl shadow-purple-950/30"
              : "bg-white/[0.02] border-white/5 hover:border-white/10"
          }`}>
            <button
              type="button"
              onClick={() => setShowCommCard(prev => !prev)}
              className="w-full p-4 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shadow-sm ${
                  activeCommTab === "sms"
                    ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-400"
                    : "bg-purple-500/15 border-purple-500/30 text-purple-400"
                }`}>
                  {activeCommTab === "sms" ? <Send className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-black uppercase tracking-wider text-white">Direct Dispatch Center</p>
                    <span className="flex items-center gap-1 text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Live Gateways
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40 mt-0.5">Send immediate SMS or Browser Web Push alerts</p>
                </div>
              </div>
              <div className="text-white/40 hover:text-white p-1">
                {showCommCard ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {showCommCard && (
              <div className="p-4 pt-0 space-y-3.5 border-t border-white/5 animate-in fade-in-50 duration-200">
                {/* Mode Selector Tabs */}
                <div className="flex p-1 bg-black/60 border border-white/5 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActiveCommTab("sms")}
                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                      activeCommTab === "sms"
                        ? "bg-cyan-500 text-black shadow-sm"
                        : "text-white/40 hover:text-white"
                    }`}
                  >
                    <Phone className="w-3 h-3" /> Direct SMS
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCommTab("push")}
                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                      activeCommTab === "push"
                        ? "bg-purple-500 text-white shadow-sm"
                        : "text-white/40 hover:text-white"
                    }`}
                  >
                    <Bell className="w-3 h-3" /> Web Push Notification
                  </button>
                </div>

                {/* ─── TAB 1: DIRECT SMS ─── */}
                {activeCommTab === "sms" && (
                  <div className="space-y-3">
                    {/* Recipient Phone Selector */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 flex items-center justify-between">
                        <span>Recipient Mobile Number</span>
                        {smsPhone !== user.phone && user.phone && (
                          <button
                            type="button"
                            onClick={() => setSmsPhone(user.phone || "")}
                            className="text-cyan-400 hover:underline text-[9px] normal-case"
                          >
                            Reset to profile ({user.phone})
                          </button>
                        )}
                      </label>
                      <div className="relative">
                        <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                        <input
                          type="tel"
                          value={smsPhone}
                          onChange={(e) => setSmsPhone(e.target.value)}
                          placeholder="e.g. 0244123456 or 233244123456"
                          className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50"
                        />
                      </div>
                    </div>

                    {/* Quick Templates */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Quick Templates</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {SMS_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.label}
                            type="button"
                            onClick={() => applySmsTemplate(tpl.text)}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-cyan-500/20 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/30 transition-all text-white/70"
                          >
                            {tpl.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Message Body Input */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">SMS Body</label>
                        <span className="text-[10px] font-mono text-white/40">
                          {charCount} chars · {smsSegments} SMS page{smsSegments > 1 ? "s" : ""}
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        value={smsMessage}
                        onChange={(e) => setSmsMessage(e.target.value)}
                        placeholder="Type customized SMS message here..."
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors leading-relaxed resize-none"
                      />
                    </div>

                    {/* Send Button */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="text-[10px] text-white/30 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        <span>Sender ID: <b>SwiftData</b></span>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSendDirectSms}
                        disabled={smsSending || !smsMessage.trim()}
                        className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-black text-xs rounded-xl px-5 h-9 gap-2 shadow-lg shadow-cyan-500/20"
                      >
                        {smsSending ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Dispatching...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Send SMS</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* ─── TAB 2: WEB PUSH NOTIFICATION ─── */}
                {activeCommTab === "push" && (
                  <div className="space-y-3 animate-in fade-in-50 duration-200">
                    {/* Device Push Status Banner */}
                    <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <Radio className="w-3.5 h-3.5 text-purple-400" />
                        <span className="font-bold text-white/80">Device Status</span>
                      </div>
                      {pushSubscriptionCount > 0 ? (
                        <span className="text-[10px] font-extrabold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {pushSubscriptionCount} Registered Device{pushSubscriptionCount > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                          Browser push offline (Will deliver to in-app bell inbox)
                        </span>
                      )}
                    </div>

                    {/* Quick Push Templates */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Push Templates</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {PUSH_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.label}
                            type="button"
                            onClick={() => applyPushTemplate(tpl.title, tpl.text)}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-purple-500/20 hover:text-purple-300 border border-white/10 hover:border-purple-500/30 transition-all text-white/70"
                          >
                            {tpl.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Push Title & Action URL */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Notification Title</label>
                        <input
                          type="text"
                          value={pushTitle}
                          onChange={(e) => setPushTitle(e.target.value)}
                          placeholder="Notification Title"
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Target Link / URL</label>
                        <input
                          type="text"
                          value={pushUrl}
                          onChange={(e) => setPushUrl(e.target.value)}
                          placeholder="/dashboard"
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-purple-500/50"
                        />
                      </div>
                    </div>

                    {/* Push Message Body */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Push Message Body</label>
                      <textarea
                        rows={3}
                        value={pushBody}
                        onChange={(e) => setPushBody(e.target.value)}
                        placeholder="Enter message text that will pop up on the user's screen/browser..."
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 transition-colors leading-relaxed resize-none"
                      />
                    </div>

                    {/* Send Button */}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[10px] text-white/40">
                        ⚡ Instant OS popup banner & in-app bell notification
                      </p>
                      <Button
                        size="sm"
                        onClick={handleSendWebPush}
                        disabled={pushSending || !pushBody.trim()}
                        className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-black text-xs rounded-xl px-5 h-9 gap-2 shadow-lg shadow-purple-500/20"
                      >
                        {pushSending ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Broadcasting...</span>
                          </>
                        ) : (
                          <>
                            <Bell className="w-3.5 h-3.5" />
                            <span>Send Web Push</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Recent Dispatches History */}
                {dispatchHistory.length > 0 && (
                  <div className="pt-2 border-t border-white/5 space-y-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Recent Dispatches (This Session)</p>
                    <div className="space-y-1">
                      {dispatchHistory.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[10px] px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/5">
                          <span className="text-white/60 truncate max-w-[70%] font-mono">
                            <b className={item.channel === "sms" ? "text-cyan-400" : "text-purple-400"}>[{item.channel.toUpperCase()}]</b> {item.text}
                          </span>
                          <span className={`font-bold flex items-center gap-1 ${item.status === "sent" ? "text-emerald-400" : "text-red-400"}`}>
                            {item.status === "sent" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {item.time}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Admin Private Notes ── */}
        <div className="px-6 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Admin Notes
            </p>
            {adminNotes !== (user.admin_notes || "") && (
              <button 
                onClick={handleSaveNotes} 
                disabled={savingNotes}
                className="text-[10px] font-black text-amber-400 hover:text-amber-300 disabled:opacity-50 flex items-center gap-1"
              >
                {savingNotes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save Changes
              </button>
            )}
          </div>
          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Private notes about this user (only visible to admins)..."
            className="w-full min-h-[75px] bg-white/[0.02] border border-white/10 rounded-2xl p-3 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition-colors resize-none"
          />
        </div>

        {/* ── Financial & Metrics Matrix ── */}
        <div className="px-6 pt-4 space-y-3">
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { icon: Wallet, label: "Main Wallet", value: loading ? "…" : `GH₵ ${(data?.walletBalance ?? 0).toFixed(2)}`, color: "text-cyan-400", border: "border-cyan-500/20 bg-cyan-500/5" },
              { icon: ShieldCheck, label: "API Wallet", value: loading ? "…" : `GH₵ ${(data?.apiBalance ?? 0).toFixed(2)}`, color: "text-emerald-400", border: "border-emerald-500/20 bg-emerald-500/5" },
              { icon: ShoppingCart, label: "Total Sales", value: loading ? "…" : `GH₵ ${(data?.totalSalesVolume ?? 0).toFixed(2)}`, color: "text-blue-400", border: "border-blue-500/20 bg-blue-500/5" },
            ].map(({ icon: Icon, label, value, color, border }) => (
              <div key={label} className={`rounded-2xl border p-3 text-center transition-all ${border}`}>
                <Icon className={`w-4 h-4 mx-auto mb-1.5 ${color}`} />
                <p className={`text-xs sm:text-sm font-black tracking-tight ${color}`}>{value}</p>
                <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {[
              { icon: TrendingUp, label: "Direct Profit", value: loading ? "…" : `GH₵ ${(data?.totalOwnProfit ?? 0).toFixed(2)}`, color: "text-emerald-400", border: "border-emerald-500/10 bg-white/[0.02]" },
              { icon: Users2, label: "Sub Comms", value: loading ? "…" : `GH₵ ${(data?.totalCommissionsPaid ?? 0).toFixed(2)}`, color: "text-purple-400", border: "border-purple-500/10 bg-white/[0.02]" },
              { icon: Hash, label: "Total Logins", value: String(user.login_count ?? 0), color: "text-amber-400", border: "border-amber-500/10 bg-white/[0.02]" },
            ].map(({ icon: Icon, label, value, color, border }) => (
              <div key={label} className={`rounded-2xl border p-3 text-center transition-all ${border}`}>
                <Icon className={`w-4 h-4 mx-auto mb-1.5 ${color}`} />
                <p className={`text-xs sm:text-sm font-black ${color}`}>{value}</p>
                <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Manage Wallet Widget ── */}
        <div className="px-6 pt-5">
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" /> Manage User Wallet
              </p>
              <span className="text-[10px] text-white/40 font-mono">
                Current: <b className="text-white">GH₵ {(walletType === "main" ? (data?.walletBalance ?? 0) : (data?.apiBalance ?? 0)).toFixed(2)}</b>
              </span>
            </div>

            {/* Wallet Toggle Pill */}
            <div className="flex gap-1.5 p-1 bg-black/60 border border-white/5 rounded-xl">
              <button
                type="button"
                onClick={() => setWalletType("main")}
                className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  walletType === "main" ? "bg-cyan-500 text-black shadow-sm" : "text-white/40 hover:text-white"
                }`}
              >
                Main Wallet
              </button>
              <button
                type="button"
                onClick={() => setWalletType("api")}
                className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  walletType === "api" ? "bg-emerald-500 text-black shadow-sm" : "text-white/40 hover:text-white"
                }`}
              >
                API Wallet
              </button>
            </div>

            {/* Preset Amount Chips */}
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setTopupAmount(String(amt))}
                  className="text-[10px] font-extrabold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-white/70 hover:text-white transition-all"
                >
                  +GH₵{amt}
                </button>
              ))}
            </div>

            {/* Input & Actions */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-xs font-bold font-mono">GH₵</span>
                <input 
                  type="number"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-4 py-2 text-sm text-white font-bold focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <Button
                size="sm"
                onClick={() => handleManualTopup(false)}
                disabled={topupLoading || !topupAmount}
                className="bg-emerald-500 hover:bg-emerald-600 text-black font-extrabold rounded-xl px-4 h-9 gap-1.5 shadow-lg shadow-emerald-500/10"
              >
                {topupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                <span>Add</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleManualTopup(true)}
                disabled={topupLoading || !topupAmount}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-xl px-4 h-9 gap-1.5 font-extrabold"
              >
                {topupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Minus className="w-3.5 h-3.5" />}
                <span>Deduct</span>
              </Button>
            </div>
            <p className="text-[10px] text-white/30 italic px-0.5">
              * Customers automatically receive an SMS confirmation upon wallet credit.
            </p>
          </div>
        </div>

        {/* ── Security & Authentication ── */}
        <div className="px-6 pt-5">
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-4 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Security & Account Credentials
            </p>
            <p className="text-[11px] text-white/40 leading-relaxed">
              If the user loses their authenticator app, phone, or gets locked out, you can safely reset their MFA security or trigger a password reset.
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                variant="outline"
                onClick={handleResetMfa}
                disabled={mfaLoading}
                className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 rounded-xl h-9 text-xs font-bold gap-2"
              >
                {mfaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Reset MFA/2FA
              </Button>
              <Button
                variant="outline"
                onClick={handleResetPassword}
                disabled={pwLoading}
                className="border-white/10 text-white/80 hover:bg-white/5 rounded-xl h-9 text-xs font-bold gap-2"
              >
                {pwLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                Reset Password
              </Button>
            </div>
          </div>
        </div>

        {/* ── Profile & Network Details ── */}
        <div className="px-6 pt-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-white/35 mb-2.5">Profile Metadata</p>
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 divide-y divide-white/5 text-xs">
            {[
              { icon: Phone, label: "Phone", value: user.phone || "No phone on file", copy: user.phone },
              { icon: Radio, label: "Web Push", value: pushSubscriptionCount > 0 ? `${pushSubscriptionCount} Registered Device(s)` : "Not Subscribed" },
              { icon: Globe, label: "Last IP", value: user.last_ip || "Never logged in", mono: true, flag: data && data.sharedIpAccounts.length > 0 },
              { icon: Globe, label: "Location", value: user.last_location || "Unknown", mono: false },
              { icon: Clock, label: "Last Seen", value: user.last_seen_at ? new Date(user.last_seen_at).toLocaleString() : "Never" },
              { icon: Gift, label: "Referral Code", value: user.referral_code || "None", mono: true, copy: user.referral_code || undefined },
              { icon: User, label: "Referred By", value: data?.referrerName || (user.referred_by ? "Loading…" : "Direct Signup") },
              { icon: user.is_sub_agent ? Users2 : ShieldCheck, label: "Parent Agent", value: user.parent_name || "None (Independent)" },
            ].map(({ icon: Icon, label, value, mono, flag, copy }) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5 gap-3">
                <div className="flex items-center gap-2 text-white/40 shrink-0">
                  <Icon className="w-3.5 h-3.5" />
                  <span className="uppercase tracking-wider text-[10px] font-bold">{label}</span>
                </div>
                <div className="flex items-center gap-1.5 max-w-[60%] justify-end">
                  <span className={`truncate ${mono ? "font-mono" : ""} ${flag ? "text-red-400" : "text-white/80"}`}>
                    {value}
                  </span>
                  {flag && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />}
                  {copy && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(copy, label)}
                      className="p-1 text-white/30 hover:text-white rounded"
                    >
                      {copiedField === label ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Recent Orders ── */}
        <div className="px-6 pt-5 pb-12">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/35">Recent Orders (Last 15)</p>
            {data && data.orders.length > 0 && (
              <span className="text-[10px] text-white/40 font-mono">{data.orders.length} order(s)</span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          ) : !data || data.orders.length === 0 ? (
            <div className="rounded-2xl bg-white/[0.01] border border-white/5 p-8 text-center">
              <ShoppingCart className="w-8 h-8 text-white/10 mx-auto mb-2" />
              <p className="text-xs text-white/30 font-medium">No order activity recorded yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.orders.map((order) => {
                const phoneStatus = isBeneficiaryFailure(order) && order.customer_phone
                  ? beneficiaryStatus[order.customer_phone]
                  : undefined;
                const override = phoneStatus ? BENEFICIARY_STATUS_BADGE[phoneStatus] : undefined;
                const style = override?.className || STATUS_STYLES[order.status] || "text-white/40 bg-white/5 border-white/10";
                const label = override?.label || order.status.replace(/_/g, " ");

                return (
                  <div key={order.id} className="rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 p-3 flex items-center gap-3 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {order.network && order.package_size
                          ? `${order.network} ${order.package_size}`
                          : order.order_type.replace(/_/g, " ")}
                      </p>
                      <p className="text-[10px] text-white/40 font-mono truncate mt-0.5">
                        {order.customer_phone || order.id.slice(0, 8)}
                        {" · "}
                        {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-black text-white">GH₵{Number(order.amount).toFixed(2)}</p>
                      {Number(order.profit || 0) > 0 && (
                        <p className="text-[10px] font-extrabold text-emerald-400">+GH₵{Number(order.profit).toFixed(2)}</p>
                      )}
                      {Number(order.parent_profit || 0) > 0 && (
                        <p className="text-[9px] font-bold text-purple-400">+GH₵{Number(order.parent_profit || 0).toFixed(2)} comm</p>
                      )}
                    </div>

                    <span className={`flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 ${style}`}>
                      {override ? <Clock className="w-3 h-3" /> : <StatusIcon status={order.status} />}
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default UserDetailDrawer;
