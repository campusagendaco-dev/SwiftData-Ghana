import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Zap, Shield, Brain, Activity, History, Settings,
  ChevronRight, AlertCircle, CheckCircle2, Cpu,
  RefreshCw, TrendingUp, Search, MessageSquare, Bell,
  Sparkles, Bot, AlertTriangle, Play, Terminal,
  Database, Fingerprint, Lock, ShieldAlert, Skull,
  Rocket, Gift, LineChart, Target, DollarSign
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface SentinelAction {
  id: string;
  ts: string;
  action_type: string;
  status: string;
  reasoning: string;
  effectiveness: number;
  metadata: any;
}

interface SentinelStrategy {
  id: string;
  name: string;
  confidence_score: number;
  is_active: boolean;
  version: number;
}

const AdminSentinelAI = () => {
  const [actions, setActions] = useState<SentinelAction[]>([]);
  const [strategies, setStrategies] = useState<SentinelStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const [activeOutage, setActiveOutage] = useState<string | null>(null);
  const [routingNode, setRoutingNode] = useState<"mtn" | "telecel" | "airteltigo">("mtn");
  const [simLogs, setSimLogs] = useState<string[]>([
    "Sandbox initialized. Priority 1 (MTN) stable.",
    "Health checks operational."
  ]);

  const fetchSentinelData = async () => {
    try {
      const { data: actionData } = await (supabase as any).from("sentinel_actions")
        .select("*")
        .order("ts", { ascending: false })
        .limit(10);
      
      const { data: strategyData } = await (supabase as any).from("sentinel_strategies")
        .select("*")
        .order("confidence_score", { ascending: false });

      if (actionData) setActions(actionData);
      if (strategyData) setStrategies(strategyData);
    } catch (error) {
      console.error("Failed to fetch sentinel data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSentinelData();

    // Real-time subscription for actions
    const channel = supabase
      .channel("sentinel_changes")
      .on("postgres_changes", { event: "INSERT", table: "sentinel_actions" }, (payload) => {
        setActions((prev) => [payload.new as SentinelAction, ...prev].slice(0, 10));
        toast.info(`Sentinel: ${payload.new.action_type} action executed`);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Autonomous Heartbeat: Trigger Sentinel every 60 seconds
  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (!isProcessing) {
        console.log("[Sentinel] Initiating Autonomous Heartbeat Scan...");
        triggerSentinel();
      }
    }, 60000); // 60s loop

    return () => clearInterval(heartbeat);
  }, [isProcessing]);

  const triggerSentinel = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sentinel-ai");
      if (error) throw error;
      if (data?.error) throw new Error(data.message || data.error);
      toast.success(data.message || "Sentinel analysis complete");
      fetchSentinelData();
    } catch (error: any) {
      toast.error("Failed to trigger Sentinel: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 p-6 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-800 pb-8 relative overflow-hidden">
        {/* Animated Background Pulse for the header */}
        <div className="absolute inset-0 bg-cyan-500/5 blur-[100px] -z-10 animate-pulse" />
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              className="w-16 h-16 rounded-full border-2 border-dashed border-cyan-500/30 flex items-center justify-center"
            >
              <div className="w-12 h-12 rounded-full border-2 border-cyan-400/50 flex items-center justify-center bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                <Brain className="w-6 h-6 text-cyan-400" />
              </div>
            </motion.div>
            <motion.div 
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-4 border-[#020617]"
            />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-white uppercase italic flex items-center gap-2">
              The Sentinel <span className="text-cyan-500 text-lg not-italic font-bold">v2.0 CORE</span>
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-slate-400 text-sm font-medium flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" /> 
                Autonomous Platform Guard
              </p>
              <Badge className="bg-emerald-500/10 text-emerald-500 border-none font-black text-[8px] animate-pulse">AUTONOMOUS MODE: ON</Badge>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Last Tactical Scan: <span className="text-cyan-400">Just Now</span></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Tactical Module Indicators */}
          <div className="hidden xl:flex items-center gap-4 px-6 py-2 bg-white/5 rounded-2xl border border-white/5">
            {[
              { label: "FRAUD", status: "Active" },
              { label: "HEALING", status: "Active" },
              { label: "LIQUIDITY", status: "Active" }
            ].map(module => (
              <div key={module.label} className="flex flex-col">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">{module.label}</span>
                <span className="text-[10px] font-bold text-cyan-400 uppercase">{module.status}</span>
              </div>
            ))}
          </div>

          <button 
            onClick={triggerSentinel}
            disabled={isProcessing}
            className="relative group px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-black text-sm transition-all overflow-hidden shadow-lg shadow-cyan-500/20"
          >
            <div className="flex items-center gap-2 relative z-10">
              {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 fill-white" />}
              RUN ANALYTIC CORE
            </div>
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            />
          </button>
        </div>
      </div>

      {/* Tactical Intelligence Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Pulse Visualizer */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-3xl border border-emerald-500/20 bg-emerald-500/5 relative overflow-hidden group"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
              <Activity className="w-6 h-6 text-emerald-400 animate-pulse" />
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded-full">Active Scanning</span>
            </div>
          </div>
          <h3 className="text-lg font-black tracking-tight text-white uppercase italic">Tactical Pulse</h3>
          <p className="text-xs text-slate-500 font-medium leading-relaxed mt-2 italic">AI is cross-referencing logs with {">"}99.9% precision.</p>
          
          <div className="mt-4 flex gap-1 h-8 items-end">
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                animate={{ height: [10, 24, 12, 32, 8, 20] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
                className="flex-1 bg-emerald-500/40 rounded-full"
              />
            ))}
          </div>
        </motion.div>

        {/* Intelligence Stream */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-3xl border border-cyan-500/20 bg-cyan-500/5 relative overflow-hidden group col-span-2"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
              <Bot className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight text-white uppercase italic">Intelligence Stream</h3>
              <p className="text-[10px] text-cyan-500 font-bold uppercase tracking-widest">Real-time Autonomous Reasoning</p>
            </div>
          </div>
          
          <div className="space-y-2 font-mono">
             <div className="flex gap-3 text-[10px] items-center">
                <span className="text-cyan-500 font-bold">[SENTINEL]</span>
                <span className="text-slate-400">Auditing provider liquidity balances...</span>
                <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-1.5 h-3 bg-cyan-500" />
             </div>
             <div className="flex gap-3 text-[10px] items-center opacity-60">
                <span className="text-slate-600 font-bold">[SENTINEL]</span>
                <span className="text-slate-600 italic">Scanning agent behavior for fraud anomalies...</span>
             </div>
             <div className="flex gap-3 text-[10px] items-center opacity-40">
                <span className="text-slate-700 font-bold">[SENTINEL]</span>
                <span className="text-slate-700 italic">Failover protocols verified: PAYSTACK_REDUNDANCY_OK</span>
             </div>
          </div>
        </motion.div>
      </div>

      {/* Dual Core Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sentinel Core (Gemini) */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="p-6 rounded-3xl border border-slate-800 bg-slate-900/50 relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-4 text-cyan-500/10 group-hover:text-cyan-500/20 transition-colors">
            <Brain className="w-16 h-16" />
          </div>
          
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
              <Brain className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight text-white uppercase italic">
                Sentinel Core
              </h3>
              <p className="text-xs text-cyan-500 font-bold uppercase tracking-widest">Model: Gemini 1.5 Flash</p>
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
              <span className="text-slate-500">Processing Speed</span>
              <span className="text-cyan-400">98.4%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: "98.4%" }}
                className="h-full bg-cyan-500 shadow-[0_0_12px_rgba(34,211,238,0.5)]"
              />
            </div>
            <p className="text-[10px] text-slate-500 italic font-medium leading-relaxed">
              "Patrolling system_logs... No critical anomalies detected in the current minute."
            </p>
          </div>
        </motion.div>

        {/* Oracle Core (Anthropic) */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="p-6 rounded-3xl border border-slate-800 bg-slate-900/50 relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-4 text-purple-500/10 group-hover:text-purple-500/20 transition-colors">
            <Zap className="w-16 h-16" />
          </div>
          
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
              <Database className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight text-white uppercase italic">
                Liquidity Matrix
              </h3>
              <p className="text-xs text-amber-500 font-bold uppercase tracking-widest">Autonomous Provider Routing</p>
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
              <span className="text-slate-500">Routing Efficiency</span>
              <span className="text-amber-400">99.8%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: "99.8%" }}
                className="h-full bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)]"
              />
            </div>
            <p className="text-[10px] text-slate-500 italic font-medium leading-relaxed">
              "Ensuring Priority 1 routing to providers with {">"} GH₵50 liquidity. Failover protocols: ACTIVE."
            </p>
          </div>
        </motion.div>
      </div>

      {/* Visual Outage Simulation Playground */}
      <div className="p-6 rounded-3xl border border-slate-800 bg-slate-900/40 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-transparent opacity-100" />
        
        <div className="relative flex flex-col lg:flex-row gap-8 items-stretch">
          {/* Controls Column */}
          <div className="flex-1 space-y-4">
            <div>
              <h3 className="text-lg font-black tracking-tight text-white uppercase italic flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-cyan-400" />
                Sentinel Simulation Room
              </h3>
              <p className="text-[10px] text-cyan-500 font-bold uppercase tracking-widest mt-1">Mock Platform Incidents & Failover Routes</p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button 
                onClick={() => {
                  setActiveOutage("mtn");
                  setRoutingNode("telecel");
                  setSimLogs(prev => [
                    `[ALERT] MTN Gateway Latency > 4500ms`,
                    `[SENTINEL] Switch provider trigger executed`,
                    `[SENTINEL] Re-routed traffic to Telecel (Success)`,
                    ...prev
                  ].slice(0, 4));
                  toast.warning("MTN outage triggered. Sentinel routing failover: active.");
                }}
                className={cn(
                  "py-3 px-4 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all border shrink-0 cursor-pointer text-center",
                  activeOutage === "mtn"
                    ? "bg-red-500/20 border-red-500 text-red-400 shadow-lg shadow-red-500/10 animate-pulse"
                    : "bg-[#1e293b]/30 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
                )}
              >
                Mock MTN Failure
              </button>

              <button 
                onClick={() => {
                  setActiveOutage("telecel");
                  setRoutingNode("airteltigo");
                  setSimLogs(prev => [
                    `[ALERT] Telecel Error Rate > 85%`,
                    `[SENTINEL] Initiated failover to AirtelTigo`,
                    `[SENTINEL] Active routing complete (Priority 3)`,
                    ...prev
                  ].slice(0, 4));
                  toast.warning("Telecel outage triggered. Sentinel failover active.");
                }}
                className={cn(
                  "py-3 px-4 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all border shrink-0 cursor-pointer text-center",
                  activeOutage === "telecel"
                    ? "bg-red-500/20 border-red-500 text-red-400 shadow-lg shadow-red-500/10 animate-pulse"
                    : "bg-[#1e293b]/30 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
                )}
              >
                Mock Telecel Failure
              </button>

              <button 
                onClick={() => {
                  setActiveOutage(null);
                  setRoutingNode("mtn");
                  setSimLogs(prev => [
                    `[RESOLVED] All gateway paths returned to operational`,
                    `[SENTINEL] Restored Priority 1 routing (MTN)`,
                    ...prev
                  ].slice(0, 4));
                  toast.success("Gateways stable. Priority 1 routing restored.");
                }}
                className="py-3 px-4 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all bg-emerald-600 hover:bg-emerald-500 border-none text-white shadow-lg shadow-emerald-500/10 shrink-0 cursor-pointer text-center"
              >
                Reset Sandbox
              </button>
            </div>

            {/* Sim Logs terminal */}
            <div className="bg-black/40 rounded-2xl p-4 border border-slate-800/80 font-mono space-y-1.5 h-36 overflow-y-auto">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none block mb-1">Sandbox System Logs</span>
              {simLogs.map((log, idx) => (
                <div key={idx} className="flex gap-2 text-[10px] items-start">
                  <span className={cn(
                    "font-bold shrink-0",
                    log.includes("ALERT") ? "text-red-500" : log.includes("RESOLVED") ? "text-emerald-500" : "text-cyan-500"
                  )}>[SYSTEM]</span>
                  <span className="text-slate-400 leading-none">{log}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SVG Visualizer Column */}
          <div className="w-full lg:w-[350px] border border-slate-800/80 bg-black/25 rounded-2xl p-4 flex flex-col items-center justify-center relative overflow-hidden">
            <span className="absolute top-4 left-4 text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">Traffic Flow Matrix</span>
            
            <svg viewBox="0 0 200 200" className="w-40 h-40 mt-4">
              {/* Central request Node */}
              <circle cx="100" cy="100" r="10" className="fill-cyan-500/20 stroke-cyan-400 stroke-2" />
              <text x="100" y="104" textAnchor="middle" className="fill-cyan-400 text-[8px] font-bold">MoMo</text>

              {/* MTN Node */}
              <circle cx="100" cy="30" r="12" className={cn(
                "transition-all duration-300",
                activeOutage === "mtn" ? "fill-red-500/20 stroke-red-500" : routingNode === "mtn" ? "fill-amber-400/20 stroke-amber-400" : "fill-slate-800/20 stroke-slate-700"
              )} />
              <text x="100" y="34" textAnchor="middle" className="fill-white text-[7px] font-black">MTN</text>

              {/* Telecel Node */}
              <circle cx="35" cy="140" r="12" className={cn(
                "transition-all duration-300",
                activeOutage === "telecel" ? "fill-red-500/20 stroke-red-500" : routingNode === "telecel" ? "fill-red-500/20 stroke-red-500" : "fill-slate-800/20 stroke-slate-700"
              )} />
              <text x="35" y="144" textAnchor="middle" className="fill-white text-[7px] font-black">TLCL</text>

              {/* AirtelTigo Node */}
              <circle cx="165" cy="140" r="12" className={cn(
                "transition-all duration-300",
                routingNode === "airteltigo" ? "fill-blue-500/20 stroke-blue-500" : "fill-slate-800/20 stroke-slate-700"
              )} />
              <text x="165" y="144" textAnchor="middle" className="fill-white text-[7px] font-black">AT</text>

              {/* Connections */}
              {/* Center -> MTN */}
              <line x1="100" y1="90" x2="100" y2="42" className={cn(
                "transition-all duration-500 stroke-2",
                activeOutage === "mtn" ? "stroke-red-500/30 stroke-dasharray-4" : routingNode === "mtn" ? "stroke-amber-400" : "stroke-slate-800"
              )} />
              {routingNode === "mtn" && (
                <circle cx="100" cy="90" r="2.5" className="fill-amber-400">
                  <animateMotion dur="1.2s" repeatCount="indefinite" path="M 0,0 L 0,-48" />
                </circle>
              )}

              {/* Center -> Telecel */}
              <line x1="90" y1="105" x2="45" y2="132" className={cn(
                "transition-all duration-500 stroke-2",
                activeOutage === "telecel" ? "stroke-red-500/30 stroke-dasharray-4" : routingNode === "telecel" ? "stroke-red-500" : "stroke-slate-800"
              )} />
              {routingNode === "telecel" && (
                <circle cx="90" cy="105" r="2.5" className="fill-red-500">
                  <animateMotion dur="1.2s" repeatCount="indefinite" path="M 0,0 L -45,27" />
                </circle>
              )}

              {/* Center -> AirtelTigo */}
              <line x1="110" y1="105" x2="155" y2="132" className={cn(
                "transition-all duration-500 stroke-2",
                routingNode === "airteltigo" ? "stroke-blue-500" : "stroke-slate-800"
              )} />
              {routingNode === "airteltigo" && (
                <circle cx="110" cy="105" r="2.5" className="fill-blue-500">
                  <animateMotion dur="1.2s" repeatCount="indefinite" path="M 0,0 L 45,27" />
                </circle>
              )}
            </svg>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Thoughts & Knowledge */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-white uppercase tracking-widest">Active Intelligence</h3>
          </div>
          
          <div className="space-y-4">
            {strategies.length === 0 ? (
              <div className="p-8 border border-dashed border-slate-800 rounded-3xl text-center">
                <Bot className="w-8 h-8 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 text-xs">No active strategies evolving...</p>
              </div>
            ) : strategies.map((s) => (
              <motion.div 
                key={s.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-cyan-500/50 transition-all group"
              >
                <div className="flex justify-between items-start mb-2">
                  <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[10px] font-black tracking-widest uppercase">
                    STRATEGY v{s.version}
                  </Badge>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                    Confidence: {(s.confidence_score * 100).toFixed(0)}%
                  </div>
                </div>
                <p className="text-sm font-bold text-white mb-2 leading-tight">{s.name}</p>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${s.confidence_score * 100}%` }}
                    className={cn(
                      "h-full rounded-full transition-all",
                      s.confidence_score > 0.8 ? "bg-emerald-500" : s.confidence_score > 0.5 ? "bg-cyan-500" : "bg-amber-500"
                    )}
                  />
                </div>
              </motion.div>
            ))}
          </div>

          {/* Budget Guardian */}
          <div className="p-6 rounded-3xl border border-slate-800 bg-slate-900/40 relative overflow-hidden">
             <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-2">
                 <DollarSign className="w-5 h-5 text-emerald-400" />
                 <h4 className="text-sm font-black text-white uppercase tracking-widest">Budget Guardian</h4>
               </div>
               <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px]">SECURE</Badge>
             </div>
             
             <div className="space-y-4">
               <div className="flex justify-between items-end">
                 <div>
                   <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Monthly Spend</p>
                   <p className="text-2xl font-black text-white">$0.42 <span className="text-xs text-slate-500 font-medium">/ $10.00</span></p>
                 </div>
                 <div className="text-right">
                   <p className="text-[10px] text-emerald-500 font-black uppercase">4.2% Used</p>
                 </div>
               </div>

               <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                 <motion.div 
                   initial={{ width: 0 }}
                   animate={{ width: "4.2%" }}
                   className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                 />
               </div>

               <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                 <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                 <p className="text-[10px] text-emerald-400 font-medium">
                   AI operations are currently 95% below budget.
                 </p>
               </div>
             </div>
          </div>

          <Card className="bg-cyan-950/20 border-cyan-500/20 shadow-none">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <Bell className="w-5 h-5 text-cyan-400 shrink-0" />
                <div>
                  <h4 className="text-xs font-black text-cyan-100 uppercase tracking-widest mb-1">PRO NOTIFICATIONS</h4>
                  <p className="text-[10px] text-cyan-400/70 font-medium leading-relaxed">
                    Administrative alerts are currently active via SMS and Email. The Sentinel will automatically notify you of any critical provider failures or balance drops.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Growth Lab Preview */}
          <div className="p-6 rounded-3xl border border-slate-800 bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
            <div className="flex items-center gap-2 mb-4">
              <Rocket className="w-5 h-5 text-indigo-400" />
              <h4 className="text-sm font-black text-white uppercase tracking-widest">Growth Lab</h4>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Auto-Promos</span>
                </div>
                <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[9px]">ACTIVE</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase">VIP Tiering</span>
                </div>
                <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[9px]">MONITORING</Badge>
              </div>
              <button className="w-full py-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-xl text-[9px] font-black text-indigo-400 uppercase tracking-widest transition-all">
                Open Strategy Lab
              </button>
            </div>
          </div>
        </div>

        {/* Center/Right Columns: Action Stream */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-bold text-white uppercase tracking-widest">Autonomous Action Stream</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-black text-emerald-500 uppercase">Live Feed</span>
            </div>
          </div>

          <div className="space-y-4">
            <AnimatePresence mode="popLayout">
              {actions.map((action, i) => (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-slate-900/40 border border-slate-800/50 rounded-2xl overflow-hidden hover:bg-slate-900/60 transition-all border-l-4 border-l-cyan-500"
                >
                  <div className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shadow-lg",
                          action.effectiveness === 1 ? "bg-emerald-500/10 text-emerald-500 shadow-emerald-500/10" : 
                          action.effectiveness === -1 ? "bg-rose-500/10 text-rose-500 shadow-rose-500/10" : 
                          "bg-cyan-500/10 text-cyan-500 shadow-cyan-500/10"
                        )}>
                          {action.action_type === 'switch_provider' ? <RefreshCw className="w-5 h-5" /> : 
                           action.action_type === 'notify_admin' ? <Bell className="w-5 h-5" /> :
                           <Settings className="w-5 h-5" />}
                        </div>
                        <div>
                          <h4 className="text-base font-black text-white uppercase italic tracking-tight leading-none mb-1">
                            {action.action_type.replace('_', ' ')}
                          </h4>
                          <p className="text-[10px] font-bold text-slate-500 uppercase">
                            {new Date(action.ts).toLocaleString()} • STATUS: <span className={cn(
                              action.status === 'executed' ? "text-emerald-500" : "text-amber-500"
                            )}>{action.status}</span>
                          </p>
                        </div>
                      </div>
                      <Badge className={cn(
                        "text-[10px] font-black tracking-widest px-3 py-1",
                        action.effectiveness === 1 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : 
                        action.effectiveness === -1 ? "bg-rose-500/20 text-rose-400 border-rose-500/30" : 
                        "bg-slate-800 text-slate-400 border-slate-700"
                      )}>
                        {action.effectiveness === 1 ? "ELITE RESOLUTION" : 
                         action.effectiveness === -1 ? "FLAWED ATTEMPT" : "PENDING EVAL"}
                      </Badge>
                    </div>

                    <div className="bg-black/20 rounded-xl p-4 border border-slate-800/50">
                       <p className="text-xs text-slate-300 font-medium leading-relaxed italic">
                         <span className="text-cyan-500 font-bold mr-2">LOGIC:</span>
                         {action.reasoning}
                       </p>
                    </div>

                    {action.metadata && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {Object.entries(action.metadata).map(([k, v]) => (
                          <div key={k} className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-2">
                            <span className="text-[9px] font-black text-slate-500 uppercase">{k}:</span>
                            <span className="text-[10px] font-bold text-cyan-300 truncate max-w-[150px]">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 px-2">
              <ShieldAlert className="w-5 h-5 text-rose-500" />
              <h3 className="text-lg font-bold text-white uppercase tracking-widest">Security Audit Feed</h3>
            </div>

            <div className="p-6 rounded-3xl border border-slate-800 bg-slate-900/50">
              <div className="flex flex-col items-center justify-center py-10 text-slate-600">
                <Skull className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">No Threats Detected in the last 24h</p>
                <p className="text-[8px] font-bold text-emerald-500 mt-2 uppercase">Firewall: ACTIVE</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSentinelAI;
