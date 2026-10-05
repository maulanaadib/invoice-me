// src/server/auth.ts
// Better Auth configuration — detail login flow implemented in feature 01.
// This file only exports the auth handler and core helpers.

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { db } from "@/server/db";
import { env } from "@/server/env";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  plugins: [username()],
  emailAndPassword: {
    enabled: true,
    // Public sign-up is disabled — users are created by admin only (feature 01).
    autoSignIn: true,
  },
});
