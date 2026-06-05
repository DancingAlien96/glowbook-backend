import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 chars"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(5),

  // Email — optional. If RESEND_API_KEY is missing, email sends are no-ops
  // (logged as warnings) so dev environments without an API key still work.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Ecodama <onboarding@resend.dev>"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Web Push (VAPID). Optional — if missing, push routes still register but
  // sends become no-ops (logged). Generate with: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:soporte@ecodama.online"),

  // Recurrente payment gateway. Optional — if missing, card payment is disabled.
  RECURRENTE_SECRET_KEY: z.string().optional(),
  RECURRENTE_WEBHOOK_SECRET: z.string().optional(), // whsec_... from Svix
  RECURRENTE_SUBSCRIPTION_URL: z.string().url().optional(), // https://app.recurrente.com/s/...
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("\n❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
