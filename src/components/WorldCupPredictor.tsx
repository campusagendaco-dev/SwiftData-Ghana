import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Clock, HelpCircle, Check, AlertCircle, Calendar } from "lucide-react";
import { playWorldCupGoalSound, triggerWorldCupConfetti } from "@/lib/sound";
import { useAppTheme } from "@/contexts/ThemeContext";
import { getFlagUrl } from "@/lib/utils";

export interface Match {
  id: string;
  homeTeam: string;
  homeFlag: string;
  awayTeam: string;
  awayFlag: string;
  kickoff: string; // ISO string
  status?: 'pending' | 'settled';
  result?: 'home' | 'draw' | 'away';
}

// Configured default matches (fallback)
export const DEFAULT_WORLD_CUP_MATCHES: Match[] = [];

// Re-export as WORLD_CUP_MATCHES for external compatibility
export const WORLD_CUP_MATCHES = DEFAULT_WORLD_CUP_MATCHES;

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
  const [dbNeedsSync, setDbNeedsSync] = useState(false);
  const [matches, setMatches] = useState<Match[]>(DEFAULT_WORLD_CUP_MATCHES);

  // Fetch matches and existing predictions
  useEffect(() => {
    const loadData = async () => {
      if (!user) return;
      try {
        // 1. Fetch matches from database
        const { data: matchesData, error: matchesError } = await supabase
          .from("world_cup_matches")
          .select("*")
          .order("kickoff", { ascending: true });

        if (matchesError) {
          if (matchesError.message?.includes("relation") && matchesError.message?.includes("does not exist")) {
            setDbNeedsSync(true);
            setMatches(DEFAULT_WORLD_CUP_MATCHES);
          } else {
            throw matchesError;
          }
        } else if (matchesData) {
          const formattedMatches = matchesData.map((m: any) => ({
            id: m.id,
            homeTeam: m.home_team,
            homeFlag: m.home_flag,
            awayTeam: m.away_team,
            awayFlag: m.away_flag,
            kickoff: m.kickoff,
            status: m.status,
            result: m.result
          }));
          
          // Filter to today's matches only (local timezone)
          const todayStr = new Date().toDateString();
          const todayMatches = formattedMatches.filter((m: any) => {
            return new Date(m.kickoff).toDateString() === todayStr;
          });
          
          // Sort by team popularity to ensure top matches are prioritized
          const popularTeams = [
            'brazil', 'argentina', 'france', 'germany', 'spain', 'england', 
            'portugal', 'netherlands', 'belgium', 'italy', 'uruguay', 
            'croatia', 'usa', 'united states', 'mexico', 'ghana', 
            'south korea', 'switzerland', 'canada'
          ];
          
          const getPopularityScore = (match: any) => {
            let score = 0;
            const home = match.homeTeam.toLowerCase();
            const away = match.awayTeam.toLowerCase();
            if (popularTeams.some(t => home.includes(t))) score += 10;
            if (popularTeams.some(t => away.includes(t))) score += 10;
            return score;
          };
          
          todayMatches.sort((a: any, b: any) => getPopularityScore(b) - getPopularityScore(a));
          
          // Show only top 4 popular matches
          setMatches(todayMatches.slice(0, 4));
        }

        // 2. Fetch predictions
        const { data: predData, error: predError } = await supabase
          .from("world_cup_predictions")
          .select("match_id, prediction, status")
          .eq("user_id", user.id);

        if (predError) {
          if (predError.message?.includes("relation") && predError.message?.includes("does not exist")) {
            setDbNeedsSync(true);
            const cached = localStorage.getItem("wc_predictions_fallback");
            if (cached) {
              setPredictions(JSON.parse(cached));
            }
            return;
          }
          throw predError;
        }

        const predMap: Record<string, PredictionData> = {};
        if (predData) {
          predData.forEach((p: any) => {
            predMap[p.match_id] = p;
          });
        }
        setPredictions(predMap);
      } catch (err) {
        console.warn("Predictions DB not synced yet. Falling back to local demo mode.");
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Listen for match changes
    const matchesChannel = supabase
      .channel("world-cup-matches-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "world_cup_matches" }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(matchesChannel);
    };
  }, [user]);

  const handlePredict = async (matchId: string, choice: 'home' | 'draw' | 'away') => {
    if (!user) {
      toast.error("Please log in to make predictions");
      return;
    }

    if (dbNeedsSync) {
      // Local fallback prediction mode
      const updated = {
        ...predictions,
        [matchId]: {
          match_id: matchId,
          prediction: choice,
          status: "pending"
        }
      };
      setPredictions(updated);
      localStorage.setItem("wc_predictions_fallback", JSON.stringify(updated));
      
      toast.success("Prediction saved locally! (Demo Mode: Sync Database to go live) ⚽");
      
      triggerWorldCupConfetti();
      playWorldCupGoalSound();
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
    <div className={`relative rounded-2xl overflow-hidden border ${
      isDark 
        ? "border-emerald-500/20 bg-gradient-to-br from-[#061f10]/80 via-[#020a05]/95 to-black/95 shadow-[0_12px_32px_-12px_rgba(16,185,129,0.12)]" 
        : "border-gray-200 bg-white shadow-lg shadow-gray-100"
    } p-3.5 sm:p-4`}>
      {/* Decorative vector elements simulating pitch lines */}
      <div className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 border-2 border-white rounded-full" />
        <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-white" />
      </div>

      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-white/5 relative z-10">
        <div className="flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-amber-500 animate-pulse" />
          <div>
            <h3 className="text-xs sm:text-sm font-black tracking-tight flex items-center gap-1 text-foreground">
              World Cup Predictor
            </h3>
            <p className="text-[9px] sm:text-[10px] text-muted-foreground font-medium">Predict outcomes & win SwiftPoints! 🏆</p>
          </div>
        </div>
        <div className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 font-black text-[9px] uppercase tracking-wider shrink-0">
          10 pts / pick
        </div>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-[280px] sm:w-[310px] shrink-0 h-28 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex overflow-x-auto gap-3 pb-2.5 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] relative z-10 w-full">
          {matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 px-4 w-full border border-dashed border-emerald-500/20 rounded-xl bg-emerald-500/5">
              <Clock className="w-8 h-8 text-amber-500 mb-2 animate-pulse" />
              <p className="text-xs font-bold text-center text-foreground">No matches scheduled for today</p>
              <p className="text-[10px] text-center text-muted-foreground mt-0.5 font-medium">Check back tomorrow for the next round! ⚽</p>
            </div>
          ) : (
            matches.map((match) => {
            const pred = predictions[match.id];
            const isMatchStarted = new Date(match.kickoff) <= new Date();
            const kickoffDate = new Date(match.kickoff);
            
            return (
              <div
                key={match.id}
                className={`w-[280px] sm:w-[310px] shrink-0 snap-start rounded-xl border p-2.5 sm:p-3 transition-all duration-300 ${
                  pred?.status === "correct"
                    ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_6px_16px_-6px_rgba(16,185,129,0.15)]"
                    : pred?.status === "incorrect"
                      ? "border-red-500/20 bg-red-500/5"
                      : isDark
                        ? "border-white/5 bg-[#0a110d]/40"
                        : "border-gray-100 bg-gray-50/50"
                }`}
              >
                {/* Match Details header */}
                <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-bold text-muted-foreground/80 mb-2 font-mono">
                  <span className="flex items-center gap-0.5">
                    <Calendar className="w-3 h-3 text-amber-500" />
                    {kickoffDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at {kickoffDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  
                  {/* Result/Badge Indicators */}
                  {pred ? (
                    pred.status === "correct" ? (
                      <span className="text-emerald-400 flex items-center gap-0.5 font-black text-[8px] sm:text-[9px] uppercase bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        <Check className="w-2.5 h-2.5" /> Correct +10 pts
                      </span>
                    ) : pred.status === "incorrect" ? (
                      <span className="text-red-400 flex items-center gap-0.5 font-black text-[8px] sm:text-[9px] uppercase bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                        <AlertCircle className="w-2.5 h-2.5" /> Incorrect
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-0.5 font-black text-[8px] sm:text-[9px] uppercase bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        <Clock className="w-2.5 h-2.5 animate-spin-reverse" /> Pending
                      </span>
                    )
                  ) : isMatchStarted ? (
                    <span className="text-red-400/80 font-black text-[8px] uppercase">Locked</span>
                  ) : (
                    <span className="text-primary font-black text-[8px] uppercase tracking-wider" style={{ color: `hsl(${theme.primary})` }}>Open</span>
                  )}
                </div>

                {/* Team display */}
                <div className="grid grid-cols-5 items-center justify-items-center mb-2">
                  <div className="col-span-2 flex flex-col items-center gap-1.5 text-center">
                    <div className="relative">
                      {(() => {
                        const flagUrl = getFlagUrl(match.homeFlag) || getFlagUrl(match.homeTeam);
                        return flagUrl ? (
                          <img 
                            src={flagUrl} 
                            alt={match.homeTeam} 
                            className="w-10 h-7 object-cover rounded shadow-sm border border-white/10"
                          />
                        ) : (
                          <span className="text-2xl select-none" role="img" aria-label={match.homeTeam}>{match.homeFlag}</span>
                        );
                      })()}
                      {match.status === 'settled' && match.result === 'home' && (
                        <span className="absolute -top-1.5 -right-1.5 text-xs animate-bounce" role="img" aria-label="winner">🏆</span>
                      )}
                    </div>
                    <span className="text-[10px] sm:text-xs font-black tracking-tight text-foreground truncate max-w-[100px]">{match.homeTeam}</span>
                  </div>
                  <div className="col-span-1 flex flex-col items-center justify-center font-black text-[9px] text-muted-foreground/60 italic">
                    {match.status === 'settled' && match.result === 'draw' ? (
                      <span className="text-xs not-italic" role="img" aria-label="draw">🤝</span>
                    ) : (
                      "VS"
                    )}
                  </div>
                  <div className="col-span-2 flex flex-col items-center gap-1.5 text-center">
                    <div className="relative">
                      {(() => {
                        const flagUrl = getFlagUrl(match.awayFlag) || getFlagUrl(match.awayTeam);
                        return flagUrl ? (
                          <img 
                            src={flagUrl} 
                            alt={match.awayTeam} 
                            className="w-10 h-7 object-cover rounded shadow-sm border border-white/10"
                          />
                        ) : (
                          <span className="text-2xl select-none" role="img" aria-label={match.awayTeam}>{match.awayFlag}</span>
                        );
                      })()}
                      {match.status === 'settled' && match.result === 'away' && (
                        <span className="absolute -top-1.5 -right-1.5 text-xs animate-bounce" role="img" aria-label="winner">🏆</span>
                      )}
                    </div>
                    <span className="text-[10px] sm:text-xs font-black tracking-tight text-foreground truncate max-w-[100px]">{match.awayTeam}</span>
                  </div>
                </div>

                {/* Button actions */}
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { key: "home", label: `${match.homeTeam}` },
                    { key: "draw", label: "Draw 🤝" },
                    { key: "away", label: `${match.awayTeam}` }
                  ].map((btn) => {
                    const isSelected = pred?.prediction === btn.key;
                    const isWinner = match.status === 'settled' && match.result === btn.key;
                    const isDisabled = isMatchStarted || submitting !== null || pred?.status !== undefined;
                    
                    return (
                      <button
                        key={btn.key}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => handlePredict(match.id, btn.key as any)}
                        className={`h-7.5 rounded-lg text-[9px] font-black uppercase tracking-wide border transition-all active:scale-[0.97] truncate px-1 ${
                          isSelected
                            ? pred.status === "correct"
                              ? "bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20"
                              : pred.status === "incorrect"
                                ? "bg-red-500/80 border-red-500 text-white"
                                : "bg-primary border-primary/20 text-primary-foreground shadow-lg shadow-primary/20"
                            : isWinner
                              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                              : "bg-background border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                        } ${isDisabled && !isWinner ? "disabled:opacity-40" : ""} disabled:pointer-events-none`}
                        style={isSelected && pred?.status === "pending" ? { background: `hsl(${theme.primary})`, color: "#000" } : {}}
                      >
                        {submitting === match.id && isSelected ? "..." : btn.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
      )}
      {dbNeedsSync && (
        <div className="mt-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-bold leading-normal flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 animate-pulse" />
          <div>
            <span className="uppercase tracking-wider">Database Sync Required: </span>
            <span className="font-medium text-white/80">The prediction schema has been successfully pushed. Settle predictions are running in Local Demo Mode. Click "Publish" or sync in Lovable to activate database tables.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldCupPredictor;
