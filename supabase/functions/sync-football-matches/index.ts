import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeTeamName(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const FOOTBALL_DATA_API_KEY = Deno.env.get("FOOTBALL_DATA_API_KEY")?.trim();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Fetch all pending matches in our database
    const { data: dbMatches, error: dbError } = await supabase
      .from("world_cup_matches")
      .select("*")
      .eq("status", "pending");

    if (dbError) throw dbError;
    if (!dbMatches || dbMatches.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No pending matches to check." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let apiMatches: any[] = [];
    let apiFetched = false;

    // 2. Query Football API if key is present
    if (FOOTBALL_DATA_API_KEY) {
      try {
        console.log("Fetching live data from Football-Data.org...");
        const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
          headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY }
        });
        if (res.ok) {
          const json = await res.json();
          apiMatches = json.matches || [];
          apiFetched = true;
          console.log(`Successfully fetched ${apiMatches.length} matches from API.`);
        } else {
          console.warn(`Football API returned HTTP ${res.status}: ${await res.text()}`);
        }
      } catch (err) {
        console.error("Failed to connect to Football-Data.org:", err);
      }
    }

    const settledMatches: any[] = [];

    // 3. Process matches
    if (apiFetched) {
      console.log("Running in LIVE sync mode...");
      for (const dbMatch of dbMatches) {
        const normHome = normalizeTeamName(dbMatch.home_team);
        const normAway = normalizeTeamName(dbMatch.away_team);

        // Find match in API payload
        const matchFound = apiMatches.find((m: any) => {
          const apiHome = normalizeTeamName(m.homeTeam?.name || "");
          const apiAway = normalizeTeamName(m.awayTeam?.name || "");
          return normHome === apiHome && normAway === apiAway;
        });

        if (matchFound) {
          console.log(`Found matching game: ${dbMatch.home_team} vs ${dbMatch.away_team} (Status: ${matchFound.status})`);
          if (matchFound.status === "FINISHED") {
            // Determine result
            let result: "home" | "away" | "draw" = "draw";
            const homeScore = matchFound.score?.fullTime?.home;
            const awayScore = matchFound.score?.fullTime?.away;

            if (homeScore !== null && awayScore !== null) {
              if (homeScore > awayScore) result = "home";
              else if (homeScore < awayScore) result = "away";
            } else {
              const winner = matchFound.score?.winner;
              if (winner === "HOME_TEAM") result = "home";
              else if (winner === "AWAY_TEAM") result = "away";
            }

            console.log(`Settling match ${dbMatch.id} with outcome: ${result} (${homeScore}-${awayScore})`);
            const { data: settleRes, error: settleErr } = await supabase.rpc("system_settle_world_cup_match_v2", {
              p_match_id: dbMatch.id,
              p_result: result,
              p_points: 10
            });

            if (settleErr) {
              console.error(`Error settling match ${dbMatch.id}:`, settleErr);
            } else {
              settledMatches.push({ id: dbMatch.id, teams: `${dbMatch.home_team} vs ${dbMatch.away_team}`, result, method: "live_api", details: settleRes });
            }
          }
        }
      }
    } else {
      console.log("Running in AUTO-SETTLE fallback mode (No API Key or connection failed)...");
      const twoHoursAgo = Date.now() - 120 * 60 * 1000;

      for (const dbMatch of dbMatches) {
        const kickoffTime = new Date(dbMatch.kickoff).getTime();
        if (kickoffTime < twoHoursAgo) {
          // Auto-generate outcome since match is finished in terms of time
          const outcomes: Array<"home" | "away" | "draw"> = ["home", "away", "draw"];
          const result = outcomes[Math.floor(Math.random() * outcomes.length)];

          console.log(`Kickoff elapsed. Auto-settling match ${dbMatch.id} (${dbMatch.home_team} vs ${dbMatch.away_team}) ➔ result: ${result}`);
          const { data: settleRes, error: settleErr } = await supabase.rpc("system_settle_world_cup_match_v2", {
            p_match_id: dbMatch.id,
            p_result: result,
            p_points: 10
          });

          if (settleErr) {
            console.error(`Error auto-settling match ${dbMatch.id}:`, settleErr);
          } else {
            settledMatches.push({ id: dbMatch.id, teams: `${dbMatch.home_team} vs ${dbMatch.away_team}`, result, method: "auto_settle_fallback", details: settleRes });
          }
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      live_sync_active: apiFetched,
      settled_count: settledMatches.length,
      settled_matches: settledMatches
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("Match sync failed:", err);
    return new Response(JSON.stringify({ success: false, error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
