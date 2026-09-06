require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
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

app.post("/api/proxy-pass", async (req, res) => {
  try {
    const expectedSecret = process.env.PROXY_SECRET || "swiftdata-proxy-secret-2026";
    const providedSecret = req.headers["x-proxy-secret"];

    if (!providedSecret || providedSecret !== expectedSecret) {
      console.warn("[Render/ProxyPass] Unauthorized proxy attempt");
      return res.status(401).json({ error: "Unauthorized proxy access" });
    }

    const { url, method = "GET", headers = {}, body } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing target url parameter" });

    console.log(`[Render/ProxyPass] Forwarding ${method} -> ${url}`);
    const cleanHeaders = { ...headers };
    delete cleanHeaders.host;

    const fetchOptions = {
      method,
      headers: cleanHeaders,
    };
    if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    console.error("[Render/ProxyPass] Proxy error:", err.message);
    res.status(502).json({ error: `Render proxy error: ${err.message}` });
  }
});

app.get("/", (_req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? "connected" : "connecting";
  res.json({
    ok: true,
    service: "SwiftData Auth & Proxy Backend",
    status: "healthy",
    mongo: mongoStatus,
    proxy_enabled: true,
    health_check: "/health"
  });
});

app.get("/health", (_req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? "connected" : "connecting";
  res.json({ ok: true, status: "healthy", mongo: mongoStatus, proxy_enabled: true });
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
