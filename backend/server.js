require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const authRoutes = require("./routes/auth");

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", authRoutes);
app.use("/auth", authRoutes);
app.use("/api/v1/auth", authRoutes);

// Private, loopback, link-local (cloud metadata) and CGNAT ranges are never
// valid proxy destinations.
const isPrivateAddress = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
};

const PROXY_ALLOWED_HOSTS = (process.env.PROXY_ALLOWED_HOSTS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

app.post("/api/proxy-pass", async (req, res) => {
  try {
    // No default: without a strong PROXY_SECRET in the environment the proxy is off.
    const expectedSecret = (process.env.PROXY_SECRET || "").trim();
    if (expectedSecret.length < 32) {
      return res.status(503).json({ error: "Proxy disabled: PROXY_SECRET not configured" });
    }
    const providedSecret = req.headers["x-proxy-secret"];
    const a = Buffer.from(typeof providedSecret === "string" ? providedSecret : "");
    const b = Buffer.from(expectedSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn("[Render/ProxyPass] Unauthorized proxy attempt");
      return res.status(401).json({ error: "Unauthorized proxy access" });
    }

    const { url, method = "GET", headers = {}, body } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing target url parameter" });

    let target;
    try {
      target = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid target url" });
    }
    const upperMethod = String(method).toUpperCase();
    if (target.protocol !== "https:" || !["GET", "POST", "PUT", "PATCH"].includes(upperMethod)) {
      return res.status(403).json({ error: "Destination not allowed" });
    }
    const hostname = target.hostname.toLowerCase();
    if (PROXY_ALLOWED_HOSTS.length > 0 &&
      !PROXY_ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      return res.status(403).json({ error: "Destination host not allowed" });
    }
    const resolved = await dns.lookup(hostname, { all: true }).catch(() => []);
    if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
      return res.status(403).json({ error: "Destination resolves to a private address" });
    }

    console.log(`[Render/ProxyPass] Forwarding ${upperMethod} -> ${target.origin}${target.pathname}`);
    const cleanHeaders = { ...headers };
    delete cleanHeaders.host;
    delete cleanHeaders.Host;

    const fetchOptions = {
      method: upperMethod,
      headers: cleanHeaders,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    };
    if (body && ["POST", "PUT", "PATCH"].includes(upperMethod)) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(target, fetchOptions);
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    console.error("[Render/ProxyPass] Proxy error:", err.message);
    res.status(502).json({ error: `Render proxy error: ${err.message}` });
  }
});

const getMongoStatus = () => {
  if (!process.env.MONGODB_URI) return "not_configured";
  const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  return states[mongoose.connection.readyState] || "unknown";
};

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "SwiftData Auth & Proxy Backend",
    status: "healthy",
    mongo: getMongoStatus(),
    proxy_enabled: true,
    health_check: "/health"
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", mongo: getMongoStatus(), proxy_enabled: true });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`[Render/AuthBackend] Running on http://0.0.0.0:${port}`);
  if (process.env.MONGODB_URI) {
    mongoose
      .connect(process.env.MONGODB_URI)
      .then(() => console.log("[Render/AuthBackend] MongoDB connected successfully."))
      .catch((error) => console.error("[Render/AuthBackend] Mongo connection error:", error));
  } else {
    console.warn("[Render/AuthBackend] Warning: MONGODB_URI env var not set.");
  }
});
