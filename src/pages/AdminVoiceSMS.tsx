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
  Music,
  Headphones,
  Save,
  ShoppingBag,
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
  _id?: string;
  title?: string;
  template_name?: string;
  name?: string;
  content?: string;
  message?: string;
  voice_id?: string;
  type?: "sms" | "voice" | "both";
  category?: string;
  created_at?: string;
  // Audio specific properties
  is_audio_template?: boolean;
  audio_url?: string;
  audio_base64?: string;
  file_name?: string;
  file_size?: number;
  duration_sec?: number;
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
  { id: "templates", label: "Templates & Audio", icon: Bookmark, accent: "violet" },
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
  const [targetType, setTargetType] = useState<"all_customers" | "order_buyers" | "all_users" | "agents" | "sub_agents" | "custom">("all_customers");
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
  const [audioTemplates, setAudioTemplates] = useState<MnotifyTemplate[]>([]);
  const [templateFilter, setTemplateFilter] = useState<"all" | "audio" | "text">("all");
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Create Template Modal State
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [templateCreationMode, setTemplateCreationMode] = useState<"text" | "audio">("audio");
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");
  const [newTemplateCategory, setNewTemplateCategory] = useState("Promotions");
  const [newTemplateType, setNewTemplateType] = useState<"sms" | "voice" | "both">("both");
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);

  // Modal Audio Upload State
  const [modalAudioFile, setModalAudioFile] = useState<File | null>(null);
  const [modalAudioBase64, setModalAudioBase64] = useState<string | null>(null);
  const [modalAudioPreviewUrl, setModalAudioPreviewUrl] = useState<string | null>(null);
  const [modalAudioPlaying, setModalAudioPlaying] = useState(false);
  const modalAudioRef = useRef<HTMLAudioElement | null>(null);

  // Template Cards Playback State
  const [activePlayingId, setActivePlayingId] = useState<string | number | null>(null);
  const cardAudioRef = useRef<HTMLAudioElement | null>(null);

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
  const [counts, setCounts] = useState<{
    allCustomers: number;
    orderBuyers: number;
    allUsers: number;
    agents: number;
    subAgents: number;
  }>({
    allCustomers: 19545,
    orderBuyers: 19455,
    allUsers: 498,
    agents: 359,
    subAgents: 13,
  });

  // Load Saved Audio Templates from LocalStorage & Supabase
  useEffect(() => {
    loadSavedAudioTemplates();
    fetchAudienceCounts();
    fetchBalanceAndTemplates();
  }, []);

  const loadSavedAudioTemplates = () => {
    try {
      const saved = localStorage.getItem("swiftdata_saved_audio_templates");
      if (saved) {
        setAudioTemplates(JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Failed to load local audio templates:", e);
    }
  };

  const saveAudioTemplatesToStorage = (updatedList: MnotifyTemplate[]) => {
    setAudioTemplates(updatedList);
    try {
      localStorage.setItem("swiftdata_saved_audio_templates", JSON.stringify(updatedList));
    } catch (e) {
      console.warn("Failed to save audio templates to local storage:", e);
    }
  };

  const fetchAudienceCounts = async () => {
    if (!session?.access_token) return;
    try {
      const { data, error } = await supabase.functions.invoke("mnotify-voice", {
        body: { action: "get_audience_counts" },
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (data?.success && data?.counts) {
        setCounts({
          allCustomers: data.counts.all_customers || 19545,
          orderBuyers: data.counts.order_buyers || 19455,
          allUsers: data.counts.all_users || 498,
          agents: data.counts.agents || 359,
          subAgents: data.counts.sub_agents || 13,
        });
      }
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

  // ── Template Handlers (Text & Audio) ────────────────────────────────
  const handleSaveTemplate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (templateCreationMode === "audio") {
      if (!newTemplateTitle.trim()) {
        toast({ title: "Template Title Required", description: "Please name this audio template.", variant: "destructive" });
        return;
      }
      if (!modalAudioFile || !modalAudioBase64) {
        toast({ title: "Audio File Required", description: "Please upload an audio file to save.", variant: "destructive" });
        return;
      }

      setCreatingTemplate(true);
      try {
        // 1. Upload to Supabase Storage
        const fileExt = modalAudioFile.name.split(".").pop() || "mp3";
        const filePath = `templates/${Date.now()}_${modalAudioFile.name.replace(/[^a-zA-Z0-9._-]/g, "")}`;

        const { error: uploadError } = await supabase.storage
          .from("voice-broadcasts")
          .upload(filePath, modalAudioFile, { upsert: true, contentType: modalAudioFile.type || "audio/mpeg" });

        let publicUrl = modalAudioPreviewUrl || "";
        if (!uploadError) {
          const { data: pubUrlData } = supabase.storage.from("voice-broadcasts").getPublicUrl(filePath);
          if (pubUrlData?.publicUrl) publicUrl = pubUrlData.publicUrl;
        }

        const newAudioItem: MnotifyTemplate = {
          id: `audio-${Date.now()}`,
          title: newTemplateTitle.trim(),
          category: newTemplateCategory.trim() || "Voice Audio",
          type: "voice",
          is_audio_template: true,
          audio_url: publicUrl,
          audio_base64: modalAudioBase64,
          file_name: modalAudioFile.name,
          file_size: modalAudioFile.size,
          created_at: new Date().toISOString(),
        };

        const updated = [newAudioItem, ...audioTemplates];
        saveAudioTemplatesToStorage(updated);

        toast({
          title: "Audio Template Saved! 🎙️",
          description: `"${newTemplateTitle}" is saved and ready to broadcast anytime.`
        });

        setNewTemplateTitle("");
        setModalAudioFile(null);
        setModalAudioBase64(null);
        setModalAudioPreviewUrl(null);
        setShowCreateTemplateModal(false);
      } catch (err: any) {
        toast({ title: "Failed to Save Audio", description: err.message, variant: "destructive" });
      } finally {
        setCreatingTemplate(false);
      }

    } else {
      // Text Script Mode
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
    }
  };

  const handleSaveUploadedAudioAsTemplate = () => {
    if (!selectedFile || !audioBase64) {
      toast({ title: "No Audio File Uploaded", description: "Please upload an audio file first.", variant: "destructive" });
      return;
    }

    setNewTemplateTitle(campaignTitle || selectedFile.name.replace(/\.[^/.]+$/, ""));
    setModalAudioFile(selectedFile);
    setModalAudioBase64(audioBase64);
    setModalAudioPreviewUrl(audioPreviewUrl);
    setTemplateCreationMode("audio");
    setShowCreateTemplateModal(true);
  };

  const handleDeleteTemplate = async (templateId: string | number) => {
    if (String(templateId).startsWith("audio-")) {
      if (!confirm("Are you sure you want to delete this saved voice audio template?")) return;
      const updated = audioTemplates.filter((t) => t.id !== templateId);
      saveAudioTemplatesToStorage(updated);
      toast({ title: "Audio Template Deleted" });
      return;
    }

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

  const processModalFile = (file: File) => {
    if (!file.type.startsWith("audio/") && !file.name.endsWith(".mp3") && !file.name.endsWith(".wav") && !file.name.endsWith(".m4a")) {
      toast({ title: "Invalid File Type", description: "Please upload an MP3 or WAV audio file.", variant: "destructive" });
      return;
    }

    setModalAudioFile(file);
    const url = URL.createObjectURL(file);
    setModalAudioPreviewUrl(url);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const base64Data = result.split(",")[1];
      setModalAudioBase64(base64Data);
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

  const toggleCardAudio = (id: string | number, url?: string) => {
    if (!url) return;
    if (activePlayingId === id) {
      cardAudioRef.current?.pause();
      setActivePlayingId(null);
    } else {
      if (cardAudioRef.current) {
        cardAudioRef.current.src = url;
        cardAudioRef.current.play();
        setActivePlayingId(id);
      }
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
    if (targetType === "all_customers") return counts.allCustomers;
    if (targetType === "order_buyers") return counts.orderBuyers;
    if (targetType === "all_users") return counts.allUsers;
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
      toast({ title: "Audio File Missing", description: "Please upload or select a recorded audio file.", variant: "destructive" });
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

      if (audioSource === "file" && audioBase64) {
        payload.audio_base64 = audioBase64;
        payload.audio_filename = selectedFile?.name || "voice_message.mp3";
        payload.audio_mimetype = selectedFile?.type || "audio/mpeg";
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
      { id: "all_customers", label: "All Contacts (Profiles + Buyers)", count: counts.allCustomers, icon: Users, badge: "🔥 Max Reach" },
      { id: "order_buyers", label: "Past Order Buyers", count: counts.orderBuyers, icon: ShoppingBag, badge: "Data & Airtime" },
      { id: "all_users", label: "Registered Users", count: counts.allUsers, icon: UserCheck, badge: "Profiles" },
      { id: "agents", label: "Storefront Agents", count: counts.agents, icon: ShieldCheck, badge: "Resellers" },
      { id: "sub_agents", label: "Sub-Agents", count: counts.subAgents, icon: UserPlus, badge: "Affiliates" },
      { id: "custom", label: "Custom Phone(s)", count: parsedRecipients().length, icon: Phone, badge: "Manual List" },
    ] as const;

    return (
      <div className="space-y-2">
        <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Select Target Audience</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {options.map((target) => {
            const isActive = targetType === target.id;
            return (
              <button
                key={target.id}
                type="button"
                onClick={() => setTargetType(target.id)}
                className={cn(
                  "relative p-3.5 rounded-xl border text-left transition-all overflow-hidden group flex flex-col justify-between min-h-[82px]",
                  isActive
                    ? cn(a.bgSoft, a.borderSoft, "font-bold shadow-sm")
                    : "bg-secondary/40 border-border text-muted-foreground hover:bg-secondary hover:border-border"
                )}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <target.icon className={cn("w-4 h-4", isActive ? a.text : "text-muted-foreground/70 group-hover:text-foreground")} />
                    {target.badge && (
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.2 rounded font-bold uppercase",
                        isActive ? cn(a.bgSoft, a.text, "border", a.borderSoft) : "bg-secondary text-muted-foreground"
                      )}>
                        {target.badge}
                      </span>
                    )}
                  </div>
                  <p className={cn("text-xs font-black leading-tight", isActive ? a.text : "text-foreground")}>{target.label}</p>
                </div>
                <p className="text-[11px] font-mono opacity-80 mt-1">{target.count.toLocaleString()} contacts</p>
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

  // Filtered Templates List
  const allTemplatesCombined = [
    ...audioTemplates,
    ...templates,
    ...CURATED_SYSTEM_TEMPLATES.filter((st) => !templates.some((t) => (t.title || t.template_name) === st.title))
  ];

  const filteredTemplates = allTemplatesCombined.filter((tmpl) => {
    if (templateFilter === "audio") return tmpl.is_audio_template || tmpl.type === "voice";
    if (templateFilter === "text") return !tmpl.is_audio_template;
    return true;
  });

  return (
    <div className="space-y-6 pb-24 max-w-6xl mx-auto">
      {/* Hidden audio element for template card playbacks */}
      <audio ref={cardAudioRef} onEnded={() => setActivePlayingId(null)} className="hidden" />

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
            Direct telecommunications engine for Voice Broadcasting, Bulk SMS, Audio Libraries, and Timed Scheduling.
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
                  {allTemplatesCombined.length}
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
                      onClick={() => {
                        setTemplateFilter("audio");
                        setActiveTab("templates");
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 gap-1"
                    >
                      <Headphones className="w-3.5 h-3.5" /> Pick from Audio Library
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
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Audio Message Source</label>
                      {selectedFile && audioBase64 && (
                        <button
                          type="button"
                          onClick={handleSaveUploadedAudioAsTemplate}
                          className="text-[11px] font-bold text-cyan-400 hover:underline flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" /> Save Audio as Reusable Template
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAudioSource("file")}
                        className={cn(
                          "p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all",
                          audioSource === "file" ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 font-bold" : "bg-secondary/40 border-border text-muted-foreground"
                        )}
                      >
                        <Upload className="w-4 h-4" /> Upload / Select Audio (.mp3/.wav)
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
                          {selectedFile ? selectedFile.name : "Click to browse or drag audio file here"}
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
                      <span>mNotify automatically dials recipient numbers across MTN, Telecel, and AirtelTigo.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</span>
                      <span>When the customer answers, your uploaded voice message plays immediately with high audio clarity.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</span>
                      <span>Save any audio into your template library to broadcast anytime with a single click.</span>
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
                      onClick={() => {
                        setTemplateFilter("text");
                        setActiveTab("templates");
                      }}
                      className="text-xs text-emerald-400 hover:text-emerald-300 gap-1"
                    >
                      <Bookmark className="w-3.5 h-3.5" /> Pick from Text Templates
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
                              setTemplateCreationMode("text");
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

          {/* TAB 3: TEMPLATES & AUDIO LIBRARY */}
          {activeTab === "templates" && (
            <div className="space-y-6">
              {/* Top Banner with Filters and Add Button */}
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl bg-card border border-border shadow-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-5 h-5 text-violet-400" />
                    <h2 className="text-base font-black text-foreground">Message & Audio Templates Library</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Save, preview, and broadcast reusable Voice Audio Files and SMS notification scripts.
                  </p>
                </div>

                <div className="flex items-center flex-wrap gap-2">
                  {/* Filter Pills */}
                  <div className="flex items-center p-1 bg-secondary/50 rounded-xl border border-border">
                    {[
                      { id: "all", label: "All" },
                      { id: "audio", label: "🎙️ Voice Audios" },
                      { id: "text", label: "✉️ SMS Scripts" },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setTemplateFilter(f.id as any)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                          templateFilter === f.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <Button
                    onClick={() => {
                      setTemplateCreationMode("audio");
                      setShowCreateTemplateModal(true);
                    }}
                    className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-400 hover:to-purple-400 text-white font-bold text-xs gap-1.5 border-0 shadow-lg shadow-violet-500/25"
                  >
                    <Plus className="w-4 h-4" /> Add Template / Audio
                  </Button>

                  <Button
                    variant="outline"
                    onClick={fetchBalanceAndTemplates}
                    disabled={loadingTemplates}
                    className="rounded-xl text-xs gap-1.5"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", loadingTemplates && "animate-spin")} /> Sync mNotify
                  </Button>
                </div>
              </div>

              {/* Template Cards Grid */}
              {loadingTemplates ? (
                <div className="flex flex-col items-center justify-center p-16 gap-3 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                  <p className="text-xs font-medium">Syncing templates from mNotify & storage...</p>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="p-12 text-center rounded-2xl bg-card border border-border space-y-3">
                  <FileAudio className="w-10 h-10 text-muted-foreground mx-auto" />
                  <p className="text-sm font-bold text-foreground">No templates found for this filter</p>
                  <p className="text-xs text-muted-foreground">Click "Add Template / Audio" above to save your first reusable broadcast.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredTemplates.map((tmpl, idx) => {
                    const text = tmpl.content || tmpl.message || "";
                    const tmplId = tmpl.id || tmpl._id || idx;
                    const isAudio = tmpl.is_audio_template;
                    const isSystem = String(tmplId).startsWith("system-");
                    const wordsCount = text.trim() ? text.trim().split(/\s+/).length : 0;
                    const estSec = tmpl.duration_sec || Math.max(5, Math.round(wordsCount * 0.45));
                    const isCardPlaying = activePlayingId === tmplId;

                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: Math.min(idx, 8) * 0.04 }}
                        className={cn(
                          "relative p-5 rounded-2xl bg-card border shadow-sm space-y-4 flex flex-col justify-between overflow-hidden hover:-translate-y-1 hover:shadow-md transition-all duration-300 group",
                          isAudio ? "border-cyan-500/30" : "border-border"
                        )}
                      >
                        <div className={cn(
                          "absolute inset-x-0 top-0 h-1 bg-gradient-to-r",
                          isAudio ? "from-cyan-500 to-blue-500" : "from-violet-500 to-purple-500"
                        )} />

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {isAudio ? (
                                <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[10px] font-black gap-1">
                                  <Volume2 className="w-3 h-3" /> Voice Audio
                                </Badge>
                              ) : (
                                <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[10px] font-black">
                                  {tmpl.category || "General"}
                                </Badge>
                              )}
                              {isSystem && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                  System Preset
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {!isAudio && text && (
                                <button
                                  type="button"
                                  onClick={() => copyTemplateContent(tmplId, text)}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                                  title="Copy Template"
                                >
                                  {copiedId === tmplId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              )}
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

                          {/* Audio Template Player Card */}
                          {isAudio ? (
                            <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-foreground truncate max-w-[160px]">
                                  {tmpl.file_name || "voice_recording.mp3"}
                                </span>
                                {tmpl.file_size && (
                                  <span className="text-[10px] font-mono text-muted-foreground">
                                    {(tmpl.file_size / 1024 / 1024).toFixed(2)} MB
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => toggleCardAudio(tmplId, tmpl.audio_url || tmpl.audio_base64 ? `data:audio/mpeg;base64,${tmpl.audio_base64}` : undefined)}
                                  className="rounded-xl text-xs gap-1.5 font-bold text-cyan-400 border-cyan-500/30 h-8 px-3"
                                >
                                  {isCardPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                  {isCardPlaying ? "Pause" : "Play Audio"}
                                </Button>
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  Ready to broadcast
                                </span>
                              </div>
                            </div>
                          ) : (
                            text && (
                              <p className="text-xs text-muted-foreground line-clamp-3 bg-secondary/30 p-3 rounded-xl font-medium leading-relaxed">
                                {text}
                              </p>
                            )
                          )}

                          {!isAudio && (
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
                              <span>{text.length} chars</span>
                              <span>·</span>
                              <span>{wordsCount} words</span>
                              <span>·</span>
                              <span className="text-cyan-400">~{estSec}s voice</span>
                            </div>
                          )}
                        </div>

                        {/* 1-Click Action Buttons */}
                        <div className="pt-2 border-t border-border/50">
                          {isAudio ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                setCampaignTitle(tmpl.title || "Voice Broadcast");
                                if (tmpl.audio_base64) setAudioBase64(tmpl.audio_base64);
                                if (tmpl.audio_url) setAudioPreviewUrl(tmpl.audio_url);
                                if (tmpl.file_name) setSelectedFile(new File([], tmpl.file_name));
                                setAudioSource("file");
                                setActiveTab("broadcast");
                                toast({
                                  title: "Voice Audio Loaded! 🎙️",
                                  description: `"${tmpl.title}" is ready to broadcast in the Voice tab.`
                                });
                              }}
                              className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white text-xs font-bold shadow-md shadow-cyan-500/20 border-0"
                            >
                              <Volume2 className="w-3.5 h-3.5 mr-1.5" /> Broadcast This Audio Now
                            </Button>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
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
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Create Template & Upload Audio Modal */}
              <Dialog open={showCreateTemplateModal} onOpenChange={setShowCreateTemplateModal}>
                <DialogContent className="sm:max-w-lg rounded-2xl bg-card border-border">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base font-black text-foreground">
                      <Bookmark className="w-5 h-5 text-violet-400" /> Save New Broadcast Template
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                      Create and save a reusable Voice Audio File or Text Script for future broadcasts.
                    </DialogDescription>
                  </DialogHeader>

                  {/* Mode Selector */}
                  <div className="grid grid-cols-2 gap-2 p-1 bg-secondary/50 rounded-xl border border-border my-1">
                    <button
                      type="button"
                      onClick={() => setTemplateCreationMode("audio")}
                      className={cn(
                        "py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all",
                        templateCreationMode === "audio" ? "bg-card text-cyan-400 shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      <Volume2 className="w-3.5 h-3.5" /> Voice Audio File (.mp3/.wav)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemplateCreationMode("text")}
                      className={cn(
                        "py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all",
                        templateCreationMode === "text" ? "bg-card text-violet-400 shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      <FileText className="w-3.5 h-3.5" /> SMS / Text Script
                    </button>
                  </div>

                  <form onSubmit={handleSaveTemplate} className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Template Name</label>
                      <Input
                        value={newTemplateTitle}
                        onChange={(e) => setNewTemplateTitle(e.target.value)}
                        placeholder={templateCreationMode === "audio" ? "e.g. Welcome Call Audio" : "e.g. Flash Promo SMS"}
                        required
                        className="rounded-xl h-11 bg-secondary/50 font-bold"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Category Tag</label>
                      <Input
                        value={newTemplateCategory}
                        onChange={(e) => setNewTemplateCategory(e.target.value)}
                        placeholder="e.g. Promotions, Alerts, Maintenance"
                        className="rounded-xl h-10 bg-secondary/50 text-xs"
                      />
                    </div>

                    {/* Mode 1: Audio Upload */}
                    {templateCreationMode === "audio" ? (
                      <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Upload Audio File (.mp3, .wav, .m4a)</label>
                        <div
                          className="p-5 rounded-2xl border-2 border-dashed border-border hover:border-cyan-500/40 text-center cursor-pointer bg-secondary/20 transition-all"
                          onClick={() => document.getElementById("modal-audio-file-input")?.click()}
                        >
                          <input
                            id="modal-audio-file-input"
                            type="file"
                            accept="audio/*,.mp3,.wav,.m4a"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && processModalFile(e.target.files[0])}
                          />
                          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mx-auto mb-2">
                            <Upload className="w-5 h-5" />
                          </div>
                          <p className="text-xs font-bold text-foreground">
                            {modalAudioFile ? modalAudioFile.name : "Click to select audio file"}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">MP3 or WAV files up to 15MB</p>

                          {modalAudioPreviewUrl && (
                            <div className="mt-3 pt-2 border-t border-border flex items-center justify-center gap-2">
                              <audio
                                ref={modalAudioRef}
                                src={modalAudioPreviewUrl}
                                onEnded={() => setModalAudioPlaying(false)}
                                className="hidden"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (modalAudioRef.current) {
                                    if (modalAudioPlaying) {
                                      modalAudioRef.current.pause();
                                      setModalAudioPlaying(false);
                                    } else {
                                      modalAudioRef.current.play();
                                      setModalAudioPlaying(true);
                                    }
                                  }
                                }}
                                className="rounded-xl text-xs gap-1 font-bold text-cyan-400 border-cyan-500/30 h-7"
                              >
                                {modalAudioPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                {modalAudioPlaying ? "Pause Preview" : "Play Preview"}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* Mode 2: Text Script */
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Message Content</label>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {newTemplateContent.length} chars
                          </span>
                        </div>
                        <Textarea
                          value={newTemplateContent}
                          onChange={(e) => setNewTemplateContent(e.target.value)}
                          placeholder="Enter message text..."
                          rows={4}
                          required
                          className="rounded-xl bg-secondary/50 font-medium text-xs"
                        />

                        {/* Variable Chips */}
                        <div className="pt-1 space-y-1">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase">Dynamic Tags:</p>
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
                    )}

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
                        className={cn(
                          "rounded-xl text-white font-bold text-xs gap-1.5 border-0 shadow-md",
                          templateCreationMode === "audio"
                            ? "bg-gradient-to-r from-cyan-500 to-blue-500 shadow-cyan-500/20"
                            : "bg-gradient-to-r from-violet-500 to-purple-500 shadow-violet-500/20"
                        )}
                      >
                        {creatingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {templateCreationMode === "audio" ? "Save Voice Audio Template" : "Save & Sync to mNotify"}
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
