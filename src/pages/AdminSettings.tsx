import { useEffect, useState } from "react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Save, AlertCircle, Phone, MessageSquare, Percent, MessageCircle, Gift, Sparkles, Video, 
  Upload, Trash2, Trash, Loader2, Globe, Database, Plus, ExternalLink, Activity, Shield, 
  GraduationCap, RefreshCw, Wifi, Users, TrendingUp, Wallet, Trophy, Clock, Check, Key, 
  Sliders, Server, Volume2, ShieldCheck, Zap
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { logAudit } from "@/utils/auditLogger";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { playSound } from "@/lib/sound";
import { getFlagUrl, cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SystemSettings {
  allow_duplicate_purchases: boolean;
  auto_refund_enabled: boolean;
  auto_api_switch: boolean;
  preferred_provider: "hubtel" | "paystack" | "flutterwave";
  backup_provider: "hubtel" | "paystack" | "flutterwave";
  active_payment_gateway?: string;
  auto_gateway_switch_by_package?: boolean;
  beneficiary_verification_enabled?: boolean;
  allow_non_beneficiary_continue?: boolean;
  auto_failover_non_beneficiary_to_datamart?: boolean;
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
  scheduled_success_sms_message: string;
  scheduled_failed_sms_message: string;
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
  background_brightness: number;
  background_contrast: number;
  background_blueness: number;
  enable_privacy_shield: boolean;
  ai_recommender_enabled: boolean;
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
  world_cup_predictor_enabled: boolean;
  mashup_automation_enabled: boolean;
  mashup_export_threshold: string;
  mashup_whatsapp_number: string;
  mashup_delivery_delay_mins: string;
}

const AdminSettings = () => {
  const { toast } = useToast();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SystemSettings>({
    allow_duplicate_purchases: false,
    auto_refund_enabled: false,
    auto_api_switch: false,
    preferred_provider: "paystack",
    backup_provider: "hubtel",
    active_payment_gateway: "paystack",
    auto_gateway_switch_by_package: false,
    beneficiary_verification_enabled: true,
    allow_non_beneficiary_continue: true,
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
    payment_success_sms_message: "Your order for {package} to {phone} is being processed. TxID: {id}",
    wallet_topup_sms_message: "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.",
    withdrawal_request_sms_message: "Withdrawal request of GHS {amount} received. It will be processed shortly.",
    withdrawal_completed_sms_message: "Your withdrawal of GHS {amount} has been completed. Thanks for using SwiftData.",
    order_failed_sms_message: "Order for {package} to {phone} failed. GHS {amount} has been refunded to your wallet.",
    manual_credit_sms_message: "Your account has been manually credited with GHS {amount} by admin.",
    scheduled_success_sms_message: "Your scheduled {package} bundle to {phone} has been successfully renewed. Thank you for using SwiftData!",
    scheduled_failed_sms_message: "Failed to renew your scheduled {package} bundle to {phone} due to insufficient wallet balance. Please top up to resume.",
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
    background_brightness: 1.0,
    background_contrast: 1.0,
    background_blueness: 0.0,
    enable_privacy_shield: true,
    ai_recommender_enabled: true,
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
    world_cup_predictor_enabled: true,
    mashup_automation_enabled: false,
    mashup_export_threshold: "10",
    mashup_whatsapp_number: "",
    mashup_delivery_delay_mins: "15",
  });

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
        let secrets: any = {};
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${SUPABASE_URL}/functions/v1/system-payout-v1`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`,
              'apikey': SUPABASE_PUBLISHABLE_KEY
            },
            body: JSON.stringify({ action: "get_admin_secrets" })
          });
          const secData = await res.json();
          if (secData.success) secrets = secData.secrets;
        } catch (e) {
          console.error("Failed to fetch admin secrets", e);
        }

        const d = data as any;
        setSettings({
          allow_duplicate_purchases: d.allow_duplicate_purchases || false,
          auto_refund_enabled: d.auto_refund_enabled || false,
          auto_api_switch: d.auto_api_switch || false,
          preferred_provider: (d.preferred_provider as any) || "paystack",
          backup_provider: (d.backup_provider as any) || "hubtel",
          active_payment_gateway: d.active_payment_gateway || "paystack",
          auto_gateway_switch_by_package: d.auto_gateway_switch_by_package || false,
          beneficiary_verification_enabled: d.beneficiary_verification_enabled !== false,
          allow_non_beneficiary_continue: d.allow_non_beneficiary_continue !== false,
          holiday_mode_enabled: d.holiday_mode_enabled || false,
          holiday_message: d.holiday_message || "",
          disable_ordering: d.disable_ordering || false,
          dark_mode_enabled: d.dark_mode_enabled || false,
          store_visitor_popup_enabled: d.store_visitor_popup_enabled || false,
          welcome_promo_enabled: d.welcome_promo_enabled !== false,
          customer_service_number: d.customer_service_number || "",
          support_channel_link: d.support_channel_link || "https://whatsapp.com/channel/0029VbCx0q4KLaHfJaiHLN40",
          sub_agent_base_fee: String(d.sub_agent_base_fee || "5.00"),
          txtconnect_api_key: String(secrets.txtconnect_api_key || ""),
          txtconnect_sender_id: String(secrets.txtconnect_sender_id || ""),
          paystack_secret_key: String(secrets.paystack_secret_key || ""),
          hubtel_client_id: String(secrets.hubtel_client_id || ""),
          hubtel_client_secret: String(secrets.hubtel_client_secret || ""),
          mtn_markup_percentage: String(d.mtn_markup_percentage || "0"),
          telecel_markup_percentage: String(d.telecel_markup_percentage || "0"),
          at_markup_percentage: String(d.at_markup_percentage || "0"),
          auto_pending_sms_enabled: d.auto_pending_sms_enabled || false,
          auto_pending_sms_message: d.auto_pending_sms_message || "Your SwiftData transaction is pending. Please try again or contact support.",
          payment_success_sms_message: d.payment_success_sms_message || "Your order for {package} to {phone} is being processed. TxID: {id}",
          wallet_topup_sms_message: d.wallet_topup_sms_message || "Your wallet has been credited with GHS {amount}. New balance: GHS {balance}.",
          withdrawal_request_sms_message: d.withdrawal_request_sms_message || "Withdrawal request of GHS {amount} received. It will be processed shortly.",
          withdrawal_completed_sms_message: d.withdrawal_completed_sms_message || "Your withdrawal of GHS {amount} has been completed. Thanks for using SwiftData.",
          order_failed_sms_message: d.order_failed_sms_message || "Order for {package} to {phone} failed. GHS {amount} has been refunded to your wallet.",
          manual_credit_sms_message: d.manual_credit_sms_message || "Your account has been manually credited with GHS {amount} by admin.",
          scheduled_success_sms_message: d.scheduled_success_sms_message || "Your scheduled {package} bundle to {phone} has been successfully renewed. Thank you for using SwiftData!",
          scheduled_failed_sms_message: d.scheduled_failed_sms_message || "Failed to renew your scheduled {package} bundle to {phone} due to insufficient wallet balance. Please top up to resume.",
          data_provider_api_key: String(secrets.data_provider_api_key || ""),
          data_provider_base_url: String(secrets.data_provider_base_url || ""),
          airtime_provider_api_key: String(secrets.airtime_provider_api_key || ""),
          airtime_provider_base_url: String(secrets.airtime_provider_base_url || ""),
          secondary_data_provider_api_key: String(secrets.secondary_data_provider_api_key || ""),
          secondary_data_provider_base_url: String(secrets.secondary_data_provider_base_url || ""),
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
          home_page_video_muted: d.home_page_video_muted !== false,
          agent_activation_fee: String(d.agent_activation_fee || "50.00"),
          wassce_price: String(d.wassce_price || "18.00"),
          bece_price: String(d.bece_price || "15.00"),
          wassce_cost_price: String(d.wassce_cost_price || "17.00"),
          bece_cost_price: String(d.bece_cost_price || "14.00"),
          traditional_background_enabled: d.traditional_background_enabled !== false,
          background_custom_image_url: String(d.background_custom_image_url || ""),
          background_brightness: typeof d.background_brightness === 'number' ? d.background_brightness : 1.0,
          background_contrast: typeof d.background_contrast === 'number' ? d.background_contrast : 1.0,
          background_blueness: typeof d.background_blueness === 'number' ? d.background_blueness : 0.0,
          enable_privacy_shield: d.enable_privacy_shield !== false,
          ai_recommender_enabled: d.ai_recommender_enabled !== false,
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
          world_cup_predictor_enabled: d.world_cup_predictor_enabled !== false,
          mashup_automation_enabled: d.mashup_automation_enabled || false,
          mashup_export_threshold: String(d.mashup_export_threshold || "10"),
          mashup_whatsapp_number: d.mashup_whatsapp_number || "",
          mashup_delivery_delay_mins: String(d.mashup_delivery_delay_mins || "15"),
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
      allow_duplicate_purchases: settings.allow_duplicate_purchases,
      active_payment_gateway: settings.active_payment_gateway || "paystack",
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
      background_brightness: Number(settings.background_brightness) || 1.0,
      background_contrast: Number(settings.background_contrast) || 1.0,
      background_blueness: Number(settings.background_blueness) || 0.0,
      enable_privacy_shield: settings.enable_privacy_shield,
      ai_recommender_enabled: settings.ai_recommender_enabled,
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
      world_cup_predictor_enabled: settings.world_cup_predictor_enabled,
      mashup_automation_enabled: settings.mashup_automation_enabled,
      mashup_export_threshold: parseInt(settings.mashup_export_threshold) || 10,
      mashup_whatsapp_number: settings.mashup_whatsapp_number.trim(),
      mashup_delivery_delay_mins: parseInt(settings.mashup_delivery_delay_mins) || 15,
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
        toast({ title: "⚠️ Save Interrupted", description: errorMsg, variant: "destructive" });
      } else {
        toast({ 
          title: "✨ Settings Saved",
          description: "System configuration updated successfully."
        });
        playSound("success");
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[350px] gap-4">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest animate-pulse">Loading System Settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Top Header Bar */}
      <div className="glass-card-neo p-5 sm:p-6 rounded-3xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-amber-400" /> Platform Configuration
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">System Settings & Integrations</h1>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving}
          className="h-11 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-950/40 gap-2 self-end sm:self-auto"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save All Changes</span>
        </Button>
      </div>

      {/* Main Tabbed Interface */}
      <Tabs defaultValue="general" className="w-full space-y-6">
        <TabsList className="glass-card-neo p-1.5 rounded-2xl border border-white/10 flex flex-wrap gap-1 bg-background/50 h-auto">
          <TabsTrigger value="general" className="rounded-xl px-4 py-2 text-xs font-black gap-2 data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950">
            <Shield className="w-3.5 h-3.5" /> General & Safety
          </TabsTrigger>
          <TabsTrigger value="gateways" className="rounded-xl px-4 py-2 text-xs font-black gap-2 data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950">
            <Wallet className="w-3.5 h-3.5" /> Payment Gateways
          </TabsTrigger>
          <TabsTrigger value="providers" className="rounded-xl px-4 py-2 text-xs font-black gap-2 data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950">
            <Server className="w-3.5 h-3.5" /> Provider APIs
          </TabsTrigger>
          <TabsTrigger value="pricing" className="rounded-xl px-4 py-2 text-xs font-black gap-2 data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950">
            <Percent className="w-3.5 h-3.5" /> Markups & Fees
          </TabsTrigger>
          <TabsTrigger value="sms" className="rounded-xl px-4 py-2 text-xs font-black gap-2 data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950">
            <MessageSquare className="w-3.5 h-3.5" /> SMS Alerts Engine
          </TabsTrigger>
          <TabsTrigger value="withdrawals" className="rounded-xl px-4 py-2 text-xs font-black gap-2 data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950">
            <Activity className="w-3.5 h-3.5" /> Withdrawal Rules
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: GENERAL & SAFETY ── */}
        <TabsContent value="general" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">Checkout & System Switches</h3>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-foreground">Disable Ordering System</Label>
                    <p className="text-[10px] text-muted-foreground">Emergency switch to pause all purchases.</p>
                  </div>
                  <Switch
                    checked={settings.disable_ordering}
                    onCheckedChange={(v) => setSettings({ ...settings, disable_ordering: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-foreground">Allow Duplicate Orders</Label>
                    <p className="text-[10px] text-muted-foreground">Allow multiple orders for same number within 5 mins.</p>
                  </div>
                  <Switch
                    checked={settings.allow_duplicate_purchases}
                    onCheckedChange={(v) => setSettings({ ...settings, allow_duplicate_purchases: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-foreground">Auto-Refund Failed Orders</Label>
                    <p className="text-[10px] text-muted-foreground">Instantly credit user wallet when order fails.</p>
                  </div>
                  <Switch
                    checked={settings.auto_refund_enabled}
                    onCheckedChange={(v) => setSettings({ ...settings, auto_refund_enabled: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-foreground">Privacy Shield Protection</Label>
                    <p className="text-[10px] text-muted-foreground">Mask customer phone numbers in public views.</p>
                  </div>
                  <Switch
                    checked={settings.enable_privacy_shield}
                    onCheckedChange={(v) => setSettings({ ...settings, enable_privacy_shield: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-bold text-foreground">AI Sales & Routing Recommender</Label>
                    <p className="text-[10px] text-muted-foreground">Enable smart AI insights and carrier suggestions.</p>
                  </div>
                  <Switch
                    checked={settings.ai_recommender_enabled}
                    onCheckedChange={(v) => setSettings({ ...settings, ai_recommender_enabled: v })}
                  />
                </div>
              </div>
            </div>

            <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <Phone className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">Customer Support Contacts</h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Support Phone Number</Label>
                  <Input
                    value={settings.customer_service_number}
                    onChange={(e) => setSettings({ ...settings, customer_service_number: e.target.value })}
                    placeholder="054XXXXXXX"
                    className="rounded-xl font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">WhatsApp Channel / Group Link</Label>
                  <Input
                    value={settings.support_channel_link}
                    onChange={(e) => setSettings({ ...settings, support_channel_link: e.target.value })}
                    placeholder="https://whatsapp.com/channel/..."
                    className="rounded-xl font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Holiday / Maintenance Banner Message</Label>
                  <Textarea
                    value={settings.holiday_message}
                    onChange={(e) => setSettings({ ...settings, holiday_message: e.target.value })}
                    placeholder="We are currently undergoing system upgrades..."
                    className="rounded-xl text-xs min-h-[80px]"
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 2: PAYMENT GATEWAYS ── */}
        <TabsContent value="gateways" className="space-y-6">
          <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">Payment Processor Credentials</h3>
              </div>
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] font-mono uppercase">Paystack Active</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Active Payment Gateway</Label>
                  <Select
                    value={settings.active_payment_gateway || "paystack"}
                    onValueChange={(v) => setSettings({ ...settings, active_payment_gateway: v })}
                  >
                    <SelectTrigger className="rounded-xl text-xs font-bold">
                      <SelectValue placeholder="Select gateway" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paystack">Paystack (Default Momo & Card)</SelectItem>
                      <SelectItem value="hubtel">Hubtel Direct Checkout</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Paystack Secret Key (live/test)</Label>
                  <Input
                    type="password"
                    value={settings.paystack_secret_key}
                    onChange={(e) => setSettings({ ...settings, paystack_secret_key: e.target.value })}
                    placeholder="sk_live_..."
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Hubtel Client ID</Label>
                  <Input
                    value={settings.hubtel_client_id}
                    onChange={(e) => setSettings({ ...settings, hubtel_client_id: e.target.value })}
                    placeholder="Hubtel ID"
                    className="rounded-xl font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Hubtel Client Secret</Label>
                  <Input
                    type="password"
                    value={settings.hubtel_client_secret}
                    onChange={(e) => setSettings({ ...settings, hubtel_client_secret: e.target.value })}
                    placeholder="Hubtel Secret"
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 3: PROVIDER APIS & FAILOVER ── */}
        <TabsContent value="providers" className="space-y-6">
          <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">Datamart & Carrier API Integrations</h3>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-bold">Auto-Failover</Label>
                <Switch
                  checked={settings.auto_failover_enabled}
                  onCheckedChange={(v) => setSettings({ ...settings, auto_failover_enabled: v })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase text-amber-400 tracking-wider">Primary Data Provider (Datamart)</h4>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Primary API Key</Label>
                  <Input
                    type="password"
                    value={settings.data_provider_api_key}
                    onChange={(e) => setSettings({ ...settings, data_provider_api_key: e.target.value })}
                    placeholder="Datamart Bearer Token"
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Primary Base URL</Label>
                  <Input
                    value={settings.data_provider_base_url}
                    onChange={(e) => setSettings({ ...settings, data_provider_base_url: e.target.value })}
                    placeholder="https://datamarthub.com"
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase text-cyan-400 tracking-wider">Secondary Failover Provider</h4>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Secondary API Key</Label>
                  <Input
                    type="password"
                    value={settings.secondary_data_provider_api_key}
                    onChange={(e) => setSettings({ ...settings, secondary_data_provider_api_key: e.target.value })}
                    placeholder="Secondary Bearer Token"
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Secondary Base URL</Label>
                  <Input
                    value={settings.secondary_data_provider_base_url}
                    onChange={(e) => setSettings({ ...settings, secondary_data_provider_base_url: e.target.value })}
                    placeholder="https://backup.datamarthub.com"
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 4: MARKUPS & FEES ── */}
        <TabsContent value="pricing" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <Percent className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">Global Network Markup Percentages</h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">MTN Markup (%)</Label>
                  <Input
                    type="number"
                    value={settings.mtn_markup_percentage}
                    onChange={(e) => setSettings({ ...settings, mtn_markup_percentage: e.target.value })}
                    className="rounded-xl font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Telecel Markup (%)</Label>
                  <Input
                    type="number"
                    value={settings.telecel_markup_percentage}
                    onChange={(e) => setSettings({ ...settings, telecel_markup_percentage: e.target.value })}
                    className="rounded-xl font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">AT Markup (%)</Label>
                  <Input
                    type="number"
                    value={settings.at_markup_percentage}
                    onChange={(e) => setSettings({ ...settings, at_markup_percentage: e.target.value })}
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <GraduationCap className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">Agent Fees & Result Checker Pricing</h3>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Agent Upgrade Fee (GH₵)</Label>
                    <Input
                      type="number"
                      value={settings.agent_activation_fee}
                      onChange={(e) => setSettings({ ...settings, agent_activation_fee: e.target.value })}
                      className="rounded-xl font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Sub-Agent Base Fee (GH₵)</Label>
                    <Input
                      type="number"
                      value={settings.sub_agent_base_fee}
                      onChange={(e) => setSettings({ ...settings, sub_agent_base_fee: e.target.value })}
                      className="rounded-xl font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">WASSCE Checker Price (GH₵)</Label>
                    <Input
                      type="number"
                      value={settings.wassce_price}
                      onChange={(e) => setSettings({ ...settings, wassce_price: e.target.value })}
                      className="rounded-xl font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">BECE Checker Price (GH₵)</Label>
                    <Input
                      type="number"
                      value={settings.bece_price}
                      onChange={(e) => setSettings({ ...settings, bece_price: e.target.value })}
                      className="rounded-xl font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 5: SMS ALERTS ENGINE ── */}
        <TabsContent value="sms" className="space-y-6">
          <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">TXTConnect SMS Gateway Credentials</h3>
              </div>
              <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30 text-[10px] font-mono uppercase">SwiftUpdate Sender Active</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">TXTConnect API Key</Label>
                <Input
                  type="password"
                  value={settings.txtconnect_api_key}
                  onChange={(e) => setSettings({ ...settings, txtconnect_api_key: e.target.value })}
                  placeholder="API Key"
                  className="rounded-xl font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Sender ID</Label>
                <Input
                  value={settings.txtconnect_sender_id}
                  onChange={(e) => setSettings({ ...settings, txtconnect_sender_id: e.target.value })}
                  placeholder="SwiftData"
                  className="rounded-xl font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <h4 className="text-xs font-black uppercase text-amber-400 tracking-wider">Automated Customer SMS Templates</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Successful Order SMS Copy</Label>
                  <Textarea
                    value={settings.payment_success_sms_message}
                    onChange={(e) => setSettings({ ...settings, payment_success_sms_message: e.target.value })}
                    className="rounded-xl text-xs font-mono min-h-[75px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Wallet Top-up Credit SMS Copy</Label>
                  <Textarea
                    value={settings.wallet_topup_sms_message}
                    onChange={(e) => setSettings({ ...settings, wallet_topup_sms_message: e.target.value })}
                    className="rounded-xl text-xs font-mono min-h-[75px]"
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── TAB 6: WITHDRAWAL ENGINE ── */}
        <TabsContent value="withdrawals" className="space-y-6">
          <div className="glass-card-neo p-6 rounded-3xl border border-white/10 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base text-foreground">Agent Wallet Withdrawal Automation</h3>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs font-bold">System Enabled</Label>
                <Switch
                  checked={settings.withdrawal_system_enabled}
                  onCheckedChange={(v) => setSettings({ ...settings, withdrawal_system_enabled: v })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Min Withdrawal (GH₵)</Label>
                <Input
                  type="number"
                  value={settings.min_withdrawal_amount}
                  onChange={(e) => setSettings({ ...settings, min_withdrawal_amount: e.target.value })}
                  className="rounded-xl font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Max Withdrawal per Order (GH₵)</Label>
                <Input
                  type="number"
                  value={settings.max_withdrawal_amount}
                  onChange={(e) => setSettings({ ...settings, max_withdrawal_amount: e.target.value })}
                  className="rounded-xl font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Auto-Approve Max Amount (GH₵)</Label>
                <Input
                  type="number"
                  value={settings.withdrawal_auto_approve_max_amount}
                  onChange={(e) => setSettings({ ...settings, withdrawal_auto_approve_max_amount: e.target.value })}
                  className="rounded-xl font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <div>
                <Label className="text-xs font-bold">Auto-Approve Low Value Withdrawals</Label>
                <p className="text-[10px] text-muted-foreground">Instantly payout withdrawals under auto-approve limit without manual admin click.</p>
              </div>
              <Switch
                checked={settings.withdrawal_auto_approve_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, withdrawal_auto_approve_enabled: v })}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Floating Save Action Bar at bottom */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="h-12 px-6 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-2xl shadow-amber-950/60 border border-amber-400/40 gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save All Settings</span>
        </Button>
      </div>
    </div>
  );
};

export default AdminSettings;
