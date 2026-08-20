import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/AppThemeContext";
import { useToast } from "@/hooks/use-toast";
import {
  PhoneCall,
  Volume2,
  Mic,
  Upload,
  Send,
  Users,
  Radio,
  FileAudio,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Key,
  Info,
  Play,
  Square,
  ChevronRight,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface MnotifyTemplate {
  id?: string | number;
  title?: string;
  template_name?: string;
  name?: string;
  content?: string;
  message?: string;
  voice_id?: string;
  type?: string;
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
}

export default function AdminVoiceSMS() {
  const { session } = useAuth();
  const { isDark } = useAppTheme();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"broadcast" | "templates" | "settings">("broadcast");
  const [campaignTitle, setCampaignTitle] = useState("");
  const [targetType, setTargetType] = useState<"custom" | "all_users" | "agents" | "sub_agents">("custom");
  const [customNumbers, setCustomNumbers] = useState("");
  const [audioSource, setAudioSource] = useState<"file" | "voice_id" | "template">("file");
  const [voiceId, setVoiceId] = useState("");
  const [isSchedule, setIsSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Settings & balance state
  const [apiKey, setApiKey] = useState("");
  const [voiceBalance, setVoiceBalance] = useState<number | null>(null);
  const [smsBalance, setSmsBalance] = useState<number | null>(null);
  const [templates, setTemplates] = useState<MnotifyTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("audio/") && !file.name.endsWith(".mp3") && !file.name.endsWith(".wav") && !file.name.endsWith(".m4a")) {
      toast({ title: "Invalid File Type", description: "Please upload an MP3 or WAV audio file.", variant: "destructive" });
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "File Too Large", description: "Maximum audio file size is 15MB.", variant: "destructive" });
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setAudioPreviewUrl(objectUrl);

    // Convert to Base64
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
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

  const parsedRecipients = () => {
    if (targetType !== "custom") return [];
    return customNumbers
      .split(/[\n,;]+/)
      .map(p => p.trim())
      .filter(p => p.length >= 9);
  };

  const getTargetRecipientCount = () => {
    if (targetType === "all_users") return counts.all;
    if (targetType === "agents") return counts.agents;
    if (targetType === "sub_agents") return counts.subAgents;
    return parsedRecipients().length;
  };

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

    if (!confirm(`Are you sure you want to broadcast this Voice Call to ${getTargetRecipientCount()} recipients?`)) {
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
        schedule_date: isSchedule ? scheduleDate : undefined,
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
        title: "Voice Campaign Dispatched! 📞",
        description: `Successfully initiated voice calls for ${data.summary?.total_sent || getTargetRecipientCount()} recipients.`
      });

      setLastResult(data.summary || { total_sent: getTargetRecipientCount() });
      fetchBalanceAndTemplates();
    } catch (err: any) {
      toast({
        title: "Broadcast Failed",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 pb-24 max-w-6xl mx-auto">
      {/* Header */}
      <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b pb-6 ${isDark ? "border-white/5" : "border-gray-200"}`}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <Radio className="w-3 h-3 animate-pulse" /> mNotify Voice Engine
            </span>
          </div>
          <h1 className={`font-display text-3xl font-black tracking-tight ${isDark ? "bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent" : "text-gray-900"}`}>
            Voice Call & Audio SMS Broadcasts
          </h1>
          <p className={`text-sm mt-1 ${isDark ? "text-white/50" : "text-gray-500"}`}>
            Broadcast real voice calls, announcements, and audio messages directly to customers and agents.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            onClick={() => fetchBalanceAndTemplates()}
            variant="outline"
            disabled={loadingTemplates}
            className="gap-2 rounded-xl text-xs font-bold border-input bg-card shadow-sm h-10"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTemplates ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Balance & Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Voice Units Available</p>
            <p className="text-2xl font-black text-foreground mt-1">
              {voiceBalance !== null ? `${voiceBalance.toLocaleString()} units` : "Active"}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <PhoneCall className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Registered Audience</p>
            <p className="text-2xl font-black text-foreground mt-1">
              {counts.all.toLocaleString()} users
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">API Connection</p>
            <p className="text-sm font-bold text-emerald-500 flex items-center gap-1.5 mt-2">
              <CheckCircle2 className="w-4 h-4" /> mNotify v2.0 Ready
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Key className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-6">
        <button
          onClick={() => setActiveTab("broadcast")}
          className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === "broadcast"
              ? "border-cyan-500 text-cyan-500"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Volume2 className="w-4 h-4" /> New Voice Broadcast
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === "templates"
              ? "border-cyan-500 text-cyan-500"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileAudio className="w-4 h-4" /> Templates & IVR
          {templates.length > 0 && (
            <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px]">
              {templates.length}
            </Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`pb-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === "settings"
              ? "border-cyan-500 text-cyan-500"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Key className="w-4 h-4" /> API Credentials
        </button>
      </div>

      {/* TAB 1: NEW BROADCAST */}
      {activeTab === "broadcast" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-5">
              <h2 className="text-base font-black text-foreground flex items-center gap-2">
                <Mic className="w-5 h-5 text-cyan-500" /> Campaign Configuration
              </h2>

              {/* Campaign Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Campaign Title</label>
                <Input
                  value={campaignTitle}
                  onChange={(e) => setCampaignTitle(e.target.value)}
                  placeholder="e.g. Promo Alert, System Maintenance, Welcome Call"
                  className="rounded-xl h-11 bg-secondary/50 font-medium"
                />
              </div>

              {/* Audience Target */}
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Select Target Audience</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: "all_users", label: "All Users", count: counts.all },
                    { id: "agents", label: "Agents", count: counts.agents },
                    { id: "sub_agents", label: "Sub-Agents", count: counts.subAgents },
                    { id: "custom", label: "Custom Phone(s)", count: parsedRecipients().length },
                  ].map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => setTargetType(target.id as any)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        targetType === target.id
                          ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-400 font-bold"
                          : "bg-secondary/40 border-border text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      <p className="text-xs font-black">{target.label}</p>
                      <p className="text-[11px] opacity-70 mt-0.5">{target.count} contacts</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom numbers textarea if target is custom */}
              {targetType === "custom" && (
                <div className="space-y-1.5 animate-in fade-in duration-200">
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
                  <p className="text-[11px] text-muted-foreground">
                    {parsedRecipients().length} valid phone number(s) detected.
                  </p>
                </div>
              )}

              {/* Audio Source Tabs */}
              <div className="space-y-3 pt-2 border-t border-border">
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Audio Message Source</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAudioSource("file")}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                      audioSource === "file"
                        ? "bg-cyan-500 text-black border-cyan-500"
                        : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5 inline mr-1.5" /> Upload Audio File (.mp3 / .wav)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudioSource("voice_id")}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                      audioSource === "voice_id" || audioSource === "template"
                        ? "bg-cyan-500 text-black border-cyan-500"
                        : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5 inline mr-1.5" /> Use Existing Voice ID / Template
                  </button>
                </div>

                {audioSource === "file" ? (
                  <div className="p-5 rounded-2xl border-2 border-dashed border-border bg-secondary/20 text-center space-y-3">
                    <input
                      type="file"
                      id="voice-audio-file"
                      accept="audio/mp3,audio/wav,audio/mpeg,.mp3,.wav"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <label
                      htmlFor="voice-audio-file"
                      className="cursor-pointer inline-flex flex-col items-center justify-center gap-2"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          {selectedFile ? selectedFile.name : "Click to browse audio file (.mp3, .wav)"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : "Max file size: 15MB"}
                        </p>
                      </div>
                    </label>

                    {audioPreviewUrl && (
                      <div className="flex items-center justify-center gap-3 pt-3 border-t border-border/60 max-w-sm mx-auto">
                        <audio ref={audioRef} src={audioPreviewUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
                        <Button
                          type="button"
                          size="sm"
                          onClick={toggleAudioPlay}
                          variant="outline"
                          className="rounded-xl gap-2 text-xs font-bold bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20"
                        >
                          {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          {isPlaying ? "Pause Preview" : "Play Preview"}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      value={voiceId}
                      onChange={(e) => setVoiceId(e.target.value)}
                      placeholder="Enter mNotify Voice ID (e.g. 20180308134708)"
                      className="rounded-xl h-11 bg-secondary/50 font-mono text-xs"
                    />
                    {templates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <span className="text-[11px] text-muted-foreground mr-1">Quick Select:</span>
                        {templates.slice(0, 4).map((t, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setVoiceId(t.voice_id || String(t.id || ""))}
                            className="px-2.5 py-1 rounded-lg bg-secondary text-[11px] font-semibold text-foreground hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors border border-border"
                          >
                            {t.title || t.template_name || `Template #${t.id}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Schedule Optional */}
              <div className="pt-2 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-foreground">Schedule for Later</p>
                    <p className="text-[11px] text-muted-foreground">Auto-dispatch at a scheduled date and time.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={isSchedule}
                    onChange={(e) => setIsSchedule(e.target.checked)}
                    className="w-4 h-4 rounded border-input text-cyan-500 focus:ring-cyan-500/30"
                  />
                </div>

                {isSchedule && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                    <Input
                      type="text"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      placeholder="YYYY-MM-DD hh:mm (e.g. 2026-08-25 14:30)"
                      className="rounded-xl h-10 bg-secondary/50 font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <Button
                onClick={handleSendVoiceCampaign}
                disabled={sending}
                className="w-full h-12 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-black text-sm uppercase tracking-wider shadow-lg shadow-cyan-500/20 gap-2 transition-all active:scale-[0.99]"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Calling {getTargetRecipientCount()} Recipients...
                  </>
                ) : (
                  <>
                    <PhoneCall className="w-4 h-4" /> Dispatch Voice Campaign ({getTargetRecipientCount()} Calls)
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Right Column: Live Summary & Tips */}
          <div className="space-y-6">
            {/* Last Dispatch Result */}
            {lastResult && (
              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 animate-in zoom-in-95 duration-200 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" /> Campaign Successfully Placed
                </div>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <p><strong className="text-foreground">Campaign ID:</strong> <span className="font-mono text-emerald-400">{lastResult._id || "N/A"}</span></p>
                  <p><strong className="text-foreground">Voice ID:</strong> <span className="font-mono text-foreground">{lastResult.voice_id || "Saved for reuse"}</span></p>
                  <p><strong className="text-foreground">Calls Placed:</strong> <span className="font-bold text-foreground">{lastResult.total_sent || 0}</span></p>
                  <p><strong className="text-foreground">Credits Used:</strong> <span className="font-bold text-cyan-400">{lastResult.credit_used || 0} units</span></p>
                </div>
              </div>
            )}

            {/* Information Card */}
            <div className="p-5 rounded-2xl bg-card border border-border shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
                <Info className="w-4 h-4 text-cyan-400" /> How Voice Calls Work
              </div>
              <ul className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                  <span>When you broadcast, mNotify immediately places phone calls to all selected recipient numbers.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                  <span>When the customer answers the phone, your recorded audio plays crystal clear.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                  <span>Audio files (.mp3 or .wav) are automatically stored on mNotify and assigned a reusable <strong>Voice ID</strong>.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TEMPLATES & IVR */}
      {activeTab === "templates" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-foreground">mNotify Message Templates</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchBalanceAndTemplates}
              disabled={loadingTemplates}
              className="rounded-xl text-xs gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTemplates ? "animate-spin" : ""}`} /> Sync from mNotify
            </Button>
          </div>

          {loadingTemplates ? (
            <div className="flex flex-col items-center justify-center p-12 gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
              <p className="text-xs font-medium">Syncing templates from https://api.mnotify.com/api/template...</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="p-8 rounded-2xl bg-card border border-border text-center space-y-2">
              <FileAudio className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-bold text-foreground">No templates found on your mNotify account</p>
              <p className="text-xs text-muted-foreground">
                You can create templates on the mNotify dashboard or upload fresh audio directly in the Broadcast tab.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((tmpl, idx) => (
                <div key={idx} className="p-5 rounded-2xl bg-card border border-border shadow-sm space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400">Template</span>
                      {tmpl.type && <Badge variant="outline" className="text-[9px]">{tmpl.type}</Badge>}
                    </div>
                    <h3 className="font-bold text-foreground text-sm">{tmpl.title || tmpl.template_name || `Template #${tmpl.id}`}</h3>
                    {tmpl.content && (
                      <p className="text-xs text-muted-foreground line-clamp-3 bg-secondary/30 p-2.5 rounded-xl">
                        {tmpl.content || tmpl.message}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setVoiceId(tmpl.voice_id || String(tmpl.id || ""));
                      setAudioSource("voice_id");
                      setActiveTab("broadcast");
                      toast({ title: "Template Selected", description: "Switched to Broadcast tab with this template." });
                    }}
                    className="w-full rounded-xl bg-secondary hover:bg-cyan-500/20 hover:text-cyan-400 text-xs font-bold transition-colors"
                  >
                    Use for Voice Broadcast <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SETTINGS & CREDENTIALS */}
      {activeTab === "settings" && (
        <div className="max-w-xl space-y-6">
          <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-4">
            <h2 className="text-base font-black text-foreground flex items-center gap-2">
              <Key className="w-5 h-5 text-cyan-500" /> mNotify API Configuration
            </h2>
            <p className="text-xs text-muted-foreground">
              Pass your mNotify API Key (found in your mNotify dashboard under <strong>Developer &gt; API v2.0</strong>).
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">mNotify API Key</label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter mNotify API Key..."
                className="rounded-xl h-11 bg-secondary/50 font-mono text-xs"
              />
            </div>

            <Button
              onClick={() => {
                fetchBalanceAndTemplates();
                toast({ title: "Testing Connection...", description: "Querying mNotify balance and templates." });
              }}
              disabled={loadingTemplates}
              className="rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" /> Test Connection & Fetch Balance
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
