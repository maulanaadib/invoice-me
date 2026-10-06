// src/proxy.ts
// Route protection (feature 01 spec item 5). Next.js 16 renamed the
// middleware.ts convention to proxy.ts — same contract, see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
//
// This is the REDIRECT layer (login, force-change, admin gate). It is not the
// only guard: layouts re-check the session and the service layer re-checks
// authorization, because a compromised process must not mean a bypass.

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";
import { logger } from "@/server/logger";

const PUBLIC_PATHS = ["/login", "/forgot-password"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: request.headers });
  } catch (error) {
    // Fail closed: no readable session → treat as unauthenticated.
    logger.error(
      { module: "proxy", err: error instanceof Error ? error.message : String(error) },
      "gagal membaca sesi — mengarahkan ke login",
    );
    session = null;
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  if (!session) {
    if (isPublicPath(pathname)) return NextResponse.next();
    return NextResponse.redirect(loginUrl);
  }

  const mustChange = session.user.mustChangePassword === true;
  const isSuperAdmin = session.user.platformRole === "SUPER_ADMIN";

  // Signed-in users do not belong on the auth pages.
  if (isPublicPath(pathname)) {
    return NextResponse.redirect(
      new URL(mustChange ? "/change-password" : "/dashboard", request.url),
    );
  }

  // /change-password requires a session (handled above) and is reachable both
  // while mustChangePassword is set and for voluntary changes.
  if (pathname.startsWith("/change-password")) {
    return NextResponse.next();
  }

  // Force password change before anything else — dashboard, admin, everything.
  if (mustChange) {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  if (pathname === "/unauthorized") return NextResponse.next();

  if (pathname.startsWith("/admin")) {
    if (!isSuperAdmin) {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // Excludes: API routes (their own 401s), static assets, health endpoint.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|health|robots.txt).*)"],
};
