import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";

import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";
import { recurrenteWebhookRouter } from "./modules/webhooks/recurrente.webhook.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { startReminderJob } from "./jobs/reminders.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
// Allow: configured origins (comma-separated env), any *.vercel.app deploy,
// and requests with no Origin (curl, server-to-server, health checks).
const allowedOrigins = env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host === "vercel.app" || host.endsWith(".vercel.app")) return cb(null, true);
      } catch {
        /* malformed origin → reject below */
      }
      return cb(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);
// Webhook must receive raw body for Svix signature verification — mount BEFORE express.json()
app.use("/api/webhooks/recurrente", express.raw({ type: "application/json" }), recurrenteWebhookRouter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// Static uploads
const uploadsAbs = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(uploadsAbs, { recursive: true });
app.use("/uploads", express.static(uploadsAbs));

// API
app.use("/api", apiRouter);

// 404 + error
app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`✦ Ecodama API ready on http://localhost:${env.PORT}`);
  console.log(`  Environment: ${env.NODE_ENV}`);
  console.log(`  CORS origin: ${env.CORS_ORIGIN}`);
  startReminderJob();
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`\nReceived ${signal}, closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
