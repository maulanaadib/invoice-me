// src/server/auth.ts
// Better Auth configuration (feature 01).
//
// Sign-in / sign-out / change-password traffic is NOT served directly — the
// /api/auth route wraps auth.handler with handleAuthRequest
// (modules/auth/service.ts), which adds lockout, suspension checks and
// auditing around the real handler. Those concerns deliberately live in the
// wrapper, not in lifecycle hooks: it keeps request/response interception
// explicit and testable from the API route down.

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins/admin";
// Platform role vocabulary for the admin plugin: `user.role` mirrors
// platformRole verbatim (lib/security.adminRoleForPlatform), so hasPermission()
// can authorize admin endpoints straight from that column — the keys must match
// it exactly, which the default "admin"/"user" roles do not.
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { username } from "better-auth/plugins/username";
import { shouldUseSecureCookies } from "@/lib/security";
import { db } from "@/server/db";
import { env } from "@/server/env";

export const auth = betterAuth({
  appName: "invoice-me",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // sliding renewal every day ("remember me")
    cookieCache: { enabled: false, maxAge: 300 }, // always fresh: suspend/flag checks hit the DB
    additionalFields: {
      // Active workspace — written server-side only after the membership is
      // verified; every scoped read re-validates it (organizations service).
      activeOrganizationId: { type: "string", required: false, returned: true },
    },
  },

  user: {
    additionalFields: {
      // Exposed on session.user so the proxy can guard without a second query.
      // input: false — clients can never set these through /update-user or
      // /update-session.
      platformRole: { type: "string", required: false, returned: true, input: false },
      mustChangePassword: { type: "boolean", required: false, returned: true, input: false },
      status: { type: "string", required: false, returned: true, input: false },
      // Feature 02: proxy reads these to route the onboarding wizard without
      // a second query; input: false — clients can never flip them.
      onboardingComplete: { type: "boolean", required: false, returned: true, input: false },
      onboardingStep: { type: "number", required: false, returned: true, input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    // Public registration is disabled — super admin creates users (feature 01).
    disableSignUp: true,
    // SMTP hook point for a later feature, intentionally unset:
    //   sendResetPassword: async ({ url, user }) => { ... }
    // /forgot-password tells users to contact their administrator instead.
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      // Flood guard only — the real 5-strike lockout (1m/5m/15m) lives in
      // modules/auth/service.ts and owns the Indonesian lockout messages.
      "/sign-in/email": { window: 60, max: 20 },
      "/sign-in/username": { window: 60, max: 20 },
    },
  },

  advanced: {
    // Explicit rather than derived from the URL protocol: production cookies
    // are always Secure regardless of BETTER_AUTH_URL.
    useSecureCookies: shouldUseSecureCookies(env.NODE_ENV),
  },

  plugins: [
    // displayUsername: false — no displayUsername column in our schema.
    username({ minUsernameLength: 3, maxUsernameLength: 30, displayUsername: false }),
    // role/banned/banReason/banExpires/impersonatedBy columns exist in the
    // schema; the user.role column mirrors platformRole verbatim.
    admin({
      defaultRole: "USER",
      adminRoles: ["SUPER_ADMIN"],
      roles: { SUPER_ADMIN: adminAc, USER: userAc },
    }),
  ],
});
