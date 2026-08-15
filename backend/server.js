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

app.get("/health", (_req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? "connected" : "connecting";
  res.json({ ok: true, status: "healthy", mongo: mongoStatus });
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
