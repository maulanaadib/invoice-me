import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Application
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().min(1),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  // PDF service
  INTERNAL_PDF_SECRET: z.string().min(32),
  INTERNAL_APP_URL: z
    .string()
    .url()
    .default("http://host.docker.internal:3000"),

  // Storage
  STORAGE_ROOT: z.string().min(1).default("./.data"),
  UPLOAD_MAX_MB: z.coerce.number().default(2),

  // Localization
  DEFAULT_TIMEZONE: z.string().default("Asia/Jakarta"),

  // Seed (optional)
  SEED_ADMIN_USERNAME: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),

  // Bank account encryption
  BANK_ACCOUNT_ENCRYPTION_KEY: z.string().optional(),

  // Error tracking (optional; empty string from compose = disabled)
  GLITCHTIP_DSN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().optional(),
  ),

  // Cloudflare tunnel (optional)
  CLOUDFLARE_TUNNEL_TOKEN: z.string().optional(),
});

const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    _parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment variables — check server logs");
}

export const env = _parsed.data;
