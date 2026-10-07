import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Sparkles, Upload, Send, Clock, Calendar, Search, RefreshCw, Trash2,
  CheckCircle2, AlertCircle, Copy, Check, MessageSquare, ExternalLink,
  Smartphone, Filter, Radio, Image as ImageIcon, Flame, Zap, Shield, Play
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StickerItem {
  name: string;
  title: string;
  category: string;
  webpUrl: string;
  pngUrl: string;
  sizeBytes?: number;
  createdAt?: string;
}

interface ScheduledPost {
  id: string;
  title: string;
  target_type: string;
  recipient_phone: string;
  message: string;
  sticker_url: string;
  image_url: string;
  scheduled_for: string;
  status: "scheduled" | "sent" | "failed" | "cancelled" | "pending";
  created_at: string;
  sent_at?: string;
  repeat_frequency?: string;
}

const CATEGORIES = [
  "All",
  "Greeting",
  "Fulfillment",
  "Orders",
  "Promotions",
  "Hype",
  "Memes",
  "Reactions",
  "Support",
  "Night Mode"
];

const PRESET_MESSAGES = [
  {
    label: "☀️ Good Morning",
    title: "Good Morning SwiftData!",
    message: "Good morning from SwiftData! ☀️⚡ Have a productive and blessed day ahead. Delivery is 100% active on all networks! 🇬🇭",
    sticker: "good_morning"
  },
  {
    label: "🛵 Delivery Fire",
    title: "⚡ Delivery Is On Fire!",
    message: "🔥 DELIVERY IS ON FIRE! 🛵 All MTN, Telecel & AT bundles arriving in under 2 minutes! Order from your store now.",
    sticker: "fast_delivery_ongoing"
  },
  {
    label: "🎁 Keep Orders Coming",
    title: "Keep Orders Coming!",
    message: "📦 Our automated dispatch engine is active 24/7! Top up your wallet and keep your sales flowing 🚀",
    sticker: "keep_orders_coming"
  },
  {
    label: "⚡ 24/7 Active Support",
    title: "24/7 Support Serving",
    message: "⚡ Need help or quick data fulfillment? SwiftData is active 24/7 serving you with instant wholesale bundles!",
    sticker: "serving_24_7"
  },
  {
    label: "🔥 Weekend Rush",
    title: "Weekend Data Rush!",
    message: "🚀 Weekend Data Rush! Stock up on cheap MTN & Telecel data for your streaming, games & church live streams! 📱⚡",
    sticker: "fire_stickman"
  }
];

export default function AdminStickers() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"library" | "schedule" | "queue">("library");
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [loadingStickers, setLoadingStickers] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [processedCanvasUrl, setProcessedCanvasUrl] = useState<string | null>(null);
  const [stickerTitle, setStickerTitle] = useState("");
  const [stickerCategory, setStickerCategory] = useState("Greeting");
  const [autoTransparent, setAutoTransparent] = useState(true);
  const [colorTolerance, setColorTolerance] = useState(25);
  const [isUploading, setIsUploading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Quick Send Dialog state
  const [quickSendOpen, setQuickSendOpen] = useState(false);
  const [targetSticker, setTargetSticker] = useState<StickerItem | null>(null);
  const [quickDestination, setQuickDestination] = useState<"channel" | "direct">("channel");
  const [quickCustomPhone, setQuickCustomPhone] = useState("");
  const [quickCaption, setQuickCaption] = useState("");
  const [isSendingQuick, setIsSendingQuick] = useState(false);

  // Scheduler Form state
  const [schedTitle, setSchedTitle] = useState("Daily Motivation & Data Promo");
  const [schedTarget, setSchedTarget] = useState<"channel" | "all_customers" | "custom">("channel");
  const [schedCustomPhone, setSchedCustomPhone] = useState("");
  const [schedSticker, setSchedSticker] = useState<StickerItem | null>(null);
  const [schedMessage, setSchedMessage] = useState("Good morning from SwiftData! ☀️⚡ Have a productive and blessed day ahead. All networks are fulfilling instantly!");
  const [schedTiming, setSchedTiming] = useState<"now" | "later">("later");
  const [schedDateTime, setSchedDateTime] = useState("");
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  // Queue state
  const [queueItems, setQueueItems] = useState<ScheduledPost[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  // Initialize schedule date/time to tomorrow 08:00 AM
  useEffect(() => {
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    tmrw.setHours(8, 0, 0, 0);
    // Format YYYY-MM-DDTHH:mm
    const pad = (n: number) => n < 10 ? `0${n}` : `${n}`;
    const isoLocal = `${tmrw.getFullYear()}-${pad(tmrw.getMonth() + 1)}-${pad(tmrw.getDate())}T${pad(tmrw.getHours())}:${pad(tmrw.getMinutes())}`;
    setSchedDateTime(isoLocal);
  }, []);

  // Fetch Stickers from Supabase Storage
  const fetchStickers = async () => {
    setLoadingStickers(true);
    try {
      const { data, error } = await supabase.storage.from("stickers").list("", {
        limit: 100,
        sortBy: { column: "name", order: "asc" }
      });

      if (error) throw error;

      // Group webp and png files
      const grouped = new Map<string, { webp?: string; png?: string; size?: number; created?: string }>();
      (data || []).forEach(file => {
        const dotIdx = file.name.lastIndexOf(".");
        if (dotIdx === -1) return;
        const base = file.name.substring(0, dotIdx);
        const ext = file.name.substring(dotIdx + 1).toLowerCase();
        const prev = grouped.get(base) || {};
        if (ext === "webp") prev.webp = file.name;
        if (ext === "png") prev.png = file.name;
        prev.size = file.metadata?.size || prev.size;
        prev.created = file.created_at || prev.created;
        grouped.set(base, prev);
      });

      const items: StickerItem[] = [];
      grouped.forEach((val, base) => {
        const title = base.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        let category = "General";
        if (base.includes("morning") || base.includes("hello") || base.includes("welcome")) category = "Greeting";
        else if (base.includes("delivery") || base.includes("fast")) category = "Fulfillment";
        else if (base.includes("order") || base.includes("buy")) category = "Orders";
        else if (base.includes("serving") || base.includes("support")) category = "Support";
        else if (base.includes("fire") || base.includes("hype")) category = "Hype";
        else if (base.includes("meme") || base.includes("pawpaw") || base.includes("crying")) category = "Memes";
        else if (base.includes("baby") || base.includes("dog") || base.includes("smile") || base.includes("reaction")) category = "Reactions";
        else if (base.includes("sleep") || base.includes("night")) category = "Night Mode";

        const webpName = val.webp || `${base}.webp`;
        const pngName = val.png || `${base}.png`;

        const { data: webpUrlData } = supabase.storage.from("stickers").getPublicUrl(webpName);
        const { data: pngUrlData } = supabase.storage.from("stickers").getPublicUrl(pngName);

        items.push({
          name: base,
          title,
          category,
          webpUrl: webpUrlData.publicUrl,
          pngUrl: pngUrlData.publicUrl,
          sizeBytes: val.size,
          createdAt: val.created,
        });
      });

      setStickers(items);
      if (!schedSticker && items.length > 0) {
        setSchedSticker(items[0]);
      }
    } catch (err: any) {
      console.error("Error fetching stickers:", err);
      toast({ title: "Failed to load stickers", description: err.message, variant: "destructive" });
    } finally {
      setLoadingStickers(false);
    }
  };

  // Fetch Scheduled Queue
  const fetchQueue = async () => {
    setLoadingQueue(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-broadcast-whatsapp", {
        body: { action: "list_scheduled_stickers" }
      });
      if (error) throw error;
      setQueueItems(data?.items || []);
    } catch (err: any) {
      console.warn("Could not fetch scheduled queue:", err.message);
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    fetchStickers();
    fetchQueue();
  }, []);

  // Filtered sticker items
  const filteredStickers = useMemo(() => {
    return stickers.filter(s => {
      const matchesCat = selectedCategory === "All" || s.category.toLowerCase() === selectedCategory.toLowerCase();
      const matchesSearch = !searchQuery.trim() || 
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        s.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [stickers, selectedCategory, searchQuery]);

  // Handle client-side sticker canvas rendering (resize to 512x512, transparent background)
  useEffect(() => {
    if (!uploadFile) {
      setProcessedCanvasUrl(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, 512, 512);

        // Aspect ratio fit
        const scale = Math.min(500 / img.width, 500 / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const x = Math.round((512 - w) / 2);
        const y = Math.round((512 - h) / 2);

        ctx.drawImage(img, x, y, w, h);

        if (autoTransparent) {
          const imgData = ctx.getImageData(0, 0, 512, 512);
          const d = imgData.data;
          // Sample corner pixel as background color reference
          const cornerR = d[0];
          const cornerG = d[1];
          const cornerB = d[2];
          const tol = colorTolerance;

          for (let i = 0; i < d.length; i += 4) {
            const diffR = Math.abs(d[i] - cornerR);
            const diffG = Math.abs(d[i + 1] - cornerG);
            const diffB = Math.abs(d[i + 2] - cornerB);
            if (diffR <= tol && diffG <= tol && diffB <= tol) {
              d[i + 3] = 0; // transparent
            }
          }
          ctx.putImageData(imgData, 0, 0);
        }

        setProcessedCanvasUrl(canvas.toDataURL("image/webp", 0.95));
      };
      img.src = e.target?.result as string;
      setUploadPreview(e.target?.result as string);
    };
    reader.readAsDataURL(uploadFile);
  }, [uploadFile, autoTransparent, colorTolerance]);

  // Upload processed sticker to Supabase Storage
  const handleUploadSticker = async () => {
    if (!processedCanvasUrl || !stickerTitle.trim()) {
      toast({ title: "Incomplete details", description: "Please upload an image and specify a title.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const cleanName = stickerTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      
      // Convert DataURL to Blob
      const res = await fetch(processedCanvasUrl);
      const blob = await res.blob();

      // 1. Upload WebP
      const webpFileName = `${cleanName}.webp`;
      const { error: webpErr } = await supabase.storage.from("stickers").upload(webpFileName, blob, {
        contentType: "image/webp",
        upsert: true
      });
      if (webpErr) throw webpErr;

      // 2. Upload PNG fallback
      const pngBlob = await new Promise<Blob | null>((resolve) => {
        const canvas = canvasRef.current;
        if (canvas) canvas.toBlob(b => resolve(b), "image/png");
        else resolve(null);
      });

      if (pngBlob) {
        await supabase.storage.from("stickers").upload(`${cleanName}.png`, pngBlob, {
          contentType: "image/png",
          upsert: true
        });
      }

      toast({ title: "Sticker Uploaded! 🎉", description: `"${stickerTitle}" is now ready to send and schedule.` });
      setUploadOpen(false);
      setUploadFile(null);
      setUploadPreview(null);
      setStickerTitle("");
      await fetchStickers();
    } catch (err: any) {
      console.error("Upload error:", err);
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  // Delete Sticker
  const handleDeleteSticker = async (sticker: StickerItem) => {
    if (!confirm(`Delete sticker "${sticker.title}" from library?`)) return;
    try {
      const toRemove = [`${sticker.name}.webp`, `${sticker.name}.png`];
      const { error } = await supabase.storage.from("stickers").remove(toRemove);
      if (error) throw error;
      toast({ title: "Sticker deleted" });
      setStickers(prev => prev.filter(s => s.name !== sticker.name));
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    }
  };

  // Send Single Sticker Now (Quick Action)
  const handleQuickSend = async () => {
    if (!targetSticker) return;
    setIsSendingQuick(true);
    try {
      const destination = quickDestination === "channel" ? "120363425720623850@newsletter" : quickCustomPhone.trim();
      if (quickDestination === "direct" && !destination) {
        toast({ title: "Missing recipient", description: "Please enter a phone number", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke("admin-broadcast-whatsapp", {
        body: {
          action: "send_sticker_instant",
          to: destination,
          sticker_url: targetSticker.webpUrl,
          image_url: targetSticker.pngUrl,
          title: targetSticker.title,
          message: quickCaption.trim() || undefined,
        }
      });

      if (error) throw error;
      toast({
        title: "Dispatched to WhatsApp! 🚀",
        description: `Sticker sent to ${quickDestination === "channel" ? "Official Channel" : destination}`
      });
      setQuickSendOpen(false);
      setQuickCaption("");
    } catch (err: any) {
      console.error("Send error:", err);
      toast({ title: "Send Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSendingQuick(false);
    }
  };

  // Submit Schedule / Dispatch
  const handleSubmitSchedule = async () => {
    if (!schedSticker) {
      toast({ title: "Select a Sticker", description: "Please choose a sticker from the library", variant: "destructive" });
      return;
    }

    setIsSubmittingSchedule(true);
    try {
      if (schedTiming === "now") {
        // Instant Dispatch
        const dest = schedTarget === "channel" 
          ? "120363425720623850@newsletter" 
          : (schedTarget === "custom" ? schedCustomPhone.trim() : "all_customers");

        const { data, error } = await supabase.functions.invoke("admin-broadcast-whatsapp", {
          body: {
            action: schedTarget === "all_customers" ? "broadcast" : "send_sticker_instant",
            to: dest,
            broadcast_to_users: schedTarget === "all_customers",
            sticker_url: schedSticker.webpUrl,
            image_url: schedSticker.pngUrl,
            title: schedTitle.trim(),
            message: schedMessage.trim(),
          }
        });

        if (error) throw error;
        toast({ title: "Broadcast Dispatched! 🚀", description: `Successfully triggered delivery.` });
      } else {
        // Scheduled Post
        const scheduledTime = new Date(schedDateTime).toISOString();
        const { data, error } = await supabase.functions.invoke("admin-broadcast-whatsapp", {
          body: {
            action: "schedule_sticker_post",
            title: schedTitle.trim(),
            target_type: schedTarget,
            target: schedTarget === "custom" ? schedCustomPhone.trim() : undefined,
            sticker_url: schedSticker.webpUrl,
            image_url: schedSticker.pngUrl,
            message: schedMessage.trim(),
            scheduled_for: scheduledTime,
          }
        });

        if (error) throw error;
        toast({ title: "Campaign Scheduled! ⏰", description: `Post set for ${new Date(schedDateTime).toLocaleString()}` });
        setActiveTab("queue");
        fetchQueue();
      }
    } catch (err: any) {
      console.error("Schedule error:", err);
      toast({ title: "Scheduling Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  // Cancel Scheduled Post
  const handleCancelScheduled = async (id: string) => {
    try {
      await supabase.functions.invoke("admin-broadcast-whatsapp", {
        body: { action: "cancel_scheduled_sticker", id }
      });
      toast({ title: "Post cancelled" });
      setQueueItems(prev => prev.map(q => q.id === id ? { ...q, status: "cancelled" } : q));
    } catch (err: any) {
      toast({ title: "Cancel Failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800/80 p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 -mb-16 w-60 h-60 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Sparkles className="w-5 h-5" />
              </span>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-mono font-bold">
                WhatsApp Visual Studio
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-mono">
              Stickers & Broadcast Scheduler
            </h1>
            <p className="text-sm text-zinc-400 max-w-2xl">
              Upload custom 512×512 WhatsApp stickers, manage your brand visual assets, and schedule viral broadcast campaigns to your Official WhatsApp Channel and customers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              onClick={() => setUploadOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold shadow-lg shadow-emerald-600/20"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Sticker
            </Button>
            <Button
              onClick={() => setActiveTab("schedule")}
              variant="outline"
              className="border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-200 font-mono"
            >
              <Clock className="w-4 h-4 mr-2 text-teal-400" />
              New Schedule
            </Button>
            <Button
              onClick={() => { fetchStickers(); fetchQueue(); }}
              variant="outline"
              size="icon"
              className="border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300"
              title="Refresh Library"
            >
              <RefreshCw className={cn("w-4 h-4", loadingStickers && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Live Channel Status Pills */}
        <div className="relative z-10 flex flex-wrap gap-2.5 pt-5 mt-5 border-t border-zinc-800/60 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-zinc-300 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Channel: <strong className="text-white">120363425720623850@newsletter</strong></span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-zinc-300 font-mono">
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            <span>Bot Sender: <strong className="text-white">0548942122</strong></span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-zinc-300 font-mono">
            <ImageIcon className="w-3.5 h-3.5 text-teal-400" />
            <span>Library: <strong className="text-white">{stickers.length} Stickers</strong></span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-zinc-300 font-mono">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Scheduled: <strong className="text-white">{queueItems.filter(q => q.status === "scheduled").length} Queued</strong></span>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="space-y-6">
        <TabsList className="bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
          <TabsTrigger value="library" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white font-mono text-xs font-bold gap-2">
            <ImageIcon className="w-4 h-4" />
            Sticker Library ({stickers.length})
          </TabsTrigger>
          <TabsTrigger value="schedule" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white font-mono text-xs font-bold gap-2">
            <Calendar className="w-4 h-4" />
            Schedule Broadcast
          </TabsTrigger>
          <TabsTrigger value="queue" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white font-mono text-xs font-bold gap-2">
            <Clock className="w-4 h-4" />
            Queue & History ({queueItems.length})
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: STICKER LIBRARY ─── */}
        <TabsContent value="library" className="space-y-6">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-zinc-900/60 p-4 rounded-xl border border-zinc-800">
            {/* Category Pills */}
            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all",
                    selectedCategory === cat
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                      : "bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 border border-transparent"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
              <Input
                placeholder="Search stickers..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 bg-zinc-950 border-zinc-800 text-xs font-mono text-white placeholder:text-zinc-500 rounded-lg"
              />
            </div>
          </div>

          {/* Stickers Grid */}
          {loadingStickers ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-60 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : filteredStickers.length === 0 ? (
            <div className="text-center py-16 bg-zinc-900/30 rounded-2xl border border-zinc-800/80">
              <ImageIcon className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-zinc-300 font-mono">No stickers found</h3>
              <p className="text-xs text-zinc-500 mt-1">Try another category or upload your first custom sticker.</p>
              <Button onClick={() => setUploadOpen(true)} className="mt-4 bg-emerald-600 text-white font-mono text-xs">
                <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Now
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredStickers.map(sticker => (
                <Card
                  key={sticker.name}
                  className="group relative overflow-hidden bg-zinc-900/80 border-zinc-800 hover:border-emerald-500/50 transition-all rounded-xl shadow-lg flex flex-col justify-between"
                >
                  {/* Sticker Preview Box on Dark Checkerboard */}
                  <div className="relative p-4 flex items-center justify-center min-h-[160px] bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:12px_12px] bg-zinc-950/60">
                    <img
                      src={sticker.webpUrl}
                      alt={sticker.title}
                      loading="lazy"
                      className="max-h-32 max-w-[128px] object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-105 duration-200"
                    />

                    {/* Format Badge */}
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-zinc-950/80 text-zinc-400 border border-zinc-800">
                      512px
                    </span>
                  </div>

                  {/* Card Info */}
                  <div className="p-3 border-t border-zinc-800/80 space-y-2">
                    <div>
                      <h4 className="text-xs font-bold text-white font-mono truncate" title={sticker.title}>
                        {sticker.title}
                      </h4>
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 mt-0.5 font-mono">
                        <span className="text-emerald-400 font-bold">{sticker.category}</span>
                        {sticker.sizeBytes && <span>{Math.round(sticker.sizeBytes / 1024)} KB</span>}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="grid grid-cols-3 gap-1 pt-1 border-t border-zinc-800/40">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setTargetSticker(sticker);
                          setQuickDestination("channel");
                          setQuickCaption(`⚡ ${sticker.title}! SwiftData is 100% active delivering bundles.`);
                          setQuickSendOpen(true);
                        }}
                        className="h-7 px-1.5 text-[10px] bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-mono font-bold"
                        title="Send to Channel Now"
                      >
                        <Send className="w-3 h-3 mr-1" /> Post
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSchedSticker(sticker);
                          setSchedTitle(`Campaign: ${sticker.title}`);
                          setActiveTab("schedule");
                        }}
                        className="h-7 px-1.5 text-[10px] border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 font-mono"
                        title="Schedule this sticker"
                      >
                        <Clock className="w-3 h-3 mr-1" /> Plan
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteSticker(sticker)}
                        className="h-7 px-1 text-[10px] text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                        title="Delete Sticker"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── TAB 2: SCHEDULE BROADCAST ─── */}
        <TabsContent value="schedule" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Columns: Form Controls */}
            <div className="lg:col-span-7 space-y-6 bg-zinc-900/60 p-6 rounded-2xl border border-zinc-800">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  Compose WhatsApp Broadcast
                </h3>
                <p className="text-xs text-zinc-400">
                  Configure your visual sticker campaign, target audience, and broadcast time.
                </p>
              </div>

              {/* 1. Target Audience */}
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider">
                  1. Target Audience
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSchedTarget("channel")}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      schedTarget === "channel"
                        ? "bg-emerald-500/15 border-emerald-500 text-white shadow-md shadow-emerald-500/10"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                    )}
                  >
                    <div className="text-xs font-bold font-mono">📢 Official Channel</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">Posts to @newsletter</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSchedTarget("all_customers")}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      schedTarget === "all_customers"
                        ? "bg-emerald-500/15 border-emerald-500 text-white shadow-md shadow-emerald-500/10"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                    )}
                  >
                    <div className="text-xs font-bold font-mono">👥 All Customers</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">Direct chat broadcast</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSchedTarget("custom")}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      schedTarget === "custom"
                        ? "bg-emerald-500/15 border-emerald-500 text-white shadow-md shadow-emerald-500/10"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                    )}
                  >
                    <div className="text-xs font-bold font-mono">📱 Test Number</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">Test on single phone</div>
                  </button>
                </div>

                {schedTarget === "custom" && (
                  <Input
                    placeholder="Enter phone number (e.g. 0548942122 or 233...)"
                    value={schedCustomPhone}
                    onChange={e => setSchedCustomPhone(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 font-mono text-xs text-white"
                  />
                )}
              </div>

              {/* 2. Select Sticker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider">
                    2. Select Sticker
                  </label>
                  <button
                    type="button"
                    onClick={() => setActiveTab("library")}
                    className="text-[11px] text-emerald-400 hover:underline font-mono"
                  >
                    Browse full library ({stickers.length}) &rarr;
                  </button>
                </div>

                {/* Horizontal Sticker Selector */}
                <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin">
                  {stickers.slice(0, 12).map(s => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => setSchedSticker(s)}
                      className={cn(
                        "relative shrink-0 w-20 h-20 rounded-xl p-2 border transition-all flex items-center justify-center bg-zinc-950",
                        schedSticker?.name === s.name
                          ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/10"
                          : "border-zinc-800 hover:border-zinc-700"
                      )}
                    >
                      <img src={s.webpUrl} alt={s.title} className="max-w-full max-h-full object-contain" />
                      {schedSticker?.name === s.name && (
                        <span className="absolute top-1 right-1 p-0.5 rounded-full bg-emerald-500 text-black">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Campaign Caption & Presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider">
                    3. Caption / Message
                  </label>
                  {/* Preset Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    {PRESET_MESSAGES.map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setSchedMessage(p.message);
                          setSchedTitle(p.title);
                          const matching = stickers.find(s => s.name === p.sticker);
                          if (matching) setSchedSticker(matching);
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 hover:bg-emerald-500/20 hover:text-emerald-300 border border-zinc-700/50 whitespace-nowrap"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Textarea
                  rows={3}
                  value={schedMessage}
                  onChange={e => setSchedMessage(e.target.value)}
                  placeholder="Enter broadcast text or motivational message..."
                  className="bg-zinc-950 border-zinc-800 text-xs font-sans text-white resize-none"
                />

                {/* Emoji toolbar */}
                <div className="flex items-center gap-1 text-xs">
                  {["☀️", "🛵", "⚡", "🔥", "🚀", "🇬🇭", "📦", "🎁", "💬", "❤️"].map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setSchedMessage(prev => prev + " " + emoji)}
                      className="p-1 hover:bg-zinc-800 rounded transition-colors text-sm"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. Scheduling Time */}
              <div className="space-y-3 pt-2 border-t border-zinc-800">
                <label className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider">
                  4. Dispatch Timing
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSchedTiming("now")}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      schedTiming === "now"
                        ? "bg-emerald-500/15 border-emerald-500 text-white"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    )}
                  >
                    <div className="text-xs font-bold font-mono">⚡ Send Immediately</div>
                    <div className="text-[10px] text-zinc-500">Post right now</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSchedTiming("later")}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all",
                      schedTiming === "later"
                        ? "bg-emerald-500/15 border-emerald-500 text-white"
                        : "bg-zinc-950 border-zinc-800 text-zinc-400"
                    )}
                  >
                    <div className="text-xs font-bold font-mono">⏰ Schedule for Later</div>
                    <div className="text-[10px] text-zinc-500">Pick date & time</div>
                  </button>
                </div>

                {schedTiming === "later" && (
                  <div className="space-y-2 pt-1">
                    <Input
                      type="datetime-local"
                      value={schedDateTime}
                      onChange={e => setSchedDateTime(e.target.value)}
                      className="bg-zinc-950 border-zinc-800 text-xs font-mono text-white"
                    />

                    {/* Quick Timing Shortcuts */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const tmrw = new Date();
                          tmrw.setDate(tmrw.getDate() + 1);
                          tmrw.setHours(8, 0, 0, 0);
                          const pad = (n: number) => n < 10 ? `0${n}` : `${n}`;
                          setSchedDateTime(`${tmrw.getFullYear()}-${pad(tmrw.getMonth() + 1)}-${pad(tmrw.getDate())}T08:00`);
                        }}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-white"
                      >
                        Tomorrow 08:00 AM
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const today = new Date();
                          today.setHours(18, 0, 0, 0);
                          const pad = (n: number) => n < 10 ? `0${n}` : `${n}`;
                          setSchedDateTime(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T18:00`);
                        }}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-white"
                      >
                        Today 06:00 PM
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Submit CTA */}
              <Button
                onClick={handleSubmitSchedule}
                disabled={isSubmittingSchedule || !schedSticker}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs uppercase tracking-widest shadow-lg shadow-emerald-600/20"
              >
                {isSubmittingSchedule ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" /> Processing...
                  </span>
                ) : schedTiming === "now" ? (
                  <span className="flex items-center gap-2">
                    <Send className="w-4 h-4" /> Dispatch to WhatsApp Now
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> Confirm & Schedule Broadcast
                  </span>
                )}
              </Button>
            </div>

            {/* Right 5 Columns: Realistic WhatsApp Chat Simulator */}
            <div className="lg:col-span-5 space-y-4">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                  Live WhatsApp Preview
                </h3>
                <p className="text-xs text-zinc-400">
                  Real-time preview of how this post appears on mobile devices.
                </p>
              </div>

              {/* Phone Device Frame */}
              <div className="relative mx-auto w-full max-w-[340px] rounded-[36px] border-4 border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl">
                {/* Speaker notch */}
                <div className="h-4 bg-zinc-900 flex items-center justify-center">
                  <div className="w-12 h-1 rounded-full bg-zinc-800" />
                </div>

                {/* WhatsApp Header */}
                <div className="bg-[#075E54] px-4 py-2.5 flex items-center gap-2 text-white">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">
                    SD
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate flex items-center gap-1">
                      SwiftData Ghana
                      <span className="text-[10px] text-emerald-200">✓</span>
                    </div>
                    <div className="text-[9px] text-emerald-100 truncate">Official Channel</div>
                  </div>
                </div>

                {/* Chat Background with Wallpaper */}
                <div className="p-3 min-h-[360px] bg-[#0b141a] flex flex-col justify-end space-y-2">
                  {/* Message Bubble */}
                  <div className="self-end max-w-[85%] rounded-2xl rounded-tr-sm bg-[#005c4b] text-white p-2.5 shadow-md space-y-2">
                    {/* Sticker Image */}
                    {schedSticker ? (
                      <div className="flex justify-center p-2 bg-black/10 rounded-lg">
                        <img
                          src={schedSticker.webpUrl}
                          alt="preview"
                          className="max-h-36 max-w-[144px] object-contain drop-shadow-md"
                        />
                      </div>
                    ) : (
                      <div className="h-28 flex items-center justify-center text-xs text-zinc-400 font-mono border border-dashed border-white/20 rounded-lg">
                        No sticker selected
                      </div>
                    )}

                    {/* Caption */}
                    {schedMessage && (
                      <p className="text-xs font-sans leading-relaxed text-emerald-50 whitespace-pre-wrap">
                        {schedMessage}
                      </p>
                    )}

                    {/* Meta info & double check ticks */}
                    <div className="flex items-center justify-end gap-1 text-[9px] text-emerald-200/70 font-mono">
                      <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span>✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Fake Input Bar */}
                <div className="bg-[#1f2c34] p-2 flex items-center gap-2 text-zinc-400 text-xs">
                  <div className="flex-1 bg-[#2a3942] rounded-full px-3 py-1.5 text-[11px] text-zinc-500">
                    Message
                  </div>
                  <div className="w-7 h-7 rounded-full bg-[#00a884] flex items-center justify-center text-black font-bold">
                    ➤
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ─── TAB 3: QUEUE & DISPATCH HISTORY ─── */}
        <TabsContent value="queue" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white font-mono">Scheduled Posts & Queue</h3>
              <p className="text-xs text-zinc-400">Manage pending automated broadcasts and delivery history.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchQueue}
              className="border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 font-mono text-xs"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loadingQueue && "animate-spin")} /> Refresh
            </Button>
          </div>

          {loadingQueue ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : queueItems.length === 0 ? (
            <div className="text-center py-16 bg-zinc-900/30 rounded-2xl border border-zinc-800/80">
              <Clock className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-zinc-300 font-mono">No scheduled posts yet</h3>
              <p className="text-xs text-zinc-500 mt-1">Schedule your first sticker broadcast to your channel or customers.</p>
              <Button onClick={() => setActiveTab("schedule")} className="mt-4 bg-emerald-600 text-white font-mono text-xs">
                Schedule Broadcast
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 overflow-hidden divide-y divide-zinc-800/60 bg-zinc-900/50">
              {queueItems.map(item => {
                const opt = (item as any).options || {};
                const schedDate = opt.scheduled_for || item.created_at;

                return (
                  <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-900/80 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {opt.sticker_url ? (
                        <div className="w-12 h-12 rounded-lg bg-zinc-950 p-1 border border-zinc-800 shrink-0 flex items-center justify-center">
                          <img src={opt.sticker_url} alt="sticker" className="max-w-full max-h-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-zinc-950 flex items-center justify-center text-zinc-600 border border-zinc-800 shrink-0">
                          <Sparkles className="w-5 h-5 text-emerald-400" />
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-white font-mono truncate">
                            {opt.title || item.message.slice(0, 40)}
                          </h4>
                          <Badge
                            className={cn(
                              "text-[9px] font-mono uppercase font-bold",
                              item.status === "scheduled" && "bg-amber-500/15 text-amber-300 border-amber-500/30",
                              item.status === "sent" && "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
                              item.status === "failed" && "bg-red-500/15 text-red-300 border-red-500/30",
                              item.status === "cancelled" && "bg-zinc-800 text-zinc-400 border-zinc-700"
                            )}
                          >
                            {item.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-zinc-400 font-sans truncate max-w-md mt-0.5">
                          {item.message}
                        </p>
                        <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono mt-1">
                          <span>Target: <strong className="text-zinc-300">{item.recipient_phone.includes("@newsletter") ? "📢 Official Channel" : item.recipient_phone}</strong></span>
                          <span>•</span>
                          <span>Set for: <strong className="text-zinc-300">{new Date(schedDate).toLocaleString()}</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === "scheduled" && (
                        <>
                          <Button
                            size="sm"
                            onClick={async () => {
                              try {
                                await supabase.functions.invoke("admin-broadcast-whatsapp", {
                                  body: {
                                    action: "send_sticker_instant",
                                    to: item.recipient_phone,
                                    sticker_url: opt.sticker_url,
                                    image_url: opt.image_url,
                                    message: item.message,
                                    title: opt.title,
                                  }
                                });
                                toast({ title: "Post dispatched immediately!" });
                                fetchQueue();
                              } catch (err: any) {
                                toast({ title: "Dispatch Failed", description: err.message, variant: "destructive" });
                              }
                            }}
                            className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-bold"
                          >
                            <Play className="w-3 h-3 mr-1" /> Send Now
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCancelScheduled(item.id)}
                            className="h-8 border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-red-400 font-mono text-[10px]"
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── MODAL: UPLOAD STICKER ─── */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-lg bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="font-mono text-base flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-400" />
              Upload New WhatsApp Sticker
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Select any image. We'll automatically format, center, and resize it to WhatsApp's official 512×512 WebP sticker standard.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* File drop zone */}
            {!uploadFile ? (
              <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-zinc-700 hover:border-emerald-500/50 rounded-xl cursor-pointer bg-zinc-950/60 transition-colors">
                <Upload className="w-8 h-8 text-zinc-500 mb-2" />
                <span className="text-xs font-mono font-bold text-zinc-300">Click to choose image or drag & drop</span>
                <span className="text-[10px] text-zinc-500 mt-1">PNG, JPG, WEBP, or GIF (up to 5MB)</span>
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/webp, image/gif"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setUploadFile(f);
                      const base = f.name.substring(0, f.name.lastIndexOf(".")).replace(/[^a-zA-Z0-9 ]/g, " ");
                      setStickerTitle(base);
                    }
                  }}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="flex items-center gap-4 p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                {processedCanvasUrl && (
                  <div className="w-20 h-20 rounded-lg bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:8px_8px] bg-zinc-900 p-1 flex items-center justify-center border border-zinc-800 shrink-0">
                    <img src={processedCanvasUrl} alt="preview" className="max-w-full max-h-full object-contain" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-bold text-white truncate">{uploadFile.name}</div>
                  <div className="text-[10px] text-emerald-400 font-mono mt-0.5">512×512 WebP Preview Ready</div>
                  <button
                    type="button"
                    onClick={() => { setUploadFile(null); setProcessedCanvasUrl(null); }}
                    className="text-[10px] text-red-400 hover:underline font-mono mt-1"
                  >
                    Change Image
                  </button>
                </div>
              </div>
            )}

            {/* Sticker Title */}
            <div className="space-y-1">
              <label className="text-xs font-mono font-bold text-zinc-300">Sticker Title</label>
              <Input
                placeholder="e.g. Fast Delivery Rider"
                value={stickerTitle}
                onChange={e => setStickerTitle(e.target.value)}
                className="bg-zinc-950 border-zinc-800 text-xs font-mono text-white"
              />
            </div>

            {/* Category Dropdown */}
            <div className="space-y-1">
              <label className="text-xs font-mono font-bold text-zinc-300">Category</label>
              <select
                value={stickerCategory}
                onChange={e => setStickerCategory(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-xs font-mono text-white rounded-lg p-2.5 outline-none focus:border-emerald-500"
              >
                {CATEGORIES.filter(c => c !== "All").map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Transparency Options */}
            <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono font-bold text-zinc-300">Auto-Remove Outer Background</div>
                  <div className="text-[10px] text-zinc-500">Makes outer solid background transparent</div>
                </div>
                <Switch
                  checked={autoTransparent}
                  onCheckedChange={setAutoTransparent}
                />
              </div>

              {autoTransparent && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                    <span>Tolerance Threshold</span>
                    <span>{colorTolerance}</span>
                  </div>
                  <Slider
                    min={5}
                    max={60}
                    step={1}
                    value={[colorTolerance]}
                    onValueChange={([v]) => setColorTolerance(v)}
                  />
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setUploadOpen(false)} className="text-zinc-400 font-mono text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleUploadSticker}
              disabled={isUploading || !processedCanvasUrl || !stickerTitle.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold"
            >
              {isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
              Save Sticker to Cloud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: QUICK SEND STICKER ─── */}
      <Dialog open={quickSendOpen} onOpenChange={setQuickSendOpen}>
        <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="font-mono text-base flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-400" />
              Send "{targetSticker?.title}" to WhatsApp
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Instantly deliver this sticker to your channel or a test phone number.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Sticker Preview */}
            {targetSticker && (
              <div className="flex items-center gap-3 p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                <img src={targetSticker.webpUrl} alt="preview" className="w-16 h-16 object-contain" />
                <div className="min-w-0">
                  <div className="text-xs font-mono font-bold text-white">{targetSticker.title}</div>
                  <div className="text-[10px] text-emerald-400 font-mono">{targetSticker.category}</div>
                </div>
              </div>
            )}

            {/* Target Destination */}
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold text-zinc-300">Destination</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setQuickDestination("channel")}
                  className={cn(
                    "p-2.5 rounded-lg border text-left font-mono text-xs transition-all",
                    quickDestination === "channel" ? "bg-emerald-500/15 border-emerald-500 text-white font-bold" : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  )}
                >
                  📢 Official Channel
                </button>
                <button
                  type="button"
                  onClick={() => setQuickDestination("direct")}
                  className={cn(
                    "p-2.5 rounded-lg border text-left font-mono text-xs transition-all",
                    quickDestination === "direct" ? "bg-emerald-500/15 border-emerald-500 text-white font-bold" : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  )}
                >
                  📱 Phone Number
                </button>
              </div>

              {quickDestination === "direct" && (
                <Input
                  placeholder="e.g. 0548942122 or 233..."
                  value={quickCustomPhone}
                  onChange={e => setQuickCustomPhone(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 text-xs font-mono text-white"
                />
              )}
            </div>

            {/* Optional Caption */}
            <div className="space-y-1">
              <label className="text-xs font-mono font-bold text-zinc-300">Caption (Optional)</label>
              <Textarea
                rows={2}
                value={quickCaption}
                onChange={e => setQuickCaption(e.target.value)}
                placeholder="Optional text to accompany the sticker..."
                className="bg-zinc-950 border-zinc-800 text-xs text-white resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setQuickSendOpen(false)} className="text-zinc-400 font-mono text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleQuickSend}
              disabled={isSendingQuick}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold"
            >
              {isSendingQuick ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
              Send Right Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
