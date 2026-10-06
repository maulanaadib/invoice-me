// tests/helpers/auth.ts — in-process HTTP helpers for integration tests.
// Requests go through the real handleAuthRequest wrapper (lockout, suspension,
// audit) and a cookie jar mimics a browser session.

import { handleAuthRequest } from "@/modules/auth/service";

export const BASE_URL = "http://localhost:3000";

export function readSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") return withGetter.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

/** Minimal cookie jar: absorbs Set-Cookie, replays Cookie on later requests. */
export class CookieJar {
  private cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const raw of readSetCookies(response.headers)) {
      if (!raw) continue;
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  toHeaders(extra?: Record<string, string>): Headers {
    const headers = new Headers(extra);
    const cookie = this.header();
    if (cookie) headers.set("cookie", cookie);
    return headers;
  }
}

export interface CallOptions extends RequestInit {
  jar?: CookieJar;
  ip?: string;
}

/** Calls the auth route handler in-process and syncs the cookie jar. */
export async function callAuth(path: string, options: CallOptions = {}): Promise<Response> {
  const { jar, ip = "10.0.0.1", ...init } = options;
  const headers = new Headers(init.headers);
  if (jar) {
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);
  }
  headers.set("x-forwarded-for", ip);
  const request = new Request(`${BASE_URL}${path}`, { ...init, headers });
  const response = await handleAuthRequest(request);
  jar?.absorb(response);
  return response;
}

/** Signs in via the real endpoint (branches username vs email by "@"). */
export async function signIn(
  jar: CookieJar,
  identifier: string,
  password: string,
  ip = "10.0.0.1",
): Promise<Response> {
  const isEmail = identifier.includes("@");
  const body = isEmail
    ? { email: identifier, password, rememberMe: true }
    : { username: identifier, password, rememberMe: true };
  return callAuth(isEmail ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    jar,
    ip,
  });
}
