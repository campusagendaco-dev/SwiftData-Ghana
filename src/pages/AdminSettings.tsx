import { useEffect, useState } from "react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, AlertCircle, Phone, MessageSquare, Percent, MessageCircle, Gift, Sparkles, Video, Upload, Trash2, Trash, Loader2, Loader, Globe, Database, Plus, ExternalLink, Activity, Shield, GraduationCap, RefreshCw, Wifi, Users, TrendingUp, Wallet } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";

interface SystemSettings {
  auto_api_switch: boolean;
  preferred_provider: "hubtel" | "paystack" | "flutterwave";
  backup_provider: "hubtel" | "paystack" | "flutterwave";
  holiday_mode_enabled: boolean;
  holiday_message: string;
  disable_ordering: boolean;
  dark_mode_enabled: boolean;
  store_visitor_popup_enabled: boolean;
  welcome_promo_enabled: boolean;
  customer_service_number: string;
  support_channel_link: string;
  sub_agent_base_fee: string;
  txtconnect_api_key: string;
  txtconnect_sender_id: string;
  paystack_secret_key: string;
  hubtel_client_id: string;
  hubtel_client_secret: string;
  mtn_markup_percentage: string;
  telecel_markup_percentage: string;
  at_markup_percentage: string;
  auto_pending_sms_enabled: boolean;
  auto_pending_sms_message: string;
  payment_success_sms_message: string;
  wallet_topup_sms_message: string;
  withdrawal_request_sms_message: string;
  withdrawal_completed_sms_message: string;
  order_failed_sms_message: string;
  manual_credit_sms_message: string;
  data_provider_api_key: string;
  data_provider_base_url: string;
  airtime_provider_api_key: string;
  airtime_provider_base_url: string;
  secondary_data_provider_api_key: string;
  secondary_data_provider_base_url: string;
  auto_failover_enabled: boolean;
  show_announcement: boolean;
  announcement_title: string;
  announcement_message: string;
  free_data_enabled: boolean;
  free_data_network: string;
  free_data_package_size: string;
  free_data_max_claims: string;
  whatsapp_bot_prompt: string;
  home_page_video_url: string;
  home_page_video_muted: boolean;
  agent_activation_fee: string;
  show_scrolling_ad: boolean;
  scrolling_ad_text: string;
  wassce_price: string;
  bece_price: string;
  wassce_cost_price: string;
  bece_cost_price: string;
  traditional_background_enabled: boolean;
  background_custom_image_url: string;
  enable_privacy_shield: boolean;
  tutorial_buy_video_url?: string;
  tutorial_agent_video_url?: string;
  tutorial_subagent_video_url?: string;
  withdrawal_auto_approve_enabled: boolean;
  withdrawal_auto_approve_max_amount: string;
  withdrawal_auto_approve_min_age_days: string;
  withdrawal_auto_approve_require_no_chargebacks: boolean;
  min_withdrawal_amount: string;
  max_withdrawal_amount: string;
  withdrawal_system_enabled: boolean;
  notification_tone: string;
  notification_vibration_enabled: boolean;
  notification_vibration_pattern: string;
  vendor_min_transaction: string;
}

const AdminSettings = () => {
  const { toast } = useToast();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringWallets, setRestoringWallets] = useState(false);
  const [settings, setSettings] = useState<SystemSettings>({
    auto_api_switch: false,
    preferred_provider: "paystack",
    backup_provider: "hubtel",
    holiday_mode_enabled: false,
    holiday_message: "",
    disable_ordering: false,
    dark_mode_enabled: false,
    store_visitor_popup_enabled: false,
    welcome_promo_enabled: true,
    customer_service_number: "",
    support_channel_link: "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
    sub_agent_base_fee: "5.00",
    txtconnect_api_key: "",
    txtconnect_sender_id: "",
    paystack_secret_key: "",
    hubtel_client_id: "",
    hubtel_client_secret: "",
    mtn_markup_percentage: "0",
    telecel_markup_percentage: "0",
    at_markup_percentage: "0",
    auto_pending_sms_enabled: false,
    auto_pending_sms_message: "Your SwiftData transaction is pending. Please try again or contact support.",
    payment_success_sms_message: "Your data bundle is being processed. Join for more giveaways & updates: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
    wallet_topup_sms_message: "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}. Join: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
    withdrawal_request_sms_message: "Withdrawal request of GHS {amount} received. It will be processed shortly.",
    withdrawal_completed_sms_message: "Your withdrawal of GHS {amount} has been completed. Join: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
    order_failed_sms_message: "Order for {package} to {phone} failed. GHS {amount} has been refunded to your wallet.",
    manual_credit_sms_message: "Your account has been manually credited with GHS {amount}. Join: https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
    data_provider_api_key: "",
    data_provider_base_url: "",
    airtime_provider_api_key: "",
    airtime_provider_base_url: "",
    secondary_data_provider_api_key: "",
    secondary_data_provider_base_url: "",
    auto_failover_enabled: false,
    show_announcement: false,
    announcement_title: "Welcome to SwiftPoints!",
    announcement_message: "You now earn rewards for every purchase. 100 points = GHS 1.00 cash back!",
    free_data_enabled: false,
    free_data_network: "MTN",
    free_data_package_size: "1GB",
    free_data_max_claims: "100",
    whatsapp_bot_prompt: "",
    home_page_video_url: "",
    home_page_video_muted: true,
    agent_activation_fee: "50.00",
    show_scrolling_ad: false,
    scrolling_ad_text: "",
    wassce_price: "18.00",
    bece_price: "15.00",
    wassce_cost_price: "17.00",
    bece_cost_price: "14.00",
    traditional_background_enabled: true,
    background_custom_image_url: "",
    enable_privacy_shield: true,
    withdrawal_auto_approve_enabled: false,
    withdrawal_auto_approve_max_amount: "200.00",
    withdrawal_auto_approve_min_age_days: "7",
    withdrawal_auto_approve_require_no_chargebacks: true,
    min_withdrawal_amount: "25.00",
    max_withdrawal_amount: "5000.00",
    withdrawal_system_enabled: true,
    tutorial_buy_video_url: "",
    tutorial_agent_video_url: "",
    tutorial_subagent_video_url: "",
    notification_tone: "/sounds/notification_system.mp3",
    notification_vibration_enabled: true,
    notification_vibration_pattern: "200,100,200",
    vendor_min_transaction: "1.00",
  });

  const [currentIp, setCurrentIp] = useState("");
  const [allowedIps, setAllowedIps] = useState<string[]>([]);

  useEffect(() => {
    fetch("https://api.ipify.org?format=json")
      .then(r => r.json())
      .then(d => setCurrentIp(d.ip))
      .catch(e => console.error("IP fetch failed:", e));

    if (session?.user.id) {
      supabase
        .from("user_roles")
        .select("allowed_ips")
        .eq("user_id", session.user.id)
        .eq("role", "admin")
        .maybeSingle()
        .then(({ data }) => {
          if (data?.allowed_ips) setAllowedIps(data.allowed_ips);
        });
    }
  }, [session?.user.id]);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (error) {
        toast({ title: "Error loading settings", description: error.message, variant: "destructive" });
      } else if (data) {
        const d = data as any;
        setSettings({
          auto_api_switch: d.auto_api_switch || false,
          preferred_provider: (d.preferred_provider as any) || "paystack",
          backup_provider: (d.backup_provider as any) || "hubtel",
          holiday_mode_enabled: d.holiday_mode_enabled || false,
          holiday_message: d.holiday_message || "",
          disable_ordering: d.disable_ordering || false,
          dark_mode_enabled: d.dark_mode_enabled || false,
          store_visitor_popup_enabled: d.store_visitor_popup_enabled || false,
          welcome_promo_enabled: d.welcome_promo_enabled !== false,
          customer_service_number: d.customer_service_number || "",
          support_channel_link: d.support_channel_link || "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
          sub_agent_base_fee: String(d.sub_agent_base_fee || "5.00"),
          txtconnect_api_key: String(d.txtconnect_api_key || ""),
          txtconnect_sender_id: String(d.txtconnect_sender_id || ""),
          paystack_secret_key: String(d.paystack_secret_key || ""),
          hubtel_client_id: String(d.hubtel_client_id || ""),
          hubtel_client_secret: String(d.hubtel_client_secret || ""),
          mtn_markup_percentage: String(d.mtn_markup_percentage || "0"),
          telecel_markup_percentage: String(d.telecel_markup_percentage || "0"),
          at_markup_percentage: String(d.at_markup_percentage || "0"),
          auto_pending_sms_enabled: d.auto_pending_sms_enabled || false,
          auto_pending_sms_message: d.auto_pending_sms_message || "Your SwiftData transaction is pending. Please try again or contact support.",
          payment_success_sms_message: d.payment_success_sms_message || "Your data bundle is being processed. Thanks for choosing SwiftData GH",
          wallet_topup_sms_message: d.wallet_topup_sms_message || "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.",
          withdrawal_request_sms_message: d.withdrawal_request_sms_message || "Withdrawal request of GHS {amount} received. It will be processed shortly.",
          withdrawal_completed_sms_message: d.withdrawal_completed_sms_message || "Your withdrawal of GHS {amount} has been completed. Thanks for using SwiftData.",
          order_failed_sms_message: d.order_failed_sms_message || "Order for {package} to {phone} failed. GHS {amount} has been refunded to your wallet.",
          manual_credit_sms_message: d.manual_credit_sms_message || "Your account has been manually credited with GHS {amount} by admin.",
          data_provider_api_key: String(d.data_provider_api_key || ""),
          data_provider_base_url: String(d.data_provider_base_url || ""),
          airtime_provider_api_key: String(d.airtime_provider_api_key || ""),
          airtime_provider_base_url: String(d.airtime_provider_base_url || ""),
          secondary_data_provider_api_key: String(d.secondary_data_provider_api_key || ""),
          secondary_data_provider_base_url: String(d.secondary_data_provider_base_url || ""),
          auto_failover_enabled: d.auto_failover_enabled || false,
          show_announcement: d.show_announcement || false,
          announcement_title: d.announcement_title || "Welcome to SwiftPoints!",
          announcement_message: d.announcement_message || "You now earn rewards for every purchase. 100 points = GHS 1.00 cash back!",
          free_data_enabled: d.free_data_enabled || false,
          free_data_network: d.free_data_network || "MTN",
          free_data_package_size: d.free_data_package_size || "1GB",
          free_data_max_claims: String(d.free_data_max_claims || "100"),
          whatsapp_bot_prompt: d.whatsapp_bot_prompt || "",
          home_page_video_url: d.home_page_video_url || "/assets/videos/ai_video.mp4",
          home_page_video_muted: d.home_page_video_muted !== false, // default true
          agent_activation_fee: String(d.agent_activation_fee || "50.00"),
          wassce_price: String(d.wassce_price || "18.00"),
          bece_price: String(d.bece_price || "15.00"),
          wassce_cost_price: String(d.wassce_cost_price || "17.00"),
          bece_cost_price: String(d.bece_cost_price || "14.00"),
          traditional_background_enabled: d.traditional_background_enabled !== false,
          background_custom_image_url: String(d.background_custom_image_url || ""),
          enable_privacy_shield: d.enable_privacy_shield !== false,
          tutorial_buy_video_url: String(d.tutorial_buy_video_url || ""),
          tutorial_agent_video_url: String(d.tutorial_agent_video_url || ""),
          tutorial_subagent_video_url: String(d.tutorial_subagent_video_url || ""),
          withdrawal_auto_approve_enabled: d.withdrawal_auto_approve_enabled || false,
          withdrawal_auto_approve_max_amount: String(d.withdrawal_auto_approve_max_amount || "200.00"),
          withdrawal_auto_approve_min_age_days: String(d.withdrawal_auto_approve_min_age_days || "7"),
          withdrawal_auto_approve_require_no_chargebacks: d.withdrawal_auto_approve_require_no_chargebacks !== false,
          min_withdrawal_amount: String(d.min_withdrawal_amount || "25.00"),
          max_withdrawal_amount: String(d.max_withdrawal_amount || "5000.00"),
          withdrawal_system_enabled: d.withdrawal_system_enabled !== false,
          notification_tone: d.notification_tone || "/sounds/notification_system.mp3",
          notification_vibration_enabled: d.notification_vibration_enabled !== false,
          notification_vibration_pattern: d.notification_vibration_pattern || "200,100,200",
          vendor_min_transaction: String(d.vendor_min_transaction || "1.00"),
        });
      }
      setLoading(false);
    };

    fetchSettings();
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    
    const payload = {
      ...settings,
      customer_service_number: settings.customer_service_number.trim(),
      support_channel_link: settings.support_channel_link.trim(),
      sub_agent_base_fee: parseFloat(settings.sub_agent_base_fee) || 5.0,
      txtconnect_api_key: settings.txtconnect_api_key.trim(),
      txtconnect_sender_id: settings.txtconnect_sender_id.trim(),
      paystack_secret_key: settings.paystack_secret_key.trim(),
      hubtel_client_id: settings.hubtel_client_id.trim(),
      hubtel_client_secret: settings.hubtel_client_secret.trim(),
      mtn_markup_percentage: parseFloat(settings.mtn_markup_percentage) || 0,
      telecel_markup_percentage: parseFloat(settings.telecel_markup_percentage) || 0,
      at_markup_percentage: parseFloat(settings.at_markup_percentage) || 0,
      data_provider_api_key: (settings.data_provider_api_key || "").trim(),
      data_provider_base_url: (settings.data_provider_base_url || "").trim(),
      airtime_provider_api_key: (settings.airtime_provider_api_key || "").trim(),
      airtime_provider_base_url: (settings.airtime_provider_base_url || "").trim(),
      secondary_data_provider_api_key: (settings.secondary_data_provider_api_key || "").trim(),
      secondary_data_provider_base_url: (settings.secondary_data_provider_base_url || "").trim(),
      auto_failover_enabled: settings.auto_failover_enabled,
      welcome_promo_enabled: settings.welcome_promo_enabled,
      show_announcement: settings.show_announcement,
      announcement_title: settings.announcement_title.trim(),
      announcement_message: settings.announcement_message.trim(),
      free_data_enabled: settings.free_data_enabled,
      free_data_network: settings.free_data_network,
      free_data_package_size: settings.free_data_package_size,
      free_data_max_claims: parseInt(settings.free_data_max_claims) || 100,
      whatsapp_bot_prompt: settings.whatsapp_bot_prompt.trim(),
      home_page_video_url: (settings.home_page_video_url || "").trim(),
      home_page_video_muted: settings.home_page_video_muted,
      agent_activation_fee: parseFloat(settings.agent_activation_fee) || 50.00,
      wassce_price: parseFloat(settings.wassce_price) || 18.00,
      bece_price: parseFloat(settings.bece_price) || 15.00,
      wassce_cost_price: parseFloat(settings.wassce_cost_price) || 17.00,
      bece_cost_price: parseFloat(settings.bece_cost_price) || 14.00,
      traditional_background_enabled: settings.traditional_background_enabled,
      background_custom_image_url: settings.background_custom_image_url,
      enable_privacy_shield: settings.enable_privacy_shield,
      tutorial_buy_video_url: (settings.tutorial_buy_video_url || "").trim(),
      tutorial_agent_video_url: (settings.tutorial_agent_video_url || "").trim(),
      tutorial_subagent_video_url: (settings.tutorial_subagent_video_url || "").trim(),
      withdrawal_auto_approve_enabled: settings.withdrawal_auto_approve_enabled,
      withdrawal_auto_approve_max_amount: parseFloat(settings.withdrawal_auto_approve_max_amount) || 200,
      withdrawal_auto_approve_min_age_days: parseInt(settings.withdrawal_auto_approve_min_age_days) || 7,
      withdrawal_auto_approve_require_no_chargebacks: settings.withdrawal_auto_approve_require_no_chargebacks,
      min_withdrawal_amount: parseFloat(settings.min_withdrawal_amount) || 25,
      max_withdrawal_amount: parseFloat(settings.max_withdrawal_amount) || 5000,
      withdrawal_system_enabled: settings.withdrawal_system_enabled,
      notification_tone: settings.notification_tone,
      notification_vibration_enabled: settings.notification_vibration_enabled,
      notification_vibration_pattern: settings.notification_vibration_pattern,
      vendor_min_transaction: parseFloat(settings.vendor_min_transaction) || 1.00,
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/system-payout-v1?t=${Date.now()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': SUPABASE_PUBLISHABLE_KEY
        },
        body: JSON.stringify({ action: "update_system_settings", settings: payload })
      });

      const data = await response.json();
      const error = !response.ok ? data : null;

      if (error || data?.error) {
        const errorMsg = data?.error || error?.message || "Unknown error";
        console.error("Save error details:", { error, data });
        
        const normalized = errorMsg.toLowerCase();
        if ((normalized.includes("insufficient") || normalized.includes("low")) && normalized.includes("balance")) {
          toast({ 
            title: "Insufficient Provider Balance", 
            description: "The platform's provider balance is currently low. Please top up your provider wallet to ensure orders process successfully.", 
            variant: "destructive" 
          });
        } else if (errorMsg.includes("column") || errorMsg.includes("non-2xx")) {
          toast({ 
            title: "🚀 Database Sync Required", 
            description: "The new configuration settings require a schema update. Please run 'npx supabase db push' to apply these changes.", 
            variant: "destructive" 
          });
        } else {
          toast({ 
            title: "⚠️ Save Interrupted", 
            description: `We couldn't save your changes: ${errorMsg}`, 
            variant: "destructive" 
          });
        }
      } else {
        toast({ 
          title: "✨ Settings Locked In",
          description: "Your system configuration has been updated successfully."
        });
        if (data?.skipped?.length > 0) {
          console.warn("Some settings were skipped by the server:", data.skipped);
        }
        
        // Log the audit action
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          await logAudit(currentUser.id, "update_system_settings", {
            updated_fields: Object.keys(payload).filter(k => (payload as any)[k] !== ""),
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const [providers, setProviders] = useState<any[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);

  const fetchProviders = async () => {
    setLoadingProviders(true);
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .order("priority", { ascending: true });
    
    if (error) {
      console.error("Error fetching providers:", error);
    } else {
      setProviders(data || []);
    }
    setLoadingProviders(false);
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleAddProvider = () => {
    setProviders([...providers, { id: "new-" + Date.now(), name: "New Provider", is_active: true, priority: providers.length + 1, provider_type: "data", settings: {} }]);
  };

  const handleUpdateProvider = (id: string, updates: any) => {
    setProviders(providers.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleSaveProviders = async () => {
    setSaving(true);
    try {
      // Process all providers to handle new vs existing correctly
      const toUpsert = providers.map(p => {
        // Strip out calculated fields
        const { created_at, updated_at, balance, last_synced_at, ...item } = p;
        
        // Handle new items that have temporary IDs
        if (typeof item.id === 'string' && item.id.startsWith("new-")) {
          const { id, ...newItem } = item;
          return newItem;
        }
        return item;
      });

      // Divide into batches for safer processing
      const existing = toUpsert.filter(p => !!p.id);
      const newItems = toUpsert.filter(p => !p.id);

      // 1. Update existing providers by ID (safer than name)
      if (existing.length > 0) {
        const { error } = await supabase.from("providers").upsert(existing, { onConflict: 'id' });
        if (error) throw error;
      }
      
      // 2. Insert new providers (use name for conflict resolution if they already exist)
      if (newItems.length > 0) {
        const { error } = await supabase.from("providers").upsert(newItems, { onConflict: 'name' });
        if (error) throw error;
      }

      toast({ title: "Providers Updated", description: "Network routing logic synchronized successfully." });
      fetchProviders();
    } catch (err: any) {
      console.error("Save error:", err);
      toast({ 
        title: "Conflict Detected", 
        description: err.message || "A provider with this name may already exist.", 
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">System Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure global platform behavior.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save All Changes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Core Settings */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Platform State</CardTitle>
              <CardDescription>Control access and ordering capabilities.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <Label>Dark Mode Default</Label>
                  <p className="text-xs text-muted-foreground">Enable dark mode as the default theme.</p>
                </div>
                <Switch
                  checked={settings.dark_mode_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, dark_mode_enabled: c })}
                />
              </div>

              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <Label>Agent Store Visitor Popup</Label>
                  <p className="text-xs text-muted-foreground">Show a "Get your own store" popup to first-time store visitors.</p>
                </div>
                <Switch
                  checked={settings.store_visitor_popup_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, store_visitor_popup_enabled: c })}
                />
              </div>

              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <Label>Welcome Promo Modal</Label>
                  <p className="text-xs text-muted-foreground">Show "100% discount" modal to first-time buyers.</p>
                </div>
                <Switch
                  checked={settings.welcome_promo_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, welcome_promo_enabled: c })}
                />
              </div>

              <div className="flex items-start justify-between p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-500" />
                    Secure Privacy Shield
                  </Label>
                  <p className="text-xs text-muted-foreground">Disables right-click, blurs screen when minimized, and blocks printing.</p>
                </div>
                <Switch
                  checked={settings.enable_privacy_shield}
                  onCheckedChange={(c) => setSettings({ ...settings, enable_privacy_shield: c })}
                />
              </div>

              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <Label className="text-red-500">Disable All Ordering</Label>
                  <p className="text-xs text-muted-foreground">Stop users from placing any new orders.</p>
                </div>
                <Switch
                  checked={settings.disable_ordering}
                  onCheckedChange={(c) => setSettings({ ...settings, disable_ordering: c })}
                  className="data-[state=checked]:bg-red-500"
                />
              </div>

              {settings.disable_ordering && (
                <div className="relative group overflow-hidden rounded-2xl border border-red-500/20 bg-red-500/10 p-4 transition-all hover:bg-red-500/15">
                  <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/20 flex items-center justify-center">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-red-400">Ordering is Disabled</p>
                      <p className="text-xs text-red-500/60 mt-0.5">
                        Your platform is currently in lock-down. Users will see a maintenance message at checkout.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contact & Support</CardTitle>
              <CardDescription>Update the contact information shown to users.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cs-number" className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" /> Customer Service Number
                </Label>
                <Input
                  id="cs-number"
                  placeholder="e.g. 0540309637"
                  value={settings.customer_service_number}
                  onChange={(e) => setSettings({ ...settings, customer_service_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-link" className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-muted-foreground" /> Support Channel Link (WhatsApp)
                </Label>
                <Input
                  id="support-link"
                  placeholder="https://whatsapp.com/channel/..."
                  value={settings.support_channel_link}
                  onChange={(e) => setSettings({ ...settings, support_channel_link: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  The floating WhatsApp button and Footer will link here.
                </p>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                Reseller Activation
              </CardTitle>
              <CardDescription>
                Set the fee for users to become agents/resellers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Agent Activation Fee (GH₵)</Label>
                <Input
                  type="number"
                  step="1"
                  value={settings.agent_activation_fee}
                  onChange={(e) => setSettings({ ...settings, agent_activation_fee: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Users pay this amount once to unlock the agent dashboard and agent prices.
                </p>
              </div>

              <div className="pt-4 border-t border-white/5 space-y-2">
                <Label className="flex items-center gap-2">
                  <Percent className="w-4 h-4 text-amber-500" />
                  Sub-Agent Commission Base (GH₵)
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  value={settings.sub_agent_base_fee}
                  onChange={(e) => setSettings({ ...settings, sub_agent_base_fee: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  When a sub-agent activates, this amount is deducted from the parent agent.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Network Markups (Profit Margins)</CardTitle>
              <CardDescription>Automatically add a percentage markup to specific networks before selling to users.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>MTN (%)</Label>
                  <Input type="number" step="0.5" value={settings.mtn_markup_percentage} onChange={(e) => setSettings({ ...settings, mtn_markup_percentage: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Telecel (%)</Label>
                  <Input type="number" step="0.5" value={settings.telecel_markup_percentage} onChange={(e) => setSettings({ ...settings, telecel_markup_percentage: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>AT (%)</Label>
                  <Input type="number" step="0.5" value={settings.at_markup_percentage} onChange={(e) => setSettings({ ...settings, at_markup_percentage: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-primary" />
                Result Checker Pricing
              </CardTitle>
              <CardDescription>Configure retail prices for customers and base cost price for profit calculation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-4 p-4 bg-muted/30 border border-border rounded-2xl shadow-sm transition-all hover:border-primary/30">
                  <Label className="text-sm font-black text-foreground flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary" /> WASSCE
                  </Label>
                  <div className="space-y-2">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-widest">Retail Price (GH₵)</Label>
                    <Input type="number" step="0.1" value={settings.wassce_price} onChange={(e) => setSettings({ ...settings, wassce_price: e.target.value })} className="font-bold" />
                  </div>
                  <div className="space-y-2 border-t border-border/50 pt-2">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1"><Shield className="w-3 h-3" /> Cost Price (GH₵)</Label>
                    <Input type="number" step="0.1" value={settings.wassce_cost_price} onChange={(e) => setSettings({ ...settings, wassce_cost_price: e.target.value })} className="font-mono text-xs opacity-80" />
                  </div>
                  <div className="flex justify-between items-center pt-1 text-[10px]">
                    <span className="text-muted-foreground">Estimated Margin:</span>
                    <span className="font-black text-emerald-500">₵{(parseFloat(settings.wassce_price || "0") - parseFloat(settings.wassce_cost_price || "0")).toFixed(2)}</span>
                  </div>
                </div>

                <div className="space-y-4 p-4 bg-muted/30 border border-border rounded-2xl shadow-sm transition-all hover:border-amber-500/30">
                  <Label className="text-sm font-black text-foreground flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" /> BECE
                  </Label>
                  <div className="space-y-2">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-widest">Retail Price (GH₵)</Label>
                    <Input type="number" step="0.1" value={settings.bece_price} onChange={(e) => setSettings({ ...settings, bece_price: e.target.value })} className="font-bold" />
                  </div>
                  <div className="space-y-2 border-t border-border/50 pt-2">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1"><Shield className="w-3 h-3" /> Cost Price (GH₵)</Label>
                    <Input type="number" step="0.1" value={settings.bece_cost_price} onChange={(e) => setSettings({ ...settings, bece_cost_price: e.target.value })} className="font-mono text-xs opacity-80" />
                  </div>
                  <div className="flex justify-between items-center pt-1 text-[10px]">
                    <span className="text-muted-foreground">Estimated Margin:</span>
                    <span className="font-black text-emerald-500">₵{(parseFloat(settings.bece_price || "0") - parseFloat(settings.bece_cost_price || "0")).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Global Site Background
              </CardTitle>
              <CardDescription>Control the beautiful drifting Ghanaian traditional background system.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="space-y-0.5">
                  <Label className="text-sm font-bold">Drifting Ghanaian Symbols</Label>
                  <p className="text-xs text-muted-foreground">Toggle floating animated symbols on dark/light themes.</p>
                </div>
                <Switch
                  checked={settings.traditional_background_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, traditional_background_enabled: c })}
                />
              </div>

              <div className="space-y-3 pt-2 border-t border-white/5">
                <Label className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Choose Background Preset
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { id: "traditional", label: "Ghana Drifting (Default)", url: "" },
                    { id: "slideshow", label: "🔄 Auto Slideshow", url: "/auto_switch" },
                    { id: "mb1", label: "Cyan & Gold V1", url: "/assets/backgrounds/bg_motherboard_1.png" },
                    { id: "mb2", label: "Elegant Gold/White", url: "/assets/backgrounds/bg_motherboard_2.png" },
                    { id: "mb3", label: "Neon Cyberpunk", url: "/assets/backgrounds/bg_motherboard_3.png" },
                    { id: "mb4", label: "Blueprint Schematic", url: "/assets/backgrounds/bg_motherboard_4.png" },
                    { id: "mb5", label: "Cyan & Gold V2", url: "/assets/backgrounds/bg_motherboard_5.png" },
                    { id: "mb6", label: "Ghana-Circuit Fusion", url: "/assets/backgrounds/bg_motherboard_adinkra.png" },
                    { id: "cult1", label: "Luxury Kente Cloth", url: "/assets/backgrounds/bg_ghana_kente.png" },
                    { id: "cult2", label: "Gold Embossed Adinkra", url: "/assets/backgrounds/bg_ghana_gold_adinkra.png" },
                    { id: "cult3", label: "Ghanaian Warm Earth", url: "/assets/backgrounds/bg_ghana_warm_earth.png" },
                    { id: "cult4", label: "3D Gold Adinkra", url: "/assets/backgrounds/bg_ghana_3d.png" },
                    { id: "rec1", label: "Abstract Data Flow", url: "/assets/backgrounds/bg_data_flow.png" },
                    { id: "rec2", label: "Frosted Mesh Gradient", url: "/assets/backgrounds/bg_mesh_gradient.png" },
                    { id: "rec3", label: "Premium Gold Ribbons", url: "/assets/backgrounds/bg_gold_ribbons.png" },
                  ].map((preset) => {
                    const isSelected = settings.background_custom_image_url === preset.url;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSettings({ ...settings, background_custom_image_url: preset.url })}
                        className={`relative rounded-xl overflow-hidden aspect-video bg-black/40 border-2 transition-all text-left group flex flex-col justify-end p-2 ${
                          isSelected ? "border-primary ring-2 ring-primary/20 ring-offset-2 ring-offset-black" : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        {preset.url && preset.url !== "/auto_switch" ? (
                          <img 
                            src={preset.url} 
                            alt={preset.label}
                            className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-70 transition-opacity"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 to-purple-900/20 flex items-center justify-center">
                            {preset.url === "/auto_switch" ? (
                              <RefreshCw className="w-5 h-5 text-indigo-400 opacity-60 animate-spin" style={{ animationDuration: '3s' }} />
                            ) : (
                              <Sparkles className="w-6 h-6 text-amber-500 opacity-40" />
                            )}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                        <span className="relative text-[9px] font-black text-white tracking-wide uppercase leading-tight truncate w-full">
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-white/5">
                <Label className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  Custom Image URL / Preview (Overrides Symbols)
                </Label>

                {settings.background_custom_image_url && (
                  <div className="relative rounded-xl overflow-hidden border border-white/10 aspect-video sm:aspect-[21/9] bg-black/20 group">
                    {settings.background_custom_image_url === "/auto_switch" ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-purple-950/40 border border-indigo-500/20">
                        <div className="relative flex items-center justify-center w-12 h-12 rounded-full bg-indigo-500/10 mb-2">
                          <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" style={{ animationDuration: '5s' }} />
                          <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-amber-400 animate-pulse" />
                        </div>
                        <h4 className="text-white font-black text-xs tracking-widest uppercase">Live Slideshow Active</h4>
                        <p className="text-indigo-300/40 text-[10px] mt-0.5 max-w-xs text-center px-4 font-medium">
                          Cycling all 12 premium background styles seamlessly every 15s.
                        </p>
                      </div>
                    ) : (
                      <img 
                        src={settings.background_custom_image_url} 
                        className="w-full h-full object-cover opacity-80" 
                        alt="Background preview"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        className="gap-2"
                        onClick={() => setSettings({ ...settings, background_custom_image_url: "" })}
                      >
                        <Trash2 className="w-4 h-4" /> Remove Custom Background
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="Paste image URL..."
                    value={settings.background_custom_image_url}
                    onChange={(e) => setSettings({ ...settings, background_custom_image_url: e.target.value })}
                    className="flex-1"
                  />
                  <div className="relative shrink-0">
                    <Input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      id="bg-image-upload"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        if (file.size > 5 * 1024 * 1024) { // 5MB limit
                          toast({ title: "File too large", description: "Images should be under 5MB for optimal loading speed.", variant: "destructive" });
                          return;
                        }

                        const { data: { user } } = await supabase.auth.getUser();
                        if (!user) return;

                        setSaving(true);
                        try {
                          const ext = file.name.split('.').pop();
                          const fileName = `site-bg-${Date.now()}.${ext}`;
                          
                          const { error } = await supabase.storage
                            .from('site-assets')
                            .upload(fileName, file);

                          if (error) throw error;

                          const { data: { publicUrl } } = supabase.storage
                            .from('site-assets')
                            .getPublicUrl(fileName);

                          setSettings({ ...settings, background_custom_image_url: publicUrl });
                          toast({ title: "Image uploaded", description: "Preview applied. Remember to save all changes below." });
                        } catch (err: any) {
                          toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                        } finally {
                          setSaving(false);
                        }
                      }}
                    />
                    <Button 
                      variant="secondary" 
                      onClick={() => document.getElementById('bg-image-upload')?.click()}
                      disabled={saving}
                      className="gap-2 w-full"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      Upload Image
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste a link or upload directly. Providing an image will load a solid fixed background instead of drifting symbols.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Video className="w-5 h-5 text-amber-500" />
                Home Page Background Video
              </CardTitle>
              <CardDescription>
                Upload or change the video that appears on the landing page hero section.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                {settings.home_page_video_url && (
                  <div className="relative rounded-xl overflow-hidden border border-white/10 aspect-video bg-black/20">
                    <video 
                      src={settings.home_page_video_url} 
                      className="w-full h-full object-cover"
                      muted={settings.home_page_video_muted}
                      autoPlay
                      loop
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        className="gap-2"
                        onClick={() => setSettings({ ...settings, home_page_video_url: "" })}
                      >
                        <Trash2 className="w-4 h-4" /> Remove Video
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold">Mute Video by Default</Label>
                    <p className="text-xs text-muted-foreground">If disabled, the video will attempt to play with sound for all users.</p>
                  </div>
                  <Switch
                    checked={settings.home_page_video_muted}
                    onCheckedChange={(c) => setSettings({ ...settings, home_page_video_muted: c })}
                  />
                </div>
                
                <div className="flex flex-col gap-3">
                  <Label>Video URL (MP4)</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={settings.home_page_video_url} 
                      onChange={(e) => setSettings({ ...settings, home_page_video_url: e.target.value })}
                      placeholder="https://...mp4 or /assets/..."
                    />
                    <div className="relative">
                      <Input
                        type="file"
                        accept="video/mp4"
                        className="hidden"
                        id="video-upload"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          if (file.size > 20 * 1024 * 1024) { // 20MB limit
                            toast({ title: "File too large", description: "Video must be under 20MB.", variant: "destructive" });
                            return;
                          }

                          const { data: { user } } = await supabase.auth.getUser();
                          if (!user) return;

                          setSaving(true);
                          try {
                            const fileName = `home-bg-${Date.now()}.mp4`;
                            const { data, error } = await supabase.storage
                              .from('site-assets')
                              .upload(fileName, file);

                            if (error) throw error;

                            const { data: { publicUrl } } = supabase.storage
                              .from('site-assets')
                              .getPublicUrl(fileName);

                            setSettings({ ...settings, home_page_video_url: publicUrl });
                            toast({ title: "Video uploaded", description: "Remember to save all changes." });
                          } catch (err: any) {
                            toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                          } finally {
                            setSaving(false);
                          }
                        }}
                      />
                      <Button 
                        variant="secondary" 
                        onClick={() => document.getElementById('video-upload')?.click()}
                        disabled={saving}
                        className="gap-2"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        Upload
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Recommended: MP4, 1080p+, under 10MB for fast loading.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Video className="w-5 h-5 text-amber-500" />
                Welcome Guide Tutorial Videos
              </CardTitle>
              <CardDescription>
                Customize the walkthrough videos linked inside the Welcome Guide Modal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-amber-500" />
                  "Buy Data" Video URL
                </Label>
                <Input 
                  value={settings.tutorial_buy_video_url} 
                  onChange={(e) => setSettings({ ...settings, tutorial_buy_video_url: e.target.value })}
                  placeholder="e.g. YouTube embed link or MP4 URL"
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Appears when a user selects "Buy a data bundle" in the tutorial.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  "Become Agent" Video URL
                </Label>
                <Input 
                  value={settings.tutorial_agent_video_url} 
                  onChange={(e) => setSettings({ ...settings, tutorial_agent_video_url: e.target.value })}
                  placeholder="e.g. YouTube embed link or MP4 URL"
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Appears when a user selects "Become a data agent" in the tutorial.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-500" />
                  "Become Sub Agent" Video URL
                </Label>
                <Input 
                  value={settings.tutorial_subagent_video_url} 
                  onChange={(e) => setSettings({ ...settings, tutorial_subagent_video_url: e.target.value })}
                  placeholder="e.g. YouTube embed link or MP4 URL"
                />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Appears when a user selects "Become a sub-agent" in the tutorial.
                </p>
              </div>

              <Alert className="bg-muted/30 border-border">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-xs leading-relaxed">
                  You can paste standard YouTube links (e.g., <code>https://youtube.com/watch?v=...</code>), embed iframe links, or direct MP4 paths. The system will automatically format them correctly for the tutorial window.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
 
        {/* Withdrawal & Payout Management */}
        <div className="space-y-6">
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-amber-500" />
                Withdrawal & Payout Management
              </CardTitle>
              <CardDescription>Configure how agents withdraw their profits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="space-y-0.5">
                  <Label className="text-sm font-bold">Withdrawal System Status</Label>
                  <p className="text-xs text-muted-foreground">If disabled, agents cannot place new withdrawal requests.</p>
                </div>
                <Switch
                  checked={settings.withdrawal_system_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, withdrawal_system_enabled: c })}
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Min Withdrawal (GHS)</Label>
                  <Input
                    type="number"
                    value={settings.min_withdrawal_amount}
                    onChange={(e) => setSettings({ ...settings, min_withdrawal_amount: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Withdrawal (GHS)</Label>
                  <Input
                    type="number"
                    value={settings.max_withdrawal_amount}
                    onChange={(e) => setSettings({ ...settings, max_withdrawal_amount: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold">Auto-Approve Withdrawals</Label>
                    <p className="text-xs text-muted-foreground">Automatically mark small requests as processing.</p>
                  </div>
                  <Switch
                    checked={settings.withdrawal_auto_approve_enabled}
                    onCheckedChange={(c) => setSettings({ ...settings, withdrawal_auto_approve_enabled: c })}
                  />
                </div>

                {settings.withdrawal_auto_approve_enabled && (
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-2">
                      <Label>Max Auto Amount (GHS)</Label>
                      <Input
                        type="number"
                        value={settings.withdrawal_auto_approve_max_amount}
                        onChange={(e) => setSettings({ ...settings, withdrawal_auto_approve_max_amount: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Min Account Age (Days)</Label>
                      <Input
                        type="number"
                        value={settings.withdrawal_auto_approve_min_age_days}
                        onChange={(e) => setSettings({ ...settings, withdrawal_auto_approve_min_age_days: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold">Require Clean Record</Label>
                    <p className="text-xs text-muted-foreground">Block auto-approval if agent has recent failed orders.</p>
                  </div>
                  <Switch
                    checked={settings.withdrawal_auto_approve_require_no_chargebacks}
                    onCheckedChange={(c) => setSettings({ ...settings, withdrawal_auto_approve_require_no_chargebacks: c })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-500" />
                Swift Vendor Terminal Settings
              </CardTitle>
              <CardDescription>
                Configure the terminal minimum limits and understand transaction fee splits.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Minimum Transaction Amount (GHS)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={settings.vendor_min_transaction}
                  onChange={(e) => setSettings({ ...settings, vendor_min_transaction: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum transaction amount enforced for Cash-In, Cash-Out, and Bank Transfers. Recommended: ≥ 1.00 GHS.
                </p>
              </div>

              <div className="pt-4 border-t border-white/10 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Strategic Fee & Profit Splits</h4>
                
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 space-y-1">
                    <p className="font-bold text-white flex justify-between">
                      <span>💰 MoMo Cash-In (Disbursement)</span>
                      <span className="text-emerald-500">60% Agent / 40% Swift</span>
                    </p>
                    <p className="leading-relaxed">
                      Gateway cost: GHS 1.00 flat. Customer fees are tiered: <b>GHS 1.50</b> for ≤ 50 GHS, <b>1.0%</b> for 51-1000 GHS, and <b>GHS 10.00 flat</b> for &gt; 1000 GHS.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 space-y-1">
                    <p className="font-bold text-white flex justify-between">
                      <span>💸 MoMo Cash-Out (Collection)</span>
                      <span className="text-emerald-500">70% Agent / 30% Swift</span>
                    </p>
                    <p className="leading-relaxed">
                      Gateway cost: 0.7%. Customer fee: <b>1.0%</b> capped at GHS 20.00.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 space-y-1">
                    <p className="font-bold text-white flex justify-between">
                      <span>🏦 Ghana Bank Transfer</span>
                      <span className="text-emerald-500">50% Agent / 50% Swift</span>
                    </p>
                    <p className="leading-relaxed">
                      Gateway cost: GHS 8.00 flat. Customer fees: <b>GHS 12.00</b> for ≤ 500 GHS, <b>GHS 15.00</b> for 501-2000 GHS, and <b>GHS 20.00 flat</b> for &gt; 2000 GHS.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 space-y-1">
                    <p className="font-bold text-white flex justify-between">
                      <span>🌍 Pan-African Transfer</span>
                      <span className="text-emerald-500">0.75% Agent / 0.75% Swift</span>
                    </p>
                    <p className="leading-relaxed">
                      Gateway cost: 2.0%. Customer fee: <b>3.5% flat</b>.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-sky-500/20 bg-sky-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-sky-500" />
                Notification Sounds & Vibration Alerts
              </CardTitle>
              <CardDescription>
                Configure premium audio signals and haptic vibration feedback for push notifications.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  Notification Alert Tone
                </Label>
                <div className="flex gap-2">
                  <select
                    value={settings.notification_tone}
                    onChange={(e) => setSettings({ ...settings, notification_tone: e.target.value })}
                    className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="/sounds/notification_system.mp3">🔔 Modern System Chime (Default)</option>
                    <option value="/sounds/success.mp3">💰 Crisp Digital Chime (Cha-Ching)</option>
                    <option value="/sounds/glass_ting.mp3">🔔 Gentle Glass Ting</option>
                    <option value="/sounds/marimba_chime.mp3">🎵 Playful Marimba Chime</option>
                    <option value="/sounds/laser_drop.mp3">⚡ Cyberpunk Laser Drop</option>
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      try {
                        const audio = new Audio(settings.notification_tone);
                        audio.volume = 0.5;
                        audio.play().catch(() => {
                          toast({ title: "Autoplay Blocked", description: "Please tap the screen first to allow audio.", variant: "destructive" });
                        });
                      } catch (err: any) {
                        toast({ title: "Failed to play tone", description: err.message, variant: "destructive" });
                      }
                    }}
                    className="rounded-xl border border-input bg-background/50"
                  >
                    Test Sound
                  </Button>
                </div>
              </div>

              <div className="space-y-3 pt-3 border-t border-white/10">
                <Label className="flex items-center gap-2">
                  Upload Custom Tone (MP3)
                </Label>
                <div className="relative">
                  <Input
                    type="file"
                    accept="audio/mp3,audio/mpeg"
                    className="hidden"
                    id="tone-upload"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      if (file.size > 2 * 1024 * 1024) { // 2MB limit
                        toast({ title: "File too large", description: "Audio files must be under 2MB.", variant: "destructive" });
                        return;
                      }

                      setSaving(true);
                      try {
                        const ext = file.name.split('.').pop();
                        const fileName = `custom-tone-${Date.now()}.${ext}`;

                        const { error } = await supabase.storage
                          .from('site-assets')
                          .upload(fileName, file);

                        if (error) throw error;

                        const { data: { publicUrl } } = supabase.storage
                          .from('site-assets')
                          .getPublicUrl(fileName);

                        setSettings({ ...settings, notification_tone: publicUrl });
                        toast({ title: "Custom tone uploaded", description: "Remember to save all changes below." });
                      } catch (err: any) {
                        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                      } finally {
                        setSaving(false);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById('tone-upload')?.click()}
                    disabled={saving}
                    className="gap-2 w-full rounded-xl border border-input bg-background/50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    Upload Custom Tone
                  </Button>
                </div>
                {settings.notification_tone.startsWith("http") && (
                  <p className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    ✓ Custom Tone Active: {settings.notification_tone.split("/").pop()}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 pt-3 mt-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-bold">Tactile Mobile Vibration</Label>
                  <p className="text-xs text-muted-foreground">Trigger physical haptic vibration on incoming notifications.</p>
                </div>
                <Switch
                  checked={settings.notification_vibration_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, notification_vibration_enabled: c })}
                />
              </div>

              {settings.notification_vibration_enabled && (
                <div className="space-y-2 pt-3 border-t border-white/5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <Label>Vibration Pattern</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. 200,100,200"
                      value={settings.notification_vibration_pattern}
                      onChange={(e) => setSettings({ ...settings, notification_vibration_pattern: e.target.value })}
                      className="rounded-xl flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.vibrate) {
                          try {
                            const patternStr = String(settings.notification_vibration_pattern || "");
                            const pattern = patternStr
                              .split(",")
                              .map(Number)
                              .filter((num) => !isNaN(num) && num >= 0);

                            if (pattern.length > 0) {
                              navigator.vibrate(pattern);
                              toast({ title: "Tactile Haptics Dispatched", description: "Your physical device is now vibrating." });
                            } else {
                              toast({ title: "Invalid Pattern", description: "Comma-separated milliseconds list (e.g. 200,100,200)", variant: "destructive" });
                            }
                          } catch (err: any) {
                            toast({ title: "Vibration Blocked", description: err.message, variant: "destructive" });
                          }
                        } else {
                          toast({ title: "Haptics Not Supported", description: "Device vibration requires a physical mobile browser.", variant: "destructive" });
                        }
                      }}
                      className="rounded-xl border border-input bg-background/50"
                    >
                      Test Pattern
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Define vibration length in milliseconds, separated by commas. Example: <code>200,100,200</code> vibrates for 200ms, rests 100ms, then vibrates 200ms.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Messaging & Announcements */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Holiday Mode Announcement
              </CardTitle>
              <CardDescription>Display a prominent banner across the site.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Enable Holiday Banner</Label>
                <Switch
                  checked={settings.holiday_mode_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, holiday_mode_enabled: c })}
                />
              </div>

              {settings.holiday_mode_enabled && (
                <div className="space-y-2 pt-2">
                  <Label>Banner Message</Label>
                  <Textarea
                    placeholder="e.g. Happy Holidays! Delivery might be delayed."
                    value={settings.holiday_message}
                    onChange={(e) => setSettings({ ...settings, holiday_message: e.target.value })}
                    className="min-h-[100px]"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Gift className="w-5 h-5 text-emerald-500" />
                Free Data Campaign
              </CardTitle>
              <CardDescription>Give away free data bundles to your users.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Enable Free Data Campaign</Label>
                <Switch
                  checked={settings.free_data_enabled}
                  onCheckedChange={(c) => setSettings({ ...settings, free_data_enabled: c })}
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>

              {settings.free_data_enabled && (
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Target Network</Label>
                      <select 
                        value={settings.free_data_network}
                        onChange={(e) => setSettings({ ...settings, free_data_network: e.target.value })}
                        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="MTN">MTN</option>
                        <option value="Telecel">Telecel</option>
                        <option value="AirtelTigo">AirtelTigo</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Package Size</Label>
                      <Input
                        value={settings.free_data_package_size}
                        onChange={(e) => setSettings({ ...settings, free_data_package_size: e.target.value })}
                        placeholder="e.g. 1GB"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Max Claims Allowed</Label>
                    <Input
                      type="number"
                      value={settings.free_data_max_claims}
                      onChange={(e) => setSettings({ ...settings, free_data_max_claims: e.target.value })}
                      placeholder="e.g. 100"
                    />
                  </div>
                  <Alert className="bg-emerald-500/10 border-emerald-500/20">
                    <Gift className="h-4 w-4 text-emerald-500" />
                    <AlertDescription className="text-xs text-emerald-500/80">
                      Users will see a floating "Free Data" button. They must enter a valid free-data promo code to claim.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-indigo-500/20 bg-indigo-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-500" />
                Welcome Announcement (Popup)
              </CardTitle>
              <CardDescription>Inform all users about new features like SwiftPoints.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Show Popup to Users</Label>
                <Switch
                  checked={settings.show_announcement}
                  onCheckedChange={(c) => setSettings({ ...settings, show_announcement: c })}
                  className="data-[state=checked]:bg-indigo-500"
                />
              </div>

              {settings.show_announcement && (
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Announcement Title</Label>
                    <Input
                      value={settings.announcement_title}
                      onChange={(e) => setSettings({ ...settings, announcement_title: e.target.value })}
                      placeholder="e.g. Big News!"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Message Content</Label>
                    <Textarea
                      value={settings.announcement_message}
                      onChange={(e) => setSettings({ ...settings, announcement_message: e.target.value })}
                      placeholder="Explain the new feature..."
                      className="min-h-[100px]"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-indigo-500/20 bg-indigo-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-500" />
                WhatsApp Bot AI Prompt
              </CardTitle>
              <CardDescription>Train your AI sales assistant by editing its system prompt.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>System Prompt Instructions</Label>
                <Textarea
                  value={settings.whatsapp_bot_prompt}
                  onChange={(e) => setSettings({ ...settings, whatsapp_bot_prompt: e.target.value })}
                  placeholder="e.g. You are the SwiftData Pro Assistant. Be very polite and use emojis..."
                  className="min-h-[250px] font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Leave this empty to use the default hardcoded prompt. You can use <code>{"{{storeName}}"}</code> as a variable.
                </p>
              </div>
            </CardContent>
          </Card>


          <Card>
            <CardHeader>
              <CardTitle className="text-lg">SMS Configuration (TxtConnect)</CardTitle>
              <CardDescription>
                Enter your TxtConnect credentials to enable SMS notifications. Get these from{" "}
                <a href="https://txtconnect.net/" target="_blank" rel="noopener noreferrer" className="underline text-amber-500 hover:text-amber-400">txtconnect.net</a>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="txtconnect-key">API Key</Label>
                  <Input
                    id="txtconnect-key"
                    type="password"
                    value={settings.txtconnect_api_key}
                    onChange={(e) => setSettings((prev) => ({ ...prev, txtconnect_api_key: e.target.value }))}
                    placeholder="Your TxtConnect API Key"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="txtconnect-sender">Sender ID</Label>
                  <Input
                    id="txtconnect-sender"
                    value={settings.txtconnect_sender_id}
                    onChange={(e) => setSettings((prev) => ({ ...prev, txtconnect_sender_id: e.target.value }))}
                    placeholder="Approved Sender ID (e.g. SwiftData)"
                    maxLength={11}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Must be an approved alphanumeric Sender ID (max 11 chars).</p>
                </div>
              </div>

              {settings.txtconnect_api_key && settings.txtconnect_sender_id && (
                <>
                  <Alert className="bg-green-50 text-green-900 border-green-200 mt-4 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20">
                    <AlertCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <AlertDescription className="text-xs font-medium">
                      TxtConnect credentials configured — SMS sending is enabled.
                    </AlertDescription>
                  </Alert>

                  <div className="pt-4 border-t border-border mt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Auto-SMS for Pending Orders</Label>
                        <p className="text-xs text-muted-foreground">Automatically send SMS every 30 mins to new pending orders.</p>
                      </div>
                      <Switch
                        checked={settings.auto_pending_sms_enabled}
                        onCheckedChange={(c) => setSettings({ ...settings, auto_pending_sms_enabled: c })}
                      />
                    </div>
                    {settings.auto_pending_sms_enabled && (
                      <div className="space-y-2">
                        <Label>Auto-SMS Message (Pending)</Label>
                        <Input
                          value={settings.auto_pending_sms_message}
                          onChange={(e) => setSettings({ ...settings, auto_pending_sms_message: e.target.value })}
                          placeholder="Your transaction is pending..."
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Payment Success SMS Message</Label>
                      <Input
                        value={settings.payment_success_sms_message}
                        onChange={(e) => setSettings({ ...settings, payment_success_sms_message: e.target.value })}
                        placeholder="Your bundle is being processed..."
                      />
                      <p className="text-[10px] text-muted-foreground">Sent immediately after a successful payment is verified.</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Wallet Top-up SMS Message</Label>
                      <Input
                        value={settings.wallet_topup_sms_message}
                        onChange={(e) => setSettings({ ...settings, wallet_topup_sms_message: e.target.value })}
                      />
                      <p className="text-[10px] text-muted-foreground">Available variables: {"{amount}, {balance}"}</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Withdrawal Request SMS Message</Label>
                      <Input
                        value={settings.withdrawal_request_sms_message}
                        onChange={(e) => setSettings({ ...settings, withdrawal_request_sms_message: e.target.value })}
                      />
                      <p className="text-[10px] text-muted-foreground">Available variables: {"{amount}"}</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Withdrawal Completed SMS Message</Label>
                      <Input
                        value={settings.withdrawal_completed_sms_message}
                        onChange={(e) => setSettings({ ...settings, withdrawal_completed_sms_message: e.target.value })}
                      />
                      <p className="text-[10px] text-muted-foreground">Available variables: {"{amount}"}</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Order Failed SMS Message</Label>
                      <Input
                        value={settings.order_failed_sms_message}
                        onChange={(e) => setSettings({ ...settings, order_failed_sms_message: e.target.value })}
                      />
                      <p className="text-[10px] text-muted-foreground">Available variables: {"{package}, {phone}, {amount}"}</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Manual Credit SMS Message</Label>
                      <Input
                        value={settings.manual_credit_sms_message}
                        onChange={(e) => setSettings({ ...settings, manual_credit_sms_message: e.target.value })}
                      />
                      <p className="text-[10px] text-muted-foreground">Available variables: {"{amount}"}</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* New Multi-Provider Manager */}
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="w-5 h-5 text-amber-500" />
                  Provider Smart Routing
                </CardTitle>
                <CardDescription>Manage multiple data/airtime providers and set priorities.</CardDescription>
              </div>
              <Button size="sm" onClick={handleAddProvider} className="h-8 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px]">
                Add Provider
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingProviders ? (
                 <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
              ) : providers.length === 0 ? (
                 <div className="text-center p-8 border-2 border-dashed border-border rounded-2xl">
                    <p className="text-xs text-muted-foreground">No active providers configured.</p>
                 </div>
              ) : (
                <div className="space-y-3">
                  {providers.map((provider) => (
                    <div key={provider.id} className="p-4 rounded-xl bg-muted/30 border border-border space-y-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <Label className="text-[10px] text-muted-foreground">Priority</Label>
                            <Input 
                              type="number"
                              value={provider.priority} 
                              onChange={(e) => handleUpdateProvider(provider.id, { priority: parseInt(e.target.value) || 1 })}
                              className="h-7 w-12 bg-background border-border text-[10px] p-1 text-center font-bold"
                            />
                          </div>
                          <Input 
                            value={provider.name || ""} 
                            onChange={(e) => handleUpdateProvider(provider.id, { name: e.target.value })}
                            className="h-8 w-48 bg-transparent border-none font-black text-sm focus:ring-0 text-foreground"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-8 rounded-lg bg-amber-500/10 border-amber-500/20 text-amber-500 hover:bg-amber-500/20 font-bold text-[10px] gap-2"
                            onClick={async () => {
                              if (provider.id.startsWith("new-")) {
                                toast({ 
                                  title: "Save Required", 
                                  description: "Please save the provider before attempting to sync data.", 
                                  variant: "destructive" 
                                });
                                return;
                              }
                              try {
                                const { data, error } = await supabase.functions.invoke("sync-provider-data", {
                                  body: { provider_id: provider.id },
                                });
                                
                                if (error) {
                                  const errorBody = await error.context?.json();
                                  throw new Error(errorBody?.error || error.message);
                                }

                                if (data && data.success === false) {
                                  throw new Error(data.error || "Unknown sync error");
                                }
                                
                                toast({ 
                                  title: "Sync Successful", 
                                  description: `Synced ${data.packages_synced} packages and balance GHS ${data.balance.toFixed(2)}.` 
                                });
                                fetchProviders();
                              } catch (err: any) {
                                toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
                              }
                            }}
                          >
                            <Database className="w-3 h-3" />
                            Sync Data
                          </Button>
                          <Switch 
                            checked={provider.is_active} 
                            onCheckedChange={(c) => handleUpdateProvider(provider.id, { is_active: c })}
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">API Key / Secret</Label>
                          <Input 
                            type="password" 
                            value={provider.api_key || ""} 
                            onChange={(e) => handleUpdateProvider(provider.id, { api_key: e.target.value })}
                            className="h-8 bg-background border-border text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">API Base URL</Label>
                          <Input 
                            value={provider.base_url || ""} 
                            onChange={(e) => handleUpdateProvider(provider.id, { base_url: e.target.value })}
                            placeholder="https://api.provider.com"
                            className="h-8 bg-background border-border text-xs"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Type</Label>
                          <select 
                            value={provider.provider_type || "data"} 
                            onChange={(e) => handleUpdateProvider(provider.id, { provider_type: e.target.value })}
                            className="w-full h-8 bg-background border border-border text-foreground rounded-md px-2 text-xs focus:outline-none"
                          >
                            <option value="data">Data Bundles</option>
                            <option value="airtime">Airtime</option>
                            <option value="utility">Utility</option>
                            <option value="sms">SMS</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">API Logic (Handler)</Label>
                          <select 
                            value={provider.handler_type || "standard"} 
                            onChange={(e) => handleUpdateProvider(provider.id, { handler_type: e.target.value })}
                            className="w-full h-8 bg-background border border-border text-foreground rounded-md px-2 text-xs focus:outline-none"
                          >
                            <option value="standard">Standard</option>
                            <option value="datamart">DataMart GH</option>
                            <option value="datahub">DataHub Ghana</option>
                            <option value="bossu">Bossu Data Hub</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Webhook Secret (Optional)</Label>
                          <Input 
                            type="password"
                            value={provider.settings?.webhook_secret || ""} 
                            onChange={(e) => handleUpdateProvider(provider.id, { 
                              settings: { ...provider.settings, webhook_secret: e.target.value } 
                            })}
                            placeholder="DataMart Webhook Key"
                            className="h-8 bg-background border-border text-xs"
                          />
                        </div>
                      </div>

                      {provider.balance > 0 && (
                        <div className="flex items-center justify-between pt-2 border-t border-border">
                           <p className="text-[10px] text-muted-foreground font-medium">Current Balance</p>
                           <p className="text-xs font-black text-emerald-600 dark:text-emerald-400">₵{Number(provider.balance).toFixed(2)}</p>
                        </div>
                      )}

                      {provider.last_synced_at && (
                        <div className="flex items-center justify-between pt-2">
                           <p className="text-[10px] text-muted-foreground font-medium">Last Synced</p>
                           <p className="text-[10px] text-foreground/60 font-bold">{new Date(provider.last_synced_at).toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                  ))}
                  <Button onClick={handleSaveProviders} disabled={saving} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold h-10 rounded-xl">
                     Save Provider Priorities
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment Gateway (Paystack)</CardTitle>
              <CardDescription>Securely manage your Paystack credentials for customer payments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Paystack Secret Key</Label>
                <Input 
                  type="password" 
                  value={settings.paystack_secret_key || ""} 
                  onChange={(e) => setSettings({ ...settings, paystack_secret_key: e.target.value })} 
                  placeholder="sk_live_..." 
                />
                <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">
                  Securely managed via Supabase Secrets
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-500/20 bg-red-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-500" />
                Admin IP Lockdown
              </CardTitle>
              <CardDescription>
                Restrict Admin Dashboard access to specific IP addresses. 
                <span className="block text-red-500 font-bold mt-1 uppercase text-[10px]">Warning: If you enable this, you must include your current IP or you will be locked out!</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-xl bg-muted border border-border shadow-sm flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your Current IP</p>
                  <p className="text-sm font-mono font-black text-foreground">{currentIp || "Detecting..."}</p>
                </div>
                <Button 
                  size="sm" 
                  variant="outline" 
                  disabled={!currentIp || allowedIps.includes(currentIp)}
                  onClick={() => setAllowedIps([...allowedIps, currentIp])}
                  className="text-[10px] font-black uppercase"
                >
                  Whitelist Current IP
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Whitelisted IPs (One per line)</Label>
                <Textarea 
                  value={allowedIps.join("\n")}
                  onChange={(e) => setAllowedIps(e.target.value.split("\n").filter(i => i.trim() !== ""))}
                  placeholder="e.g. 123.45.67.89"
                  className="min-h-[100px] font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Leave empty to allow access from any IP address (Recommended for dynamic IPs).
                </p>
              </div>

              <Button
                onClick={async () => {
                  setSaving(true);
                  try {
                    const { error } = await supabase
                      .from("user_roles")
                      .update({ allowed_ips: allowedIps })
                      .eq("user_id", session?.user.id)
                      .eq("role", "admin");

                    if (error) throw error;
                    toast({ title: "IP Restrictions Updated", description: "Your access rules have been saved." });
                  } catch (e: any) {
                    toast({ title: "Failed to update IPs", description: e.message, variant: "destructive" });
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                variant="destructive"
                className="w-full font-bold"
              >
                Apply IP Restrictions
              </Button>
            </CardContent>
          </Card>

          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-400">
                <Wallet className="w-5 h-5" />
                Wallet Balance Restoration
              </CardTitle>
              <CardDescription>
                Creates missing wallet records for all agents and restores uncredited top-up balances.
                This operation is safe to run once — it will not apply if already executed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={async () => {
                  if (!window.confirm("Restore wallet balances for all affected agents? This runs once and cannot be reversed.")) return;
                  setRestoringWallets(true);
                  try {
                    const { data, error } = await supabase.rpc("admin_apply_wallet_restoration");
                    if (error) throw error;
                    if (data?.success === false) {
                      toast({ title: "Already Applied", description: data.message || "Restoration was already completed.", variant: "default" });
                    } else {
                      toast({
                        title: "Wallet Restoration Complete",
                        description: data?.message || `${data?.restored_agents} agent balances restored.`,
                      });
                    }
                  } catch (e: any) {
                    toast({ title: "Restoration Failed", description: e.message, variant: "destructive" });
                  } finally {
                    setRestoringWallets(false);
                  }
                }}
                disabled={restoringWallets}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold"
              >
                {restoringWallets ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Restoring Wallets...</>
                ) : (
                  <><Wallet className="w-4 h-4 mr-2" /> Restore Agent Wallet Balances</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
