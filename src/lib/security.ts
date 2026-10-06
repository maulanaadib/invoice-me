// src/lib/security.ts
// Pure security helpers. Kept dependency-free so both the auth config and the
// unit tests share one implementation.

/**
 * Whether session cookies must carry the `Secure` attribute.
 *
 * Better Auth would otherwise derive this from the baseURL protocol first, so
 * an `http://` BETTER_AUTH_URL would win even under NODE_ENV=production. We set
 * the attribute explicitly: production always uses Secure cookies.
 */
export function shouldUseSecureCookies(nodeEnv: string): boolean {
  return nodeEnv === "production";
}

/**
 * The Better Auth admin-plugin `role` column mirrors the platform role
 * verbatim: SUPER_ADMIN → "SUPER_ADMIN", USER → "USER". Better Auth's
 * hasPermission() reads this column to authorize admin plugin endpoints, so
 * keeping the same vocabulary avoids a second permission mapping.
 */
export function adminRoleForPlatform(platformRole: "SUPER_ADMIN" | "USER"): "SUPER_ADMIN" | "USER" {
  return platformRole;
}

/**
 * Sanitizes a post-login redirect target: only same-site absolute paths
 * (`/dashboard`), never `//evil.example` or `https://…` (open-redirect guard).
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/\\")) return fallback;
  return raw;
}
