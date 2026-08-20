import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  PhoneCall,
  Volume2,
  Mic,
  Upload,
  Send,
  Users,
  UserCheck,
  UserPlus,
  Phone,
  Radio,
  FileAudio,
  Clock,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Key,
  Info,
  Play,
  Pause,
  ChevronRight,
  Loader2,
  Eye,
  EyeOff,
  Wallet,
  Signal,
  ShieldCheck,
  ChevronDown,
  Check,
  Plus,
  Trash2,
  Copy,
  Bookmark,
  Calendar,
  Zap,
  AlertTriangle,
  FileText,
  Tag,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface MnotifyTemplate {
  id?: string | number;
  title?: string;
  template_name?: string;
  name?: string;
  content?: string;
  message?: string;
  voice_id?: string;
  type?: string;
  category?: string;
  created_at?: string;
}

interface CampaignSummary {
  _id?: string;
  voice_id?: string;
  type?: string;
  total_sent?: number;
  contacts?: number;
  total_rejected?: number;
  credit_used?: number;
  credit_left?: number;
}

type AccentKey = "cyan" | "emerald" | "violet" | "amber" | "slate";

const ACCENT: Record<AccentKey, {
  grad: string;
  text: string;
  bgSoft: string;
  borderSoft: string;
  ring: string;
  glow: string;
  solid: string;
  switchBg: string;
}> = {
  cyan: {
    grad: "from-cyan-500 to-blue-500",
    text: "text-cyan-400",
    bgSoft: "bg-cyan-500/10",
    borderSoft: "border-cyan-500/30",
    ring: "ring-cyan-500/30",
    glow: "shadow-cyan-500/25",
    solid: "bg-cyan-500",
    switchBg: "data-[state=checked]:bg-cyan-500",
  },
  emerald: {
    grad: "from-emerald-500 to-teal-500",
    text: "text-emerald-400",
    bgSoft: "bg-emerald-500/10",
    borderSoft: "border-emerald-500/30",
    ring: "ring-emerald-500/30",
    glow: "shadow-emerald-500/25",
    solid: "bg-emerald-500",
    switchBg: "data-[state=checked]:bg-emerald-500",
  },
  violet: {
    grad: "from-violet-500 to-purple-500",
    text: "text-violet-400",
    bgSoft: "bg-violet-500/10",
    borderSoft: "border-violet-500/30",
    ring: "ring-violet-500/30",
    glow: "shadow-violet-500/25",
    solid: "bg-violet-500",
    switchBg: "data-[state=checked]:bg-violet-500",
  },
  amber: {
    grad: "from-amber-500 to-orange-500",
    text: "text-amber-400",
    bgSoft: "bg-amber-500/10",
    borderSoft: "border-amber-500/30",
    ring: "ring-amber-500/30",
    glow: "shadow-amber-500/25",
    solid: "bg-amber-500",
    switchBg: "data-[state=checked]:bg-amber-500",
  },
  slate: {
    grad: "from-slate-500 to-slate-600",
    text: "text-slate-400",
    bgSoft: "bg-slate-500/10",
    borderSoft: "border-slate-500/30",
    ring: "ring-slate-500/30",
    glow: "shadow-slate-500/25",
    solid: "bg-slate-500",
    switchBg: "data-[state=checked]:bg-slate-500",
  },
};

const TABS: { id: "broadcast" | "sms" | "templates" | "sender_id" | "settings"; label: string; icon: any; accent: AccentKey }[] = [
  { id: "broadcast", label: "Voice Broadcast", icon: Volume2, accent: "cyan" },
  { id: "sms", label: "Quick SMS", icon: Send, accent: "emerald" },
  { id: "templates", label: "Templates", icon: Bookmark, accent: "violet" },
  { id: "sender_id", label: "Sender IDs", icon: Radio, accent: "amber" },
  { id: "settings", label: "Credentials", icon: Key, accent: "slate" },
];

const CURATED_SYSTEM_TEMPLATES: MnotifyTemplate[] = [
  {
    id: "system-1",
    title: "⚡ Flash Weekend Bundle Discount",
    category: "Promotions",
    type: "sms",
    content: "Flash Sale Alert! 🚀 Get up to 10% bonus data on all MTN & Telecel packages today on SwiftData! Top up now at swiftdata.me before midnight!",
  },
  {
    id: "system-2",
    title: "🔧 Scheduled Server Maintenance Notice",
    category: "Maintenance",
    type: "voice",
    content: "Dear valued partner, SwiftData will undergo scheduled maintenance tonight at 11:30 PM for 30 minutes. All pending orders will process immediately after.",
  },
  {
    id: "system-3",
    title: "📶 MTN Network Delay Advisory",
    category: "Alerts",
    type: "both",
    content: "Notice: MTN is experiencing temporary third-party network delays across Ghana. Deliveries may take a few extra minutes. Thank you for your patience.",
  },
  {
    id: "system-4",
    title: "💼 Agent Commission Boost & Rewards",
    category: "Agent Alerts",
    type: "sms",
    content: "Hello Agent! Earn double cashback points on every 100GB bundle sold this week! Check your agent portal to track your live earnings.",
  },
  {
    id: "system-5",
    title: "💳 Low Wallet Balance Top-Up Reminder",
    category: "Alerts",
    type: "both",
    content: "Friendly reminder from SwiftData: Your agent wallet balance is running low. Please top up your wallet to ensure uninterrupted instant customer orders.",
  },
  {
    id: "system-6",
    title: "👋 New Customer Onboarding Welcome",
    category: "Welcome",
    type: "sms",
    content: "Welcome to SwiftData Ghana! 🇬🇭 Enjoy the lowest data and airtime rates nationwide. Save our support line for instant assistance: 0557061663.",
  }
];

export default function AdminVoiceSMS() {
  const { session } = useAuth();
  const { isDark } = useAppTheme();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"broadcast" | "sms" | "templates" | "sender_id" | "settings">("broadcast");
  const [campaignTitle, setCampaignTitle] = useState("");
  const [targetType, setTargetType] = useState<"custom" | "all_users" | "agents" | "sub_agents">("custom");
  const [customNumbers, setCustomNumbers] = useState("");
  const [audioSource, setAudioSource] = useState<"file" | "voice_id" | "template">("file");
  const [voiceId, setVoiceId] = useState("");

  // Advanced Scheduling State
  const [isSchedule, setIsSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [schedulePreset, setSchedulePreset] = useState<string>("custom");

  // SMS specific state
  const [smsMessage, setSmsMessage] = useState("");
  const [smsSenderId, setSmsSenderId] = useState("SwiftData");
  const [isSmsOtp, setIsSmsOtp] = useState(false);
  const [lastSmsResult, setLastSmsResult] = useState<any | null>(null);

  // Template Management State
  const [templates, setTemplates] = useState<MnotifyTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");
  const [newTemplateCategory, setNewTemplateCategory] = useState("Promotions");
  const [newTemplateType, setNewTemplateType] = useState<"sms" | "voice" | "both">("both");
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);

  // Sender ID registration state
  const [regSenderName, setRegSenderName] = useState("");
  const [regPurpose, setRegPurpose] = useState("For Transactional and Order Notification SMS");
  const [checkSenderName, setCheckSenderName] = useState("");
  const [senderCheckResult, setSenderCheckResult] = useState<any | null>(null);
  const [registeringSender, setRegisteringSender] = useState(false);

  // File & Recording state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Settings & balance state
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [voiceBalance, setVoiceBalance] = useState<number | null>(null);
  const [smsBalance, setSmsBalance] = useState<number | null>(null);

  // Dispatch state
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<CampaignSummary | null>(null);
  const [counts, setCounts] = useState<{ all: number; agents: number; subAgents: number }>({ all: 0, agents: 0, subAgents: 0 });

  // Fetch counts & balance on mount
  useEffect(() => {
    fetchAudienceCounts();
    fetchBalanceAndTemplates();
  }, []);

  const fetchAudienceCounts = async () => {
    try {
      const [{ count: allCount }, { count: agentCount }, { count: subCount }] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).not("phone", "is", null),
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_agent", true).not("phone", "is", null),
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("sub_agent_approved", true).not("phone", "is", null)
      ]);
      setCounts({
        all: allCount || 0,
        agents: agentCount || 0,
        subAgents: subCount || 0
      });
    } catch (e) {
      console.error("Error fetching audience counts:", e);
    }
  };

  const fetchBalanceAndTemplates = async () => {
    if (!session?.access_token) return;
    setLoadingTemplates(true);
    try {
      const [balRes, tmplRes] = await Promise.all([
        supabase.functions.invoke("mnotify-voice", {
          body: { action: "check_balance", api_key: apiKey.trim() || undefined },
          headers: { Authorization: `Bearer ${session.access_token}` }
        }),
        supabase.functions.invoke("mnotify-voice", {
          body: { action: "get_templates", api_key: apiKey.trim() || undefined },
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
      ]);

      if (balRes.data?.success) {
        setVoiceBalance(balRes.data.voice_balance ?? null);
        setSmsBalance(balRes.data.sms_balance ?? null);
      }
      if (tmplRes.data?.success && Array.isArray(tmplRes.data.data)) {
        setTemplates(tmplRes.data.data);
      }
    } catch (e) {
      console.error("Error loading mNotify data:", e);
    } finally {
      setLoadingTemplates(false);
    }
  };

  // ── Scheduling Helpers ──────────────────────────────────────────────
  const applySchedulePreset = (preset: string) => {
    setSchedulePreset(preset);
    const now = new Date();

    if (preset === "15m") {
      const target = new Date(now.getTime() + 15 * 60 * 1000);
      setScheduleDate(target.toISOString().split("T")[0]);
      setScheduleTime(target.toTimeString().slice(0, 5));
    } else if (preset === "1h") {
      const target = new Date(now.getTime() + 60 * 60 * 1000);
      setScheduleDate(target.toISOString().split("T")[0]);
      setScheduleTime(target.toTimeString().slice(0, 5));
    } else if (preset === "tonight_8pm") {
      setScheduleDate(now.toISOString().split("T")[0]);
      setScheduleTime("20:00");
    } else if (preset === "tomorrow_9am") {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      setScheduleDate(tomorrow.toISOString().split("T")[0]);
      setScheduleTime("09:00");
    } else if (preset === "tomorrow_7pm") {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      setScheduleDate(tomorrow.toISOString().split("T")[0]);
      setScheduleTime("19:00");
    } else if (preset === "saturday_10am") {
      const sat = new Date();
      sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
      setScheduleDate(sat.toISOString().split("T")[0]);
      setScheduleTime("10:00");
    }
  };

  const getFullScheduleString = () => {
    if (!scheduleDate || !scheduleTime) return "";
    return `${scheduleDate} ${scheduleTime}`;
  };

  const getScheduleInsight = () => {
    if (!scheduleDate || !scheduleTime) return null;
    const targetDate = new Date(`${scheduleDate}T${scheduleTime}:00`);
    const now = new Date();
    const diffMs = targetDate.getTime() - now.getTime();

    if (diffMs <= 0) {
      return { isPast: true, message: "⚠️ Warning: Selected time is in the past." };
    }

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const hoursNum = parseInt(scheduleTime.split(":")[0], 10);
    const isNight = hoursNum >= 22 || hoursNum < 6;
    const isPeak = (hoursNum >= 9 && hoursNum <= 11) || (hoursNum >= 18 && hoursNum <= 20);

    return {
      isPast: false,
      isNight,
      isPeak,
      countdown: `Fires in ${hours > 0 ? `${hours}h ` : ""}${mins}m (${scheduleDate} @ ${scheduleTime} GMT)`,
    };
  };

  // ── Template Handlers ──────────────────────────────────────────────
  const handleSaveTemplate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTemplateTitle.trim() || !newTemplateContent.trim()) {
      toast({ title: "Title & Content Required", description: "Please provide both title and content.", variant: "destructive" });
      return;
    }

    setCreatingTemplate(true);
    try {
      const { data, error } = await supabase.functions.invoke("mnotify-voice", {
        body: {
          action: "create_template",
          title: newTemplateTitle.trim(),
          content: newTemplateContent.trim(),
          api_key: apiKey.trim() || undefined
        },
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to create template.");
      }

      toast({
        title: "Template Saved! 📑",
        description: `"${newTemplateTitle}" is now synced with your mNotify account.`
      });

      setNewTemplateTitle("");
      setNewTemplateContent("");
      setShowCreateTemplateModal(false);
      fetchBalanceAndTemplates();
    } catch (err: any) {
      toast({ title: "Template Creation Failed", description: err.message, variant: "destructive" });
    } finally {
      setCreatingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string | number) => {
    if (!confirm("Are you sure you want to delete this template from mNotify?")) return;
    try {
      const { data, error } = await supabase.functions.invoke("mnotify-voice", {
        body: {
          action: "delete_template",
          template_id: templateId,
          api_key: apiKey.trim() || undefined
        },
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to delete template.");
      }

      toast({ title: "Template Deleted", description: "Template was removed from mNotify." });
      setTemplates((prev) => prev.filter((t) => (t.id || t._id) !== templateId));
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    }
  };

  const copyTemplateContent = (id: string | number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({ title: "Copied to Clipboard! 📋", description: "Template text is ready to paste." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const insertVariableIntoTemplate = (variable: string) => {
    setNewTemplateContent((prev) => prev + ` {{${variable}}}`);
  };

  // ── Audio File Handlers ─────────────────────────────────────────────
  const processFile = (file: File) => {
    if (!file.type.startsWith("audio/") && !file.name.endsWith(".mp3") && !file.name.endsWith(".wav") && !file.name.endsWith(".m4a")) {
      toast({ title: "Invalid File Type", description: "Please upload an MP3 or WAV audio file.", variant: "destructive" });
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "File Too Large", description: "Maximum audio file size is 15MB.", variant: "destructive" });
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setAudioPreviewUrl(url);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const base64Data = result.split(",")[1];
      setAudioBase64(base64Data);
    };
    reader.readAsDataURL(file);
  };

  const toggleAudioPlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  // ── Recipient Parsing ───────────────────────────────────────────────
  const parsedRecipients = () => {
    return customNumbers
      .split(/[\n,;]+/)
      .map((n) => n.trim().replace(/[^\d+]/g, ""))
      .filter((n) => n.length >= 9);
  };

  const getTargetRecipientCount = () => {
    if (targetType === "all_users") return counts.all;
    if (targetType === "agents") return counts.agents;
    if (targetType === "sub_agents") return counts.subAgents;
    return parsedRecipients().length;
  };

  // ── Dispatch Handlers ───────────────────────────────────────────────
  const handleSendVoiceCampaign = async () => {
    if (!campaignTitle.trim()) {
      toast({ title: "Campaign Title Required", description: "Please enter a name for your voice broadcast.", variant: "destructive" });
      return;
    }

    if (targetType === "custom" && parsedRecipients().length === 0) {
      toast({ title: "No Phone Numbers", description: "Please enter at least one valid recipient phone number.", variant: "destructive" });
      return;
    }

    if (audioSource === "file" && !audioBase64) {
      toast({ title: "Audio File Missing", description: "Please upload a recorded audio file (.mp3, .wav).", variant: "destructive" });
      return;
    }

    if ((audioSource === "voice_id" || audioSource === "template") && !voiceId.trim()) {
      toast({ title: "Voice ID Required", description: "Please enter a valid mNotify Voice ID.", variant: "destructive" });
      return;
    }

    const scheduleStr = isSchedule ? getFullScheduleString() : undefined;
    if (isSchedule && (!scheduleDate || !scheduleTime)) {
      toast({ title: "Schedule Incomplete", description: "Please pick both date and time.", variant: "destructive" });
      return;
    }

    if (!confirm(`Are you sure you want to ${isSchedule ? "SCHEDULE" : "BROADCAST"} this Voice Call to ${getTargetRecipientCount()} recipients?`)) {
      return;
    }

    setSending(true);
    setLastResult(null);

    try {
      const payload: any = {
        action: "send_voice_call",
        campaign: campaignTitle.trim(),
        api_key: apiKey.trim() || undefined,
        is_schedule: isSchedule,
        schedule_date: scheduleStr,
      };

      if (targetType === "custom") {
        payload.recipients = parsedRecipients();
      } else {
        payload.target_group = targetType;
      }

      if (audioSource === "file" && selectedFile && audioBase64) {
        payload.audio_base64 = audioBase64;
        payload.audio_filename = selectedFile.name;
        payload.audio_mimetype = selectedFile.type || "audio/mpeg";
      } else {
        payload.voice_id = voiceId.trim();
      }

      const { data, error } = await supabase.functions.invoke("mnotify-voice", {
        body: payload,
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to dispatch voice call.");
      }

      toast({
        title: isSchedule ? "Voice Call Scheduled! 📅" : "Voice Campaign Dispatched! 📞",
        description: isSchedule
          ? `Successfully scheduled for ${scheduleStr} to ${getTargetRecipientCount()} contacts.`
          : `Successfully placed voice calls to ${data.summary?.total_sent || getTargetRecipientCount()} recipients.`
      });

      setLastResult(data.summary || { total_sent: getTargetRecipientCount() });
      fetchBalanceAndTemplates();
    } catch (err: any) {
      toast({ title: "Broadcast Failed", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleSendQuickSms = async () => {
    if (!smsMessage.trim()) {
      toast({ title: "Message Required", description: "Please enter your SMS message content.", variant: "destructive" });
      return;
    }
    if (targetType === "custom" && parsedRecipients().length === 0) {
      toast({ title: "No Phone Numbers", description: "Please enter at least one valid recipient phone number.", variant: "destructive" });
      return;
    }

    const scheduleStr = isSchedule ? getFullScheduleString() : undefined;
    if (isSchedule && (!scheduleDate || !scheduleTime)) {
      toast({ title: "Schedule Incomplete", description: "Please pick both date and time.", variant: "destructive" });
      return;
    }

    if (!confirm(`Are you sure you want to ${isSchedule ? "SCHEDULE" : "BROADCAST"} this SMS via mNotify to ${getTargetRecipientCount()} recipients?`)) {
      return;
    }

    setSending(true);
    setLastSmsResult(null);
    try {
      const payload: any = {
        action: "send_sms",
        sender: smsSenderId.trim() || "SwiftData",
        message: smsMessage.trim(),
        api_key: apiKey.trim() || undefined,
        is_schedule: isSchedule,
        schedule_date: scheduleStr,
        sms_type: isSmsOtp ? "otp" : undefined
      };
      if (targetType === "custom") {
        payload.recipients = parsedRecipients();
      } else {
        payload.target_group = targetType;
      }
      const { data, error } = await supabase.functions.invoke("mnotify-voice", {
        body: payload,
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to dispatch SMS.");
      }
      toast({
        title: isSchedule ? "SMS Scheduled! 📅" : "SMS Broadcast Dispatched! ✉️",
        description: isSchedule
          ? `Successfully scheduled for ${scheduleStr} to ${getTargetRecipientCount()} contacts.`
          : `Successfully sent SMS to ${data.summary?.total_sent || getTargetRecipientCount()} recipients.`
      });
      setLastSmsResult(data.summary);
      fetchBalanceAndTemplates();
    } catch (err: any) {
      toast({ title: "SMS Failed", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleRegisterSenderId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regSenderName.trim()) {
      toast({ title: "Sender ID Required", variant: "destructive" });
      return;
    }
    setRegisteringSender(true);
    try {
      const { data, error } = await supabase.functions.invoke("mnotify-voice", {
        body: {
          action: "register_sender_id",
          sender_name: regSenderName.trim(),
          purpose: regPurpose.trim(),
          api_key: apiKey.trim() || undefined
        },
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Failed to register Sender ID.");
      toast({ title: "Sender ID Submitted", description: `Sender ID "${regSenderName}" is now ${data.summary?.status || "Pending approval"}.` });
      setRegSenderName("");
    } catch (err: any) {
      toast({ title: "Registration Error", description: err.message, variant: "destructive" });
    } finally {
      setRegisteringSender(false);
    }
  };

  const handleCheckSenderStatus = async () => {
    if (!checkSenderName.trim()) return;
    setRegisteringSender(true);
    setSenderCheckResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("mnotify-voice", {
        body: {
          action: "check_sender_id",
          sender_name: checkSenderName.trim(),
          api_key: apiKey.trim() || undefined
        },
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Could not check status.");
      setSenderCheckResult(data.summary || { status: data.status });
      toast({ title: "Sender ID Status Retrieved" });
    } catch (err: any) {
      toast({ title: "Status Check Failed", description: err.message, variant: "destructive" });
    } finally {
      setRegisteringSender(false);
    }
  };

  // ── Shared UI Building Blocks ───────────────────────────────────────
  const renderAudienceGrid = (accent: AccentKey) => {
    const a = ACCENT[accent];
    const options = [
      { id: "all_users", label: "All Users", count: counts.all, icon: Users },
      { id: "agents", label: "Agents", count: counts.agents, icon: UserCheck },
      { id: "sub_agents", label: "Sub-Agents", count: counts.subAgents, icon: UserPlus },
      { id: "custom", label: "Custom Phone(s)", count: parsedRecipients().length, icon: Phone },
    ] as const;

    return (
      <div className="space-y-2">
        <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Select Target Audience</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {options.map((target) => {
            const isActive = targetType === target.id;
            return (
              <button
                key={target.id}
                type="button"
                onClick={() => setTargetType(target.id)}
                className={cn(
                  "relative p-3 rounded-xl border text-left transition-all overflow-hidden group",
                  isActive
                    ? cn(a.bgSoft, a.borderSoft, "font-bold")
                    : "bg-secondary/40 border-border text-muted-foreground hover:bg-secondary hover:border-border"
                )}
              >
                <target.icon className={cn("w-3.5 h-3.5 mb-1.5", isActive ? a.text : "text-muted-foreground/70 group-hover:text-foreground")} />
                <p className={cn("text-xs font-black", isActive ? a.text : "text-foreground")}>{target.label}</p>
                <p className="text-[11px] opacity-70 mt-0.5">{target.count.toLocaleString()} contacts</p>
                {isActive && (
                  <motion.div layoutId={`audienceCheck-${accent}`} className={cn("absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center bg-gradient-to-br", a.grad)}>
                    <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                  </motion.div>
                )}
              </button>
            );
          })}
        </div>

        {targetType === "custom" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-1.5 pt-1">
            <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">
              Phone Numbers (separated by commas or new lines)
            </label>
            <Textarea
              value={customNumbers}
              onChange={(e) => setCustomNumbers(e.target.value)}
              placeholder="e.g. 0241234567, 0557654321, 0209876543"
              rows={3}
              className="rounded-xl bg-secondary/50 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", parsedRecipients().length > 0 ? a.solid : "bg-muted-foreground/40")} />
              {parsedRecipients().length} valid phone number(s) detected.
            </p>
          </motion.div>
        )}
      </div>
    );
  };

  // ── Proper Advanced Scheduler Component ─────────────────────────────
  const renderAdvancedScheduleControl = (accent: AccentKey) => {
    const a = ACCENT[accent];
    const insight = getScheduleInsight();

    return (
      <div className="p-4 rounded-2xl bg-secondary/30 border border-border space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", a.bgSoft, a.text)}>
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black text-foreground">Advanced Auto-Scheduler</p>
              <p className="text-[10px] text-muted-foreground">Precision timed delivery in Ghana Standard Time (GMT)</p>
            </div>
          </div>
          <Switch
            checked={isSchedule}
            onCheckedChange={setIsSchedule}
            className={a.switchBg}
          />
        </div>

        <AnimatePresence>
          {isSchedule && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 pt-2 border-t border-border/50 overflow-hidden"
            >
              {/* Presets Grid */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400" /> Fast Smart Presets
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {[
                    { id: "15m", label: "+15 Mins" },
                    { id: "1h", label: "+1 Hour" },
                    { id: "tonight_8pm", label: "Tonight 8PM" },
                    { id: "tomorrow_9am", label: "Tmrw 9AM" },
                    { id: "tomorrow_7pm", label: "Tmrw 7PM" },
                    { id: "saturday_10am", label: "Saturday" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applySchedulePreset(p.id)}
                      className={cn(
                        "py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all text-center",
                        schedulePreset === p.id
                          ? cn(a.bgSoft, a.borderSoft, a.text)
                          : "bg-card border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exact DateTime Pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Delivery Date</label>
                  <Input
                    type="date"
                    min={new Date().toISOString().split("T")[0]}
                    value={scheduleDate}
                    onChange={(e) => {
                      setScheduleDate(e.target.value);
                      setSchedulePreset("custom");
                    }}
                    className="rounded-xl h-10 bg-card font-mono text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Delivery Time (GMT / 24h)</label>
                  <Input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => {
                      setScheduleTime(e.target.value);
                      setSchedulePreset("custom");
                    }}
                    className="rounded-xl h-10 bg-card font-mono text-xs"
                  />
                </div>
              </div>

              {/* Realtime Countdown & Night Guard Banner */}
              {insight && (
                <div className="space-y-2">
                  <div className={cn(
                    "p-3 rounded-xl border flex items-center justify-between text-xs font-bold",
                    insight.isPast
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  )}>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{insight.countdown || insight.message}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono">🇬🇭 GMT</Badge>
                  </div>

                  {insight.isNight && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[11px] flex items-center gap-2 font-medium">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>⚠️ Night Hours Alert: Scheduled between 10 PM and 6 AM. Consider day hours for optimal customer response.</span>
                    </div>
                  )}

                  {insight.isPeak && (
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] flex items-center gap-2 font-medium">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>✨ Peak Engagement Window: Optimal customer open rate expected.</span>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const smsPageInfo = (() => {
    const len = smsMessage.length;
    const perPage = 160;
    const page = len === 0 ? 1 : Math.ceil(len / perPage);
    const fill = len === 0 ? 0 : ((len - (page - 1) * perPage) / perPage) * 100;
    return { len, page, fill };
  })();

  const allDisplayTemplates = [
    ...templates,
    ...CURATED_SYSTEM_TEMPLATES.filter((st) => !templates.some((t) => (t.title || t.template_name) === st.title))
  ];

  return (
    <div className="space-y-6 pb-24 max-w-6xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <PhoneCall className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-black tracking-tight text-foreground">
              Voice & SMS Command Center
            </h1>
            <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 bg-cyan-500/10 text-[10px] font-black uppercase tracking-wider">
              mNotify API v2.0
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Direct telecommunications engine for Voice Broadcasting, Bulk SMS, Dynamic Templates, and Timed Scheduling.
          </p>
        </div>

        {/* Live Balance Cards */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-card border border-border shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Voice Units</p>
              <p className="text-sm font-black text-foreground font-mono">
                {voiceBalance !== null ? voiceBalance.toLocaleString() : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-card border border-border shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">SMS Balance</p>
              <p className="text-sm font-black text-foreground font-mono">
                {smsBalance !== null ? smsBalance.toLocaleString() : "—"}
              </p>
            </div>
          </div>

          <Button
            size="icon"
            variant="outline"
            onClick={fetchBalanceAndTemplates}
            disabled={loadingTemplates}
            className="rounded-xl w-10 h-10 border-border"
          >
            <RefreshCw className={cn("w-4 h-4", loadingTemplates && "animate-spin")} />
          </Button>
        </div>
      </motion.div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-secondary/40 border border-border overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const a = ACCENT[tab.accent];
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shrink-0",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className={cn("w-4 h-4", isActive ? a.text : "text-muted-foreground")} />
              {tab.label}
              {tab.id === "templates" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono">
                  {allDisplayTemplates.length}
                </Badge>
              )}
              {isActive && (
                <motion.div
                  layoutId="activeTabPill"
                  className={cn("absolute inset-0 rounded-xl bg-card border border-border shadow-sm -z-10", a.borderSoft)}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {/* TAB 1: VOICE BROADCAST */}
          {activeTab === "broadcast" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-black text-foreground flex items-center gap-2">
                      <Volume2 className="w-5 h-5 text-cyan-400" /> New Voice Broadcast
                    </h2>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActiveTab("templates")}
                      className="text-xs text-cyan-400 hover:text-cyan-300 gap-1"
                    >
                      <Bookmark className="w-3.5 h-3.5" /> Pick from Templates
                    </Button>
                  </div>

                  {/* Campaign Title */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Campaign Title</label>
                    <Input
                      value={campaignTitle}
                      onChange={(e) => setCampaignTitle(e.target.value)}
                      placeholder="e.g. Flash Weekend Promo Call"
                      className="rounded-xl h-11 bg-secondary/50 font-bold"
                    />
                  </div>

                  {/* Audience Selection */}
                  {renderAudienceGrid("cyan")}

                  {/* Audio Source Picker */}
                  <div className="space-y-3 pt-2 border-t border-border">
                    <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Audio Message Source</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAudioSource("file")}
                        className={cn(
                          "p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all",
                          audioSource === "file" ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 font-bold" : "bg-secondary/40 border-border text-muted-foreground"
                        )}
                      >
                        <Upload className="w-4 h-4" /> Upload Audio File (.mp3/.wav)
                      </button>
                      <button
                        type="button"
                        onClick={() => setAudioSource("voice_id")}
                        className={cn(
                          "p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all",
                          audioSource === "voice_id" ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 font-bold" : "bg-secondary/40 border-border text-muted-foreground"
                        )}
                      >
                        <Radio className="w-4 h-4" /> Existing Voice ID
                      </button>
                    </div>

                    {audioSource === "file" ? (
                      <div
                        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragActive(false);
                          if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
                        }}
                        className={cn(
                          "p-6 rounded-2xl border-2 border-dashed text-center transition-all cursor-pointer bg-secondary/20",
                          dragActive ? "border-cyan-400 bg-cyan-500/5" : "border-border hover:border-cyan-500/40"
                        )}
                        onClick={() => document.getElementById("voice-file-input")?.click()}
                      >
                        <input
                          id="voice-file-input"
                          type="file"
                          accept="audio/*,.mp3,.wav,.m4a"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
                        />
                        <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mx-auto mb-2">
                          <Upload className="w-6 h-6" />
                        </div>
                        <p className="text-xs font-bold text-foreground">
                          {selectedFile ? selectedFile.name : "Click to browse or drag audio here"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">MP3 or WAV files up to 15MB</p>

                        {audioPreviewUrl && (
                          <div className="mt-4 pt-3 border-t border-border flex items-center justify-center gap-3">
                            <audio ref={audioRef} src={audioPreviewUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={(e) => { e.stopPropagation(); toggleAudioPlay(); }}
                              className="rounded-xl text-xs gap-1.5 font-bold text-cyan-400 border-cyan-500/30"
                            >
                              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              {isPlaying ? "Pause Preview" : "Play Preview"}
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Input
                          value={voiceId}
                          onChange={(e) => setVoiceId(e.target.value)}
                          placeholder="e.g. 64f128e42f9a721389"
                          className="rounded-xl h-11 bg-secondary/50 font-mono text-xs"
                        />
                      </div>
                    )}
                  </div>

                  {/* Advanced Auto Scheduler */}
                  {renderAdvancedScheduleControl("cyan")}

                  {/* Submit Button */}
                  <motion.div whileTap={{ scale: 0.98 }}>
                    <Button
                      onClick={handleSendVoiceCampaign}
                      disabled={sending}
                      className="w-full h-12 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-cyan-500/25 gap-2 transition-all border-0"
                    >
                      {sending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Broadcasting to {getTargetRecipientCount()} Recipients...
                        </>
                      ) : (
                        <>
                          <PhoneCall className="w-4 h-4" /> {isSchedule ? "Schedule" : "Launch"} Voice Broadcast ({getTargetRecipientCount()} Calls)
                        </>
                      )}
                    </Button>
                  </motion.div>
                </div>
              </div>

              {/* Right Column: Live Summary */}
              <div className="space-y-6">
                <AnimatePresence>
                  {lastResult && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3"
                    >
                      <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                        <CheckCircle2 className="w-5 h-5" /> Campaign Successfully Placed
                      </div>
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <p><strong className="text-foreground">Campaign ID:</strong> <span className="font-mono text-emerald-400">{lastResult._id || "N/A"}</span></p>
                        <p><strong className="text-foreground">Voice ID:</strong> <span className="font-mono text-foreground">{lastResult.voice_id || "Saved for reuse"}</span></p>
                        <p><strong className="text-foreground">Calls Placed:</strong> <span className="font-bold text-foreground">{lastResult.total_sent || 0}</span></p>
                        <p><strong className="text-foreground">Credits Used:</strong> <span className="font-bold text-cyan-400">{lastResult.credit_used || 0} units</span></p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Information Card */}
                <div className="p-5 rounded-2xl bg-card border border-border shadow-sm space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
                    <Info className="w-4 h-4 text-cyan-400" /> How Voice Calls Work
                  </div>
                  <ul className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">1</span>
                      <span>mNotify automatically places phone calls to all selected recipient numbers simultaneously.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</span>
                      <span>When the customer answers, your uploaded voice message plays immediately.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</span>
                      <span>Audio files are assigned a permanent <strong className="text-foreground">Voice ID</strong> for instant 1-click reuse.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: QUICK BULK SMS */}
          {activeTab === "sms" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-black text-foreground flex items-center gap-2">
                      <Send className="w-5 h-5 text-emerald-500" /> mNotify Quick Bulk SMS
                    </h2>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActiveTab("templates")}
                      className="text-xs text-emerald-400 hover:text-emerald-300 gap-1"
                    >
                      <Bookmark className="w-3.5 h-3.5" /> Pick from Templates
                    </Button>
                  </div>

                  {/* Sender ID & SMS Type */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Sender ID (Max 11 chars)</label>
                      <Input
                        value={smsSenderId}
                        maxLength={11}
                        onChange={(e) => setSmsSenderId(e.target.value)}
                        placeholder="e.g. SwiftData"
                        className="rounded-xl h-11 bg-secondary/50 font-bold"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/40 border border-border mt-auto h-11">
                      <div>
                        <p className="text-xs font-bold text-foreground">OTP Priority Mode</p>
                        <p className="text-[10px] text-muted-foreground">Special routing for OTP alerts (GH₵0.035)</p>
                      </div>
                      <Switch
                        checked={isSmsOtp}
                        onCheckedChange={setIsSmsOtp}
                        className="data-[state=checked]:bg-emerald-500"
                      />
                    </div>
                  </div>

                  {renderAudienceGrid("emerald")}

                  {/* Message Content */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">SMS Message Content</label>
                      <div className="flex items-center gap-2">
                        {smsMessage.trim() && (
                          <button
                            type="button"
                            onClick={() => {
                              setNewTemplateTitle(smsMessage.slice(0, 30) + "...");
                              setNewTemplateContent(smsMessage);
                              setShowCreateTemplateModal(true);
                            }}
                            className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 font-bold"
                          >
                            <Bookmark className="w-3 h-3" /> Save as Template
                          </button>
                        )}
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {smsPageInfo.len} chars · page {smsPageInfo.page}
                        </span>
                      </div>
                    </div>
                    <Textarea
                      value={smsMessage}
                      onChange={(e) => setSmsMessage(e.target.value)}
                      placeholder="Type your message text here..."
                      rows={4}
                      className="rounded-xl bg-secondary/50 font-medium text-sm"
                    />
                    <Progress
                      value={smsPageInfo.fill}
                      className="h-1.5 bg-secondary"
                    />
                  </div>

                  {/* Advanced Auto Scheduler */}
                  {renderAdvancedScheduleControl("emerald")}

                  {/* Submit Button */}
                  <motion.div whileTap={{ scale: 0.98 }}>
                    <Button
                      onClick={handleSendQuickSms}
                      disabled={sending}
                      className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-emerald-500/25 gap-2 transition-all border-0"
                    >
                      {sending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Sending SMS to {getTargetRecipientCount()} Recipients...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" /> {isSchedule ? "Schedule" : "Dispatch"} Quick SMS ({getTargetRecipientCount()} Messages)
                        </>
                      )}
                    </Button>
                  </motion.div>
                </div>
              </div>

              {/* Right Column: Live Summary */}
              <div className="space-y-6">
                <AnimatePresence>
                  {lastSmsResult && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3"
                    >
                      <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                        <CheckCircle2 className="w-5 h-5" /> SMS Broadcast Successful
                      </div>
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <p><strong className="text-foreground">Campaign ID:</strong> <span className="font-mono text-emerald-400">{lastSmsResult._id || "N/A"}</span></p>
                        <p><strong className="text-foreground">Messages Sent:</strong> <span className="font-bold text-foreground">{lastSmsResult.total_sent || 0}</span></p>
                        <p><strong className="text-foreground">Credits Used:</strong> <span className="font-bold text-emerald-400">{lastSmsResult.credit_used || 0} units</span></p>
                        {lastSmsResult.credit_left !== undefined && (
                          <p><strong className="text-foreground">Remaining Credits:</strong> <span className="font-bold text-foreground">{lastSmsResult.credit_left}</span></p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="p-5 rounded-2xl bg-card border border-border shadow-sm space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
                    <Info className="w-4 h-4 text-emerald-400" /> mNotify SMS Features
                  </div>
                  <ul className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle2 className="w-3 h-3" />
                      </span>
                      <span>Supports up to 11 alphanumeric characters for your custom registered Sender ID.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle2 className="w-3 h-3" />
                      </span>
                      <span>Automatic GSM-7 paging with live character counting (160 characters per page).</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TEMPLATES MANAGEMENT */}
          {activeTab === "templates" && (
            <div className="space-y-6">
              {/* Top Banner with Create Template Button */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 rounded-2xl bg-card border border-border shadow-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-5 h-5 text-violet-400" />
                    <h2 className="text-base font-black text-foreground">Message & Voice Templates Library</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Save, manage, and sync reusable scripts with dynamic variable tags for both Voice Calls and SMS.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setShowCreateTemplateModal(true)}
                    className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-400 hover:to-purple-400 text-white font-bold text-xs gap-1.5 border-0 shadow-lg shadow-violet-500/25"
                  >
                    <Plus className="w-4 h-4" /> Add New Template
                  </Button>
                  <Button
                    variant="outline"
                    onClick={fetchBalanceAndTemplates}
                    disabled={loadingTemplates}
                    className="rounded-xl text-xs gap-1.5"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", loadingTemplates && "animate-spin")} /> Sync from mNotify
                  </Button>
                </div>
              </div>

              {/* Template Cards Grid */}
              {loadingTemplates ? (
                <div className="flex flex-col items-center justify-center p-16 gap-3 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                  <p className="text-xs font-medium">Syncing templates from mNotify...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {allDisplayTemplates.map((tmpl, idx) => {
                    const text = tmpl.content || tmpl.message || "";
                    const tmplId = tmpl.id || tmpl._id || idx;
                    const isSystem = String(tmplId).startsWith("system-");
                    const wordsCount = text.trim() ? text.trim().split(/\s+/).length : 0;
                    const estSec = Math.max(5, Math.round(wordsCount * 0.45));

                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(idx, 8) * 0.04 }}
                        className="relative p-5 rounded-2xl bg-card border border-border shadow-sm space-y-4 flex flex-col justify-between overflow-hidden hover:-translate-y-1 hover:shadow-md transition-all duration-300 group"
                      >
                        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-purple-500" />

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[10px] font-black">
                                {tmpl.category || "General"}
                              </Badge>
                              {isSystem && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                  System Preset
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => copyTemplateContent(tmplId, text)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                                title="Copy Template"
                              >
                                {copiedId === tmplId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              {!isSystem && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTemplate(tmplId)}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  title="Delete Template"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          <h3 className="font-bold text-foreground text-sm leading-snug">
                            {tmpl.title || tmpl.template_name || `Template #${tmpl.id}`}
                          </h3>

                          {text && (
                            <p className="text-xs text-muted-foreground line-clamp-3 bg-secondary/30 p-3 rounded-xl font-medium leading-relaxed">
                              {text}
                            </p>
                          )}

                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
                            <span>{text.length} chars</span>
                            <span>·</span>
                            <span>{wordsCount} words</span>
                            <span>·</span>
                            <span className="text-cyan-400">~{estSec}s voice</span>
                          </div>
                        </div>

                        {/* 1-Click Action Buttons */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCampaignTitle(tmpl.title || "Voice Broadcast");
                              setVoiceId(tmpl.voice_id || String(tmpl.id || ""));
                              setAudioSource("voice_id");
                              setActiveTab("broadcast");
                              toast({ title: "Template Loaded into Voice Broadcast" });
                            }}
                            className="rounded-xl text-[11px] font-bold text-cyan-400 hover:bg-cyan-500/10 border-cyan-500/20"
                          >
                            <Volume2 className="w-3 h-3 mr-1" /> Use Voice
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSmsMessage(text);
                              setActiveTab("sms");
                              toast({ title: "Template Loaded into Quick SMS" });
                            }}
                            className="rounded-xl text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/20"
                          >
                            <Send className="w-3 h-3 mr-1" /> Use SMS
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Create Template Modal */}
              <Dialog open={showCreateTemplateModal} onOpenChange={setShowCreateTemplateModal}>
                <DialogContent className="sm:max-w-lg rounded-2xl bg-card border-border">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base font-black text-foreground">
                      <Bookmark className="w-5 h-5 text-violet-400" /> Create & Save Template
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                      Save a reusable notification template directly to your mNotify account.
                    </DialogDescription>
                  </DialogHeader>

                  <form onSubmit={handleSaveTemplate} className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Template Title</label>
                      <Input
                        value={newTemplateTitle}
                        onChange={(e) => setNewTemplateTitle(e.target.value)}
                        placeholder="e.g. MTN Network Delay Notice"
                        required
                        className="rounded-xl h-11 bg-secondary/50 font-bold"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Category Tag</label>
                        <Input
                          value={newTemplateCategory}
                          onChange={(e) => setNewTemplateCategory(e.target.value)}
                          placeholder="e.g. Promotions"
                          className="rounded-xl h-10 bg-secondary/50 text-xs"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Target Type</label>
                        <select
                          value={newTemplateType}
                          onChange={(e: any) => setNewTemplateType(e.target.value)}
                          className="w-full h-10 rounded-xl bg-secondary/50 border border-input text-xs font-bold px-3 text-foreground"
                        >
                          <option value="both">Both SMS & Voice</option>
                          <option value="sms">Quick SMS Only</option>
                          <option value="voice">Voice Broadcast Only</option>
                        </select>
                      </div>
                    </div>

                    {/* Content & Dynamic Variables */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Message Content / Voice Script</label>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {newTemplateContent.length} chars
                        </span>
                      </div>
                      <Textarea
                        value={newTemplateContent}
                        onChange={(e) => setNewTemplateContent(e.target.value)}
                        placeholder="Enter template message text here..."
                        rows={4}
                        required
                        className="rounded-xl bg-secondary/50 font-medium text-xs"
                      />

                      {/* Variable Chips */}
                      <div className="pt-1.5 space-y-1">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Insert Dynamic Variable Tags:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {["name", "phone", "balance", "date", "store_name"].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => insertVariableIntoTemplate(tag)}
                              className="px-2 py-0.5 rounded-lg bg-secondary border border-border text-[10px] font-mono text-violet-400 hover:bg-violet-500/10 transition-colors"
                            >
                              + {`{{${tag}}}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <DialogFooter className="pt-3 border-t border-border">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowCreateTemplateModal(false)}
                        className="rounded-xl text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={creatingTemplate}
                        className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-bold text-xs gap-1.5 border-0"
                      >
                        {creatingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5" />}
                        Save & Sync to mNotify
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* TAB: SENDER ID REGISTRATION */}
          {activeTab === "sender_id" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-4">
                <h2 className="text-base font-black text-foreground flex items-center gap-2">
                  <Radio className="w-5 h-5 text-amber-500" /> Register New Sender ID
                </h2>
                <p className="text-xs text-muted-foreground">
                  Submit your desired Sender ID to mNotify for telecom regulatory approval.
                </p>
                <form onSubmit={handleRegisterSenderId} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Sender Name (Max 11 chars)</label>
                    <Input
                      value={regSenderName}
                      maxLength={11}
                      onChange={(e) => setRegSenderName(e.target.value)}
                      placeholder="e.g. SwiftData"
                      required
                      className="rounded-xl h-11 bg-secondary/50 font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Registration Purpose</label>
                    <Textarea
                      value={regPurpose}
                      onChange={(e) => setRegPurpose(e.target.value)}
                      placeholder="Reason for registering the sender id (e.g. For Sending Transactional & Order Alerts)"
                      rows={3}
                      required
                      className="rounded-xl bg-secondary/50 text-xs"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={registeringSender}
                    className="w-full h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-xs gap-2 border-0"
                  >
                    {registeringSender ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Submit Sender ID Registration
                  </Button>
                </form>
              </div>

              {/* Check Sender ID Status */}
              <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-4">
                <h2 className="text-base font-black text-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" /> Check Sender ID Status
                </h2>
                <p className="text-xs text-muted-foreground">
                  Verify if your registered Sender ID has been approved on mNotify.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Registered Sender Name</label>
                    <Input
                      value={checkSenderName}
                      onChange={(e) => setCheckSenderName(e.target.value)}
                      placeholder="e.g. SwiftData"
                      className="rounded-xl h-11 bg-secondary/50 font-bold"
                    />
                  </div>
                  <Button
                    onClick={handleCheckSenderStatus}
                    disabled={registeringSender || !checkSenderName.trim()}
                    variant="outline"
                    className="w-full h-11 rounded-xl font-bold text-xs gap-2 border-input bg-card"
                  >
                    {registeringSender ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Check Status
                  </Button>

                  <AnimatePresence>
                    {senderCheckResult && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 rounded-xl bg-secondary/40 border border-border space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-muted-foreground">Status Result</p>
                          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px] font-black">
                            {senderCheckResult.status || senderCheckResult["sender name status"] || "Approved"}
                          </Badge>
                        </div>
                        <Collapsible>
                          <CollapsibleTrigger className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-colors group">
                            <ChevronDown className="w-3 h-3 transition-transform group-data-[state=open]:rotate-180" />
                            View raw response
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto p-2.5 mt-2 bg-secondary/80 rounded-lg">
                              {JSON.stringify(senderCheckResult, null, 2)}
                            </pre>
                          </CollapsibleContent>
                        </Collapsible>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}

          {/* TAB: SETTINGS & CREDENTIALS */}
          {activeTab === "settings" && (
            <div className="max-w-xl space-y-6">
              <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-4">
                <h2 className="text-base font-black text-foreground flex items-center gap-2">
                  <Key className="w-5 h-5 text-slate-400" /> mNotify API Configuration
                </h2>
                <p className="text-xs text-muted-foreground">
                  Pass your mNotify API Key (found in your mNotify dashboard under <strong className="text-foreground">Developer &gt; API v2.0</strong>).
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">mNotify API Key</label>
                  <div className="relative">
                    <Input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Enter mNotify API Key..."
                      className="rounded-xl h-11 bg-secondary/50 font-mono text-xs pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Info className="w-3 h-3" /> Leave blank to use the platform's default configured key.
                  </p>
                </div>

                <Button
                  onClick={() => {
                    fetchBalanceAndTemplates();
                    toast({ title: "Testing Connection...", description: "Querying mNotify balance and templates." });
                  }}
                  disabled={loadingTemplates}
                  className="rounded-xl bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 text-white font-bold text-xs gap-2 border-0"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Test Connection & Fetch Balance
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
