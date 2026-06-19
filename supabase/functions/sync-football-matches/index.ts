import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAdmin } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FLAG_MAP: Record<string, string> = {
  "ghana": "🇬🇭",
  "uruguay": "🇺🇾",
  "brazil": "🇧🇷",
  "france": "🇫🇷",
  "england": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "senegal": "🇸🇳",
  "portugal": "🇵🇹",
  "congo dr": "🇨🇩",
  "dr congo": "🇨🇩",
  "croatia": "🇭🇷",
  "panama": "🇵🇦",
  "uzbekistan": "🇺🇿",
  "colombia": "🇨🇴",
  "argentina": "🇦🇷",
  "germany": "🇩🇪",
  "spain": "🇪🇸",
  "italy": "🇮🇹",
  "belgium": "🇧🇪",
  "netherlands": "🇳🇱",
  "usa": "🇺🇸",
  "united states": "🇺🇸",
  "mexico": "🇲🇽",
  "canada": "🇨🇦",
  "japan": "🇯🇵",
  "south korea": "🇰🇷",
  "morocco": "🇲🇦",
  "tunisia": "🇹🇳",
  "cameroon": "🇨🇲",
  "ecuador": "🇪🇨",
  "qatar": "🇶🇦",
  "wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "iran": "🇮🇷",
  "saudi arabia": "🇸🇦",
  "poland": "🇵🇱",
  "australia": "🇦🇺",
  "denmark": "🇩🇰",
  "costa rica": "🇨🇷",
  "switzerland": "🇨🇭",
  "serbia": "🇷🇸"
};

function normalizeTeamName(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

function getFlag(teamName: string): string {
  const norm = normalizeTeamName(teamName);
  return FLAG_MAP[norm] || "⚽";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const FOOTBALL_DATA_API_KEY = Deno.env.get("FOOTBALL_DATA_API_KEY")?.trim();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // SECURITY: Require admin or service-role key (cron job uses service role)
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  if (!isServiceRole) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));
        if (payload.role === 'service_role') {
          // Verify JWT signature by making a lightweight DB query
          const tempClient = createClient(SUPABASE_URL, token);
          const { error: verifyErr } = await tempClient.from("world_cup_matches").select("id").limit(1);
          if (!verifyErr) {
            isServiceRole = true;
          }
        }
      }
    } catch (err) {
      console.warn("Failed to verify service_role JWT:", err);
    }
  }

  if (!isServiceRole) {
    const authResult = await verifyAdmin(req, supabase);
    if (!authResult.success) {
      return new Response(JSON.stringify({ success: false, error: authResult.error }), {
        status: authResult.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    let apiMatches: any[] = [];
    let apiFetched = false;

    // 1. Fetch live matches from Football API if key is present
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

    // 2. Fetch current matches in our database
    const { data: dbMatches, error: dbError } = await supabase
      .from("world_cup_matches")
      .select("*");

    if (dbError) throw dbError;

    const settledMatches: any[] = [];
    const importedMatches: any[] = [];

    if (apiFetched && apiMatches.length > 0) {
      console.log("Running in LIVE sync mode. Importing and settling matches...");

      for (const apiM of apiMatches) {
        const homeName = apiM.homeTeam?.name;
        const awayName = apiM.awayTeam?.name;
        if (!homeName || !awayName) continue;

        const normHome = normalizeTeamName(homeName);
        const normAway = normalizeTeamName(awayName);

        // Find existing match in database
        const existingDbMatch = dbMatches?.find(m => {
          return normalizeTeamName(m.home_team) === normHome && normalizeTeamName(m.away_team) === normAway;
        });

        let matchId = existingDbMatch?.id;

        // If match doesn't exist locally, import it!
        if (!existingDbMatch) {
          console.log(`Importing new match from API: ${homeName} vs ${awayName}`);
          const { data: newMatch, error: importErr } = await supabase
            .from("world_cup_matches")
            .insert({
              home_team: homeName,
              home_flag: getFlag(homeName),
              away_team: awayName,
              away_flag: getFlag(awayName),
              kickoff: apiM.utcDate,
              status: "pending"
            })
            .select()
            .single();

          if (importErr) {
            console.error(`Failed to import match ${homeName} vs ${awayName}:`, importErr);
            continue;
          }

          matchId = newMatch.id;
          importedMatches.push({ id: matchId, teams: `${homeName} vs ${awayName}` });
        }

        // Determine if match status needs to be updated/settled
        const currentStatus = existingDbMatch?.status || "pending";
        if (currentStatus === "pending" && apiM.status === "FINISHED") {
          let result: "home" | "away" | "draw" = "draw";
          const homeScore = apiM.score?.fullTime?.home;
          const awayScore = apiM.score?.fullTime?.away;

          if (homeScore !== null && awayScore !== null) {
            if (homeScore > awayScore) result = "home";
            else if (homeScore < awayScore) result = "away";
          } else {
            const winner = apiM.score?.winner;
            if (winner === "HOME_TEAM") result = "home";
            else if (winner === "AWAY_TEAM") result = "away";
          }

          console.log(`Settling match ${matchId} (${homeName} vs ${awayName}) with outcome: ${result}`);
          const { data: settleRes, error: settleErr } = await supabase.rpc("system_settle_world_cup_match_v2", {
            p_match_id: matchId,
            p_result: result,
            p_points: 10
          });

          if (settleErr) {
            console.error(`Error settling match ${matchId}:`, settleErr);
          } else {
            settledMatches.push({ id: matchId, teams: `${homeName} vs ${awayName}`, result, method: "live_api", details: settleRes });
          }
        }
      }
    } else {
      console.log("Football API key not configured or API fetch failed. Auto-settle is disabled to protect accuracy. Manual settlement or API config required.");
    }

    return new Response(JSON.stringify({ 
      success: true, 
      live_sync_active: apiFetched,
      imported_count: importedMatches.length,
      imported_matches: importedMatches,
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
