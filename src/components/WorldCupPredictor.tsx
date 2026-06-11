import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Clock, HelpCircle, Check, AlertCircle, Calendar } from "lucide-react";
import { playWorldCupGoalSound, triggerWorldCupConfetti } from "@/lib/sound";
import { useAppTheme } from "@/contexts/ThemeContext";

export interface Match {
  id: string;
  homeTeam: string;
  homeFlag: string;
  awayTeam: string;
  awayFlag: string;
  kickoff: string; // ISO string
}

// Configured World Cup matches for the dashboard
export const WORLD_CUP_MATCHES: Match[] = [
  {
    id: "wc_match_1",
    homeTeam: "Ghana",
    homeFlag: "🇬🇭",
    awayTeam: "Uruguay",
    awayFlag: "🇺🇾",
    kickoff: "2026-06-12T15:00:00Z"
  },
  {
    id: "wc_match_2",
    homeTeam: "Brazil",
    homeFlag: "🇧🇷",
    awayTeam: "France",
    awayFlag: "🇫🇷",
    kickoff: "2026-06-12T19:00:00Z"
  },
  {
    id: "wc_match_3",
    homeTeam: "England",
    homeFlag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    awayTeam: "Senegal",
    awayFlag: "🇸🇳",
    kickoff: "2026-06-13T16:00:00Z"
  }
];

interface PredictionData {
  match_id: string;
  prediction: string; // 'home' | 'draw' | 'away'
  status: string; // 'pending' | 'correct' | 'incorrect'
}

const WorldCupPredictor = () => {
  const { user } = useAuth();
  const { isDark, theme } = useAppTheme();
  const [predictions, setPredictions] = useState<Record<string, PredictionData>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch existing predictions for this user
  useEffect(() => {
    const fetchPredictions = async () => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from("world_cup_predictions")
          .select("match_id, prediction, status")
          .eq("user_id", user.id);

        if (error) throw error;

        const predMap: Record<string, PredictionData> = {};
        if (data) {
          data.forEach((p: any) => {
            predMap[p.match_id] = p;
          });
        }
        setPredictions(predMap);
      } catch (err) {
        console.error("Failed to load predictions:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchPredictions();
  }, [user]);

  const handlePredict = async (matchId: string, choice: 'home' | 'draw' | 'away') => {
    if (!user) {
      toast.error("Please log in to make predictions");
      return;
    }

    setSubmitting(matchId);
    try {
      const { data, error } = await supabase.rpc("submit_world_cup_prediction", {
        p_match_id: matchId,
        p_prediction: choice
      });

      if (error) throw error;
      
      const res = data as any;
      if (res.success) {
        setPredictions(prev => ({
          ...prev,
          [matchId]: {
            match_id: matchId,
            prediction: choice,
            status: "pending"
          }
        }));

        toast.success("Prediction locked in! Good luck! ⚽");
        
        // Trigger celebratory effects
        triggerWorldCupConfetti();
        playWorldCupGoalSound();
      } else {
        toast.error(res.error || "Failed to submit prediction");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to submit prediction");
    } finally {
      setSubmitting(null);
    }
  };

  if (!user) return null;

  return (
    <div className={`relative rounded-3xl overflow-hidden border ${
      isDark 
        ? "border-emerald-500/20 bg-gradient-to-br from-[#061f10]/80 via-[#020a05]/95 to-black/95 shadow-[0_16px_40px_-15px_rgba(16,185,129,0.15)]" 
        : "border-gray-200 bg-white shadow-xl shadow-gray-100"
    } p-5 sm:p-6`}>
      {/* Decorative vector elements simulating pitch lines */}
      <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06] pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-4 border-white rounded-full" />
        <div className="absolute top-0 bottom-0 left-1/2 w-1 bg-white" />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-3 border-b border-white/5 relative z-10">
        <div>
          <h3 className="text-lg font-black tracking-tight flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500 animate-bounce" />
            <span>World Cup Predictor</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">Predict the correct outcome and score 10 SwiftPoints! 🏆</p>
        </div>
        <div className="px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 font-bold text-[10px] uppercase tracking-wider w-fit">
          10 pts per correct pick
        </div>
      </div>

      {loading ? (
        <div className="space-y-3.5">
          {[1, 2].map(i => (
            <div key={i} className="h-28 rounded-2xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4 relative z-10">
          {WORLD_CUP_MATCHES.map((match) => {
            const pred = predictions[match.id];
            const isMatchStarted = new Date(match.kickoff) <= new Date();
            const kickoffDate = new Date(match.kickoff);
            
            return (
              <div
                key={match.id}
                className={`rounded-2xl border p-4 transition-all duration-300 ${
                  pred?.status === "correct"
                    ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_8px_20px_-8px_rgba(16,185,129,0.2)]"
                    : pred?.status === "incorrect"
                      ? "border-red-500/20 bg-red-500/5"
                      : isDark
                        ? "border-white/5 bg-[#0a110d]/40"
                        : "border-gray-100 bg-gray-50/50"
                }`}
              >
                {/* Match Details header */}
                <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground/80 mb-3 font-mono">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-amber-500" />
                    {kickoffDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at {kickoffDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  
                  {/* Result/Badge Indicators */}
                  {pred ? (
                    pred.status === "correct" ? (
                      <span className="text-emerald-400 flex items-center gap-1 font-black text-[10px] uppercase bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                        <Check className="w-3 h-3" /> Correct +10 pts
                      </span>
                    ) : pred.status === "incorrect" ? (
                      <span className="text-red-400 flex items-center gap-1 font-black text-[10px] uppercase bg-red-500/10 px-2 py-0.5 rounded-lg border border-red-500/20">
                        <AlertCircle className="w-3 h-3" /> Incorrect Pick
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-1 font-black text-[10px] uppercase bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                        <Clock className="w-3 h-3 animate-spin-reverse" /> Pending Settle
                      </span>
                    )
                  ) : isMatchStarted ? (
                    <span className="text-red-400/80 font-black text-[9px] uppercase">Locked</span>
                  ) : (
                    <span className="text-primary font-black text-[9px] uppercase tracking-wider" style={{ color: `hsl(${theme.primary})` }}>Open</span>
                  )}
                </div>

                {/* Team display */}
                <div className="grid grid-cols-5 items-center justify-items-center mb-4">
                  <div className="col-span-2 flex flex-col items-center gap-1 text-center">
                    <span className="text-3xl select-none" role="img" aria-label={match.homeTeam}>{match.homeFlag}</span>
                    <span className="text-xs font-black tracking-tight text-foreground">{match.homeTeam}</span>
                  </div>
                  <div className="col-span-1 flex flex-col items-center justify-center font-black text-xs text-muted-foreground/60 italic">
                    VS
                  </div>
                  <div className="col-span-2 flex flex-col items-center gap-1 text-center">
                    <span className="text-3xl select-none" role="img" aria-label={match.awayTeam}>{match.awayFlag}</span>
                    <span className="text-xs font-black tracking-tight text-foreground">{match.awayTeam}</span>
                  </div>
                </div>

                {/* Button actions */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "home", label: `${match.homeTeam} Win` },
                    { key: "draw", label: "Draw 🤝" },
                    { key: "away", label: `${match.awayTeam} Win` }
                  ].map((btn) => {
                    const isSelected = pred?.prediction === btn.key;
                    const isDisabled = isMatchStarted || submitting !== null || pred?.status !== undefined;
                    
                    return (
                      <button
                        key={btn.key}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => handlePredict(match.id, btn.key as any)}
                        className={`h-9 rounded-xl text-[10px] font-black uppercase tracking-wide border transition-all active:scale-[0.97] ${
                          isSelected
                            ? pred.status === "correct"
                              ? "bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20"
                              : pred.status === "incorrect"
                                ? "bg-red-500/80 border-red-500 text-white"
                                : "bg-primary border-primary/20 text-primary-foreground shadow-lg shadow-primary/20"
                            : "bg-background border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                        } disabled:opacity-40 disabled:pointer-events-none`}
                        style={isSelected && pred?.status === "pending" ? { background: `hsl(${theme.primary})`, color: "#000" } : {}}
                      >
                        {submitting === match.id && isSelected ? "..." : btn.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorldCupPredictor;
