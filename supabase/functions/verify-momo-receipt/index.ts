// MoMo receipt checker for support staff (admin with 2FA only).
//   { action: "check", image_base64, image_media_type?, order_id?, expected_amount? }
//   { action: "check", image_url, ... }   image_url must be a file in this project's storage
//   { action: "decide", check_id, decision: "accepted" | "rejected" }
// The AI only reads the picture; fixed rules (momo_receipt.ts) decide the red flags. The
// best result is "no red flags found". Accepting records the admin's decision and credits
// nothing; wallets and orders are handled with the normal admin tools.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { callAiAgent } from "../_shared/ai.ts";
import { checkReceipt, decideReceipt, MAX_IMAGE_BYTES } from "../_shared/momo_receipt_service.ts";

declare const Deno: any;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Only files in this project's Supabase storage, read with a hard size cap. */
async function fetchStorageImage(imageUrl: string, supabaseUrl: string): Promise<{ base64: string; mediaType: string }> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("image_url is not a valid link");
  }
  const own = new URL(supabaseUrl);
  if (url.protocol !== "https:" || url.host !== own.host || !url.pathname.startsWith("/storage/v1/")) {
    throw new Error("image_url must be a file in SwiftData's own storage");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`Could not download the receipt (HTTP ${res.status})`);
    const mediaType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (Number(res.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) throw new Error("The picture is larger than 5 MB");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        controller.abort();
        throw new Error("The picture is larger than 5 MB");
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return { base64: toBase64(all), mediaType };
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "Server misconfigured" }, 500);
  const db = createClient(supabaseUrl, serviceKey);

  // Staff only: an admin who entered their 2FA code (verifyAdmin's default).
  const auth = await verifyAdmin(req, db);
  if (!auth.success) return json({ error: auth.error || "Unauthorized" }, auth.status || 401);
  const adminId = String(auth.user?.id || "");

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "check");

  try {
    if (action === "decide") {
      const res = await decideReceipt(db, { adminId, checkId: String(body?.check_id || ""), decision: body?.decision });
      return json(res.body, res.status);
    }
    if (action !== "check") return json({ error: "Unknown action" }, 400);

    let image: { base64: string; mediaType: string };
    if (body?.image_base64) {
      const raw = String(body.image_base64).trim();
      const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
      image = m ? { mediaType: m[1].toLowerCase(), base64: m[2] } : { mediaType: String(body?.image_media_type || "image/jpeg").toLowerCase(), base64: raw };
    } else if (body?.image_url) {
      try {
        image = await fetchStorageImage(String(body.image_url), supabaseUrl);
      } catch (err: any) {
        return json({ error: err?.message || "Could not read the receipt" }, 400);
      }
    } else {
      return json({ error: "Upload a picture of the receipt" }, 400);
    }

    const expected = Number(body?.expected_amount);
    const res = await checkReceipt(
      db,
      {
        adminId,
        image,
        orderId: body?.order_id ? String(body.order_id).trim() : null,
        expectedAmount: Number.isFinite(expected) && expected > 0 ? expected : null,
      },
      {
        now: new Date(),
        readReceipt: async (system, user, img) => {
          const ai = await callAiAgent(db, "receipt_checker", system, user, 900, {
            imageBase64: img.base64,
            imageMediaType: img.mediaType,
            forceModel: "gpt-4o-mini",
            responseJson: true,
          });
          return { text: ai.text, model: ai.model };
        },
      },
    );
    return json(res.body, res.status);
  } catch (err: any) {
    console.error("[verify-momo-receipt] failed:", err);
    return json({ error: "Could not check the receipt" }, 500);
  }
});
