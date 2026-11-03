import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.42.0";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.1.1";
import {
  decodeAttestationObject,
  isoBase64URL,
  parseAuthenticatorData,
} from "npm:@simplewebauthn/server@13.1.1/helpers";
import { corsHeaders } from "../_shared/cors.ts";

// Hostnames allowed to act as WebAuthn origins / relying parties.
// Override with WEBAUTHN_ALLOWED_HOSTS="swiftdatagh.shop,www.swiftdatagh.shop,localhost".
const ALLOWED_HOSTS = (Deno.env.get("WEBAUTHN_ALLOWED_HOSTS") || "swiftdatagh.shop,www.swiftdatagh.shop")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/** The browser-set Origin of this request, only if it belongs to us. */
function resolveOrigin(req: Request): { origin: string; host: string } | null {
  const raw = req.headers.get("origin") || req.headers.get("referer");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!isAllowedHost(u.hostname)) return null;
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    return { origin: u.origin, host: u.hostname };
  } catch {
    return null;
  }
}

// ── Stateless, signed challenges ────────────────────────────────────────────
// challenge = base64url(nonce[16] | issuedAtMs[8] | hmac[16]); the HMAC proves
// we issued it, issuedAt bounds its lifetime, and a "used" row blocks replay.
async function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("WEBAUTHN_CHALLENGE_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (secret.length < 32) throw new Error("WebAuthn is not configured on the server.");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function issueChallenge(): Promise<string> {
  const buf = new Uint8Array(40);
  buf.set(crypto.getRandomValues(new Uint8Array(16)), 0);
  new DataView(buf.buffer).setBigUint64(16, BigInt(Date.now()));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), buf.slice(0, 24)));
  buf.set(mac.slice(0, 16), 24);
  return isoBase64URL.fromBuffer(buf);
}

async function isValidChallenge(challenge: string): Promise<boolean> {
  let buf: Uint8Array;
  try {
    buf = isoBase64URL.toBuffer(challenge);
  } catch {
    return false;
  }
  if (buf.length !== 40) return false;
  const issuedAt = Number(new DataView(buf.buffer, buf.byteOffset).getBigUint64(16));
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > CHALLENGE_TTL_MS || issuedAt - Date.now() > 30_000) return false;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), buf.slice(0, 24))).slice(0, 16);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= mac[i] ^ buf[24 + i];
  return diff === 0;
}

/** COSE public key bytes for a stored credential (handles legacy rows that stored the attestationObject). */
function storedPublicKey(stored: string): { key: Uint8Array; isLegacy: boolean } | null {
  try {
    const bytes = isoBase64URL.toBuffer(stored);
    try {
      const att = decodeAttestationObject(bytes);
      const authData = att.get("authData");
      const parsed = parseAuthenticatorData(authData);
      if (parsed.credentialPublicKey) return { key: parsed.credentialPublicKey, isLegacy: true };
    } catch {
      // not an attestationObject: already a COSE key
    }
    return { key: bytes, isLegacy: false };
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { action, payload } = body;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let user: any = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const { data } = await supabaseAdmin.auth.getUser(token).catch(() => ({ data: { user: null } }));
      user = data?.user || null;
    }

    const site = resolveOrigin(req);

    switch (action) {
      case "registration-options": {
        if (!user) return json({ error: "Authentication required for registration" });
        if (!site) return json({ error: "Biometrics can only be set up from the SwiftData website." });

        const challenge = await issueChallenge();
        await supabaseAdmin.from("webauthn_challenges").insert({ user_id: user.id, challenge, action: "register" });

        const { data: existing } = await supabaseAdmin
          .from("user_credentials")
          .select("credential_id")
          .eq("user_id", user.id);

        return json({
          challenge,
          rp: { name: "SwiftData Ghana", id: site.host },
          user: {
            id: isoBase64URL.fromBuffer(new TextEncoder().encode(user.id)),
            name: user.email,
            displayName: user.user_metadata?.full_name || user.email,
          },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
          timeout: 60000,
          attestation: "none",
          excludeCredentials: (existing || []).map((c: any) => ({ id: c.credential_id, type: "public-key" })),
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "preferred",
            requireResidentKey: true,
          },
        });
      }

      case "verify-registration": {
        if (!user) return json({ error: "Authentication required" });
        if (!site) return json({ error: "Invalid origin" }, 403);
        const { response, deviceName } = payload || {};
        if (!response?.id) return json({ error: "Missing registration response" }, 400);

        const { data: challengeData } = await supabaseAdmin
          .from("webauthn_challenges")
          .select("id, challenge, expires_at")
          .eq("user_id", user.id)
          .eq("action", "register")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!challengeData || new Date(challengeData.expires_at).getTime() < Date.now()) {
          return json({ error: "Challenge missing or expired. Retry enrollment." });
        }

        let verification;
        try {
          verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: challengeData.challenge,
            expectedOrigin: site.origin,
            expectedRPID: site.host,
            requireUserVerification: false,
          });
        } catch (e: any) {
          return json({ error: `Biometric enrollment could not be verified: ${e?.message || e}` }, 400);
        }
        await supabaseAdmin.from("webauthn_challenges").delete().eq("id", challengeData.id);

        if (!verification.verified || !verification.registrationInfo) {
          return json({ error: "Biometric enrollment could not be verified." }, 400);
        }
        const info = verification.registrationInfo;

        const { error: storeError } = await supabaseAdmin.from("user_credentials").insert({
          user_id: user.id,
          credential_id: info.credential.id,
          public_key: isoBase64URL.fromBuffer(info.credential.publicKey),
          counter: info.credential.counter ?? 0,
          device_name: String(deviceName || "My Device").slice(0, 80),
          device_type: info.credentialDeviceType,
          backed_up: info.credentialBackedUp,
          transports: info.credential.transports ?? response.response?.transports ?? null,
        });
        if (storeError) throw storeError;
        await supabaseAdmin.from("profiles").update({ biometric_enabled: true }).eq("user_id", user.id);

        return json({ success: true });
      }

      case "authentication-options": {
        // Discoverable-credential login: the browser picks the passkey, so no
        // email lookup (which would leak which accounts exist) is needed.
        const localKeyIds = body.localKeyIds || payload?.localKeyIds || [];
        const allowCredentials = Array.isArray(localKeyIds)
          ? localKeyIds.filter((id: unknown) => typeof id === "string" && id.length < 1024).slice(0, 20)
            .map((id: string) => ({ id, type: "public-key" }))
          : [];

        return json({
          challenge: await issueChallenge(),
          timeout: 60000,
          userVerification: "preferred",
          allowCredentials,
        });
      }

      case "verify-authentication": {
        if (!site) return json({ error: "Invalid origin" }, 403);
        const { response } = payload || {};
        if (!response?.id || !response?.response?.clientDataJSON) {
          return json({ error: "Missing authentication response" }, 400);
        }

        const { data: cred } = await supabaseAdmin
          .from("user_credentials")
          .select("id, user_id, public_key, counter, transports")
          .eq("credential_id", response.id)
          .maybeSingle();

        if (!cred) return json({ error: "Biometric identity mismatch." }, 403);
        const pk = storedPublicKey(cred.public_key);
        if (!pk) return json({ error: "Stored biometric key is unreadable. Please re-register this device." }, 403);

        let usedChallenge = "";
        let verification;
        try {
          verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: async (c: string) => {
              usedChallenge = c;
              return await isValidChallenge(c);
            },
            expectedOrigin: site.origin,
            expectedRPID: site.host,
            credential: {
              id: response.id,
              publicKey: pk.key,
              counter: Number(cred.counter || 0),
              transports: cred.transports ?? undefined,
            },
            requireUserVerification: false,
          });
        } catch (e: any) {
          console.warn("[webauthn] assertion rejected:", e?.message || e);
          return json({ error: "Biometric verification failed." }, 403);
        }
        if (!verification.verified) return json({ error: "Biometric verification failed." }, 403);

        // Single use: a signed assertion cannot be replayed.
        const { data: replay } = await supabaseAdmin
          .from("webauthn_challenges")
          .select("id")
          .eq("challenge", usedChallenge)
          .eq("action", "used")
          .maybeSingle();
        if (replay) return json({ error: "This biometric response was already used." }, 403);
        await supabaseAdmin.from("webauthn_challenges").insert({
          user_id: cred.user_id,
          challenge: usedChallenge,
          action: "used",
        });

        const patch: Record<string, unknown> = {
          last_used_at: new Date().toISOString(),
          counter: verification.authenticationInfo.newCounter,
        };
        if (pk.isLegacy) patch.public_key = isoBase64URL.fromBuffer(pk.key);
        await supabaseAdmin.from("user_credentials").update(patch).eq("id", cred.id);

        // Signed-in user re-confirming identity: no new session needed.
        if (user) {
          if (user.id !== cred.user_id) return json({ error: "Biometric identity mismatch." }, 403);
          return json({ verified: true, bridge: null });
        }

        const { data: userRes, error: fetchErr } = await supabaseAdmin.auth.admin.getUserById(cred.user_id);
        if (fetchErr || !userRes?.user?.email) {
          return json({ error: "Failed to retrieve identity for secure handshake." });
        }
        const { data: linkRes, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: userRes.user.email,
        });
        if (linkErr || !linkRes?.properties?.email_otp) {
          return json({ error: "Handshake generator failure." });
        }

        return json({ verified: true, bridge: { email: userRes.user.email, otp: linkRes.properties.email_otp } });
      }

      case "delete-credential": {
        if (!user) return json({ error: "Forbidden" }, 403);
        const { credentialId } = payload || {};
        await supabaseAdmin.from("user_credentials").delete().eq("user_id", user.id).eq("credential_id", credentialId);

        const { count } = await supabaseAdmin
          .from("user_credentials")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id);

        if (!count || count === 0) {
          await supabaseAdmin.from("profiles").update({ biometric_enabled: false }).eq("user_id", user.id);
        }
        return json({ success: true });
      }

      default:
        return json({ error: "Unrecognized request action." }, 400);
    }
  } catch (error: any) {
    console.error("[webauthn] error:", error);
    return json({ error: error?.message || "Unexpected server error" });
  }
});
