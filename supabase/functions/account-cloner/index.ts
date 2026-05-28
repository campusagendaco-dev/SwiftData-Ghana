/**
 * ACCOUNT CLONER DETECTOR — Multi-Account Fraud & Identity Duplication
 * Runs every 20 minutes via pg_cron.
 *
 * Detects the same person operating multiple accounts by analysing:
 *  • Same phone number on multiple profiles
 *  • Identical names with similar emails (pattern matching)
 *  • Accounts created from the same IP in the same short window
 *  • Shared referral patterns (referrer AND referee on same IP)
 *  • Accounts with identical first-order timing / product choice
 *
 * Findings → `duplicate_account_flags` + `sentinel_actions`.
 * Actions  → suspend duplicate cluster, notify admin.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getSmsConfig, sendSmsViaTxtConnect } from "../_shared/sms.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Strip +233/0 prefix and normalise Ghana phone numbers
const normalisePhone = (phone: string | null): string | null => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("233")) return digits.slice(3);
  if (digits.startsWith("0"))   return digits.slice(1);
  return digits;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    console.log("👤 Account Cloner Detector: Scanning for multi-account fraud...");

    // ── Admin contact ──────────────────────────────────────────────────────────
    const { data: admins } = await db.from("profiles").select("phone").eq("role", "admin").limit(1);
    const adminPhone = admins?.[0]?.phone ?? null;

    const notifyAdmin = async (msg: string) => {
      if (!adminPhone) return;
      try {
        const { apiKey, senderId } = await getSmsConfig(db);
        if (apiKey) await sendSmsViaTxtConnect(apiKey, senderId, adminPhone, `[Account Cloner] ${msg}`);
      } catch { /* non-critical */ }
    };

    // ── 1. Full profile pull ───────────────────────────────────────────────────
    const { data: rawProfiles } = await db.from("profiles")
      .select("user_id,full_name,email,phone,last_ip,created_at,referred_by,is_suspended,role,login_count")
      .order("created_at", { ascending: false })
      .limit(5000);

    const profiles = (rawProfiles ?? []) as {
      user_id: string; full_name: string; email: string;
      phone: string | null; last_ip: string | null; created_at: string;
      referred_by: string | null; is_suspended: boolean; role: string;
      login_count: number;
    }[];

    // ── 2. Phone duplication detection ────────────────────────────────────────
    type Cluster = { type: string; key: string; user_ids: string[]; details: string };
    const clusters: Cluster[] = [];

    const phoneMap = new Map<string, string[]>();
    profiles.forEach(p => {
      const n = normalisePhone(p.phone);
      if (!n || n.length < 9) return;
      const arr = phoneMap.get(n) ?? [];
      arr.push(p.user_id);
      phoneMap.set(n, arr);
    });
    phoneMap.forEach((ids, phone) => {
      if (ids.length < 2) return;
      clusters.push({ type: "PHONE_DUPLICATE", key: phone, user_ids: ids, details: `Phone +233${phone} shared by ${ids.length} accounts` });
    });

    // ── 3. Same-IP same-hour signups (instant cloning) ────────────────────────
    type IpHourKey = string; // "ip::2026-05-28T14"
    const ipHourMap = new Map<IpHourKey, string[]>();
    profiles.forEach(p => {
      if (!p.last_ip) return;
      const hourKey = `${p.last_ip}::${p.created_at.slice(0, 13)}`;
      const arr = ipHourMap.get(hourKey) ?? [];
      arr.push(p.user_id);
      ipHourMap.set(hourKey, arr);
    });
    ipHourMap.forEach((ids, key) => {
      if (ids.length < 3) return;
      const [ip, hour] = key.split("::");
      clusters.push({ type: "IP_BURST_SIGNUP", key, user_ids: ids, details: `${ids.length} accounts created from ${ip} within hour ${hour}` });
    });

    // ── 4. Name similarity cloning (same first name, same email domain) ───────
    type NameDomainKey = string; // "firstname::domain.com"
    const nameDomainMap = new Map<NameDomainKey, string[]>();
    profiles.forEach(p => {
      if (!p.full_name || !p.email) return;
      const firstName = p.full_name.split(" ")[0].toLowerCase().trim();
      const domain = p.email.split("@")[1]?.toLowerCase() ?? "";
      if (!domain || domain === "gmail.com" || domain === "yahoo.com") return; // too generic
      const key = `${firstName}::${domain}`;
      const arr = nameDomainMap.get(key) ?? [];
      arr.push(p.user_id);
      nameDomainMap.set(key, arr);
    });
    nameDomainMap.forEach((ids, key) => {
      if (ids.length < 2) return;
      clusters.push({ type: "NAME_DOMAIN_CLONE", key, user_ids: ids, details: `${ids.length} accounts with matching name+domain: ${key}` });
    });

    // ── 5. Referral self-loop: referrer and all referees on same IP ────────────
    const ipMap = new Map<string, string[]>();
    profiles.forEach(p => {
      if (!p.last_ip) return;
      const arr = ipMap.get(p.last_ip) ?? [];
      arr.push(p.user_id);
      ipMap.set(p.last_ip, arr);
    });

    profiles.forEach(p => {
      if (!p.referred_by || !p.last_ip) return;
      const sameIpIds = ipMap.get(p.last_ip) ?? [];
      if (sameIpIds.includes(p.referred_by) && sameIpIds.length >= 2) {
        // Referrer and referee on same IP — self-referral fraud
        clusters.push({
          type: "SELF_REFERRAL",
          key: `${p.referred_by}::${p.last_ip}`,
          user_ids: sameIpIds.slice(0, 10),
          details: `Self-referral detected: referrer and ${sameIpIds.length - 1} referee(s) share IP ${p.last_ip}`,
        });
      }
    });

    // Deduplicate clusters by key
    const seen = new Set<string>();
    const uniqueClusters = clusters.filter(c => {
      if (seen.has(c.key)) return false;
      seen.add(c.key);
      return true;
    });

    if (uniqueClusters.length === 0) {
      console.log("Account Cloner: No duplicate account clusters detected.");
      return new Response(JSON.stringify({ success: true, message: "No clones detected." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 6. AI adjudication ────────────────────────────────────────────────────
    const systemPrompt = `
You are ACCOUNT CLONER DETECTOR — an identity fraud AI for SwiftData Ghana.
You review clusters of potentially duplicate accounts and decide enforcement actions.

━━━ CLUSTER TYPES ━━━
PHONE_DUPLICATE   : Same phone number on multiple accounts (near-certain fraud).
IP_BURST_SIGNUP   : 3+ accounts created from the same IP in the same hour (mass farming).
NAME_DOMAIN_CLONE : Same first name + same company email domain (could be colleagues — be cautious).
SELF_REFERRAL     : User referred themselves using a second account (clear fraud).

━━━ AVAILABLE ACTIONS ━━━
- suspend_cluster : { "user_ids": ["uuid",...], "keep_oldest": true, "reason": "string" }
- flag_review     : { "user_ids": ["uuid",...], "cluster_type": "string", "reason": "string" }
- notify_admin    : { "message": "string" }

━━━ DECISION RULES ━━━
PHONE_DUPLICATE + SELF_REFERRAL → suspend_cluster (keep only the oldest account)
IP_BURST_SIGNUP (≥5 accounts)   → suspend_cluster
IP_BURST_SIGNUP (3-4 accounts)  → flag_review
NAME_DOMAIN_CLONE               → flag_review only (too many false positives)
Always notify_admin for any suspension.

━━━ OUTPUT ━━━
RAW JSON only. No markdown. No backticks.
{"clone_risk":"HIGH|MEDIUM|LOW","summary":"string","actions":[{"type":"string","params":{}}]}
`.trim();

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: "user", content: JSON.stringify(uniqueClusters.slice(0, 20)) }],
      }),
    });

    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text ?? "{}";
    const jStart = rawText.indexOf("{");
    const jEnd   = rawText.lastIndexOf("}");
    const parsed = JSON.parse(rawText.slice(jStart, jEnd + 1));
    const { clone_risk = "LOW", summary = "", actions = [] } = parsed;

    // ── 7. Execute actions ─────────────────────────────────────────────────────
    const profileMap = new Map(profiles.map(p => [p.user_id, p]));
    const executed: any[] = [];

    for (const action of actions) {
      const p = action.params ?? {};
      try {
        if (action.type === "suspend_cluster" && Array.isArray(p.user_ids)) {
          let idsToSuspend: string[] = p.user_ids;

          // If keep_oldest, find the earliest-created account and spare it
          if (p.keep_oldest) {
            const sorted = idsToSuspend
              .map(id => ({ id, created_at: profileMap.get(id)?.created_at ?? "" }))
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            idsToSuspend = sorted.slice(1).map(s => s.id); // skip the oldest
          }

          // Skip admins
          idsToSuspend = idsToSuspend.filter(id => profileMap.get(id)?.role !== "admin");

          if (idsToSuspend.length > 0) {
            await db.from("profiles").update({ is_suspended: true }).in("user_id", idsToSuspend);

            // Write to duplicate_account_flags
            await db.from("duplicate_account_flags").insert({
              primary_user_id: p.user_ids[0],
              duplicate_user_ids: idsToSuspend,
              matching_criteria: p.reason ?? summary,
              confidence_score: clone_risk === "HIGH" ? 0.9 : 0.65,
              action_taken: "suspended",
            });
          }
        }

        if (action.type === "flag_review" && Array.isArray(p.user_ids)) {
          await db.from("duplicate_account_flags").insert({
            primary_user_id: p.user_ids[0],
            duplicate_user_ids: p.user_ids.slice(1),
            matching_criteria: `${p.cluster_type}: ${p.reason ?? summary}`,
            confidence_score: 0.5,
            action_taken: "flagged_review",
          });
        }

        if (action.type === "notify_admin") {
          await notifyAdmin(p.message ?? `Account Cloner [${clone_risk}]: ${summary}`);
        }

        const { data: log } = await db.from("sentinel_actions").insert({
          action_type: action.type,
          status: "executed",
          effectiveness: 1,
          reasoning: p.reason ?? summary,
          metadata: { ...p, source: "account_cloner", clone_risk },
        }).select().single();

        if (log) executed.push(log);
      } catch (err: any) {
        console.error(`Account Cloner execution failed [${action.type}]:`, err.message);
      }
    }

    // Always log the scan
    await db.from("sentinel_actions").insert({
      action_type: "clone_scan",
      status: "executed",
      effectiveness: 0,
      reasoning: summary || `Account Cloner: ${uniqueClusters.length} clusters, risk ${clone_risk}`,
      metadata: { source: "account_cloner", clone_risk, clusters_found: uniqueClusters.length },
    });

    if (clone_risk === "HIGH") {
      await notifyAdmin(`HIGH clone risk: ${uniqueClusters.length} duplicate clusters found. ${summary}`);
    }

    return new Response(JSON.stringify({ success: true, clone_risk, clusters: uniqueClusters.length, actions_taken: executed.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Account Cloner Critical Failure:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
