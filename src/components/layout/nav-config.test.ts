// Unit tests: feature 09 sidebar source of truth (src/components/layout/nav-config.ts).
// Two contracts matter here: (1) every href resolves to a REAL page — the
// non-negotiable "no placeholder links" rule, checked against the App Router
// tree so a link can never ship pointing at a route that does not exist — and
// (2) the admin-only activation logic that decides which link is highlighted
// in the super-admin sidebar.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS,
  visibleLinks,
  type NavVisibility,
} from "@/components/layout/nav-config";

const ALL_VISIBLE: NavVisibility = {
  payments: true,
  customers: true,
  projects: true,
  bankAccounts: true,
  signers: true,
};
const NONE_VISIBLE: NavVisibility = {
  payments: false,
  customers: false,
  projects: false,
  bankAccounts: false,
  signers: false,
};

/**
 * Every route URL declared by the App Router tree. Route groups
 * (`(dashboard)`) are URL-neutral and stripped, `api/*` is not a page.
 */
function collectRoutePaths(dir: string, segments: string[] = []): Set<string> {
  const routes = new Set<string>();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return routes;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === "page.tsx")) {
    routes.add("/" + segments.filter((part) => !part.startsWith("(")).join("/"));
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "api") continue;
    for (const route of collectRoutePaths(join(dir, entry.name), [...segments, entry.name])) {
      routes.add(route);
    }
  }
  return routes;
}

const ROUTES = collectRoutePaths(join(process.cwd(), "src", "app"));

describe("nav targets", () => {
  it("found the route tree to check against", () => {
    // Guards the check itself: an empty set would make every href "missing".
    expect(ROUTES.has("/dashboard")).toBe(true);
    expect(ROUTES.has("/admin")).toBe(true);
  });

  it("every workspace link points at a real route", () => {
    for (const group of NAV_GROUPS.filter((entry) => !entry.adminOnly)) {
      for (const link of group.links) {
        expect({ href: link.href, exists: ROUTES.has(link.href) }).toEqual({
          href: link.href,
          exists: true,
        });
      }
    }
  });

  for (const group of NAV_GROUPS.filter((entry) => entry.adminOnly)) {
    for (const link of group.links) {
      expect(link.href.startsWith("/admin")).toBe(true);
      expect({ href: link.href, exists: ROUTES.has(link.href) }).toEqual({
        href: link.href,
        exists: true,
      });
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.icon).toBeDefined();
    }
  }

  it("keeps every admin panel page reachable from the admin sidebar", () => {
    // Every top-level feature-09 page that exists in the router must be linked
    // from the sidebar — a page nobody can navigate to is a dead end. Dynamic
    // detail pages (`[id]`) are reached from their list, not from the sidebar.
    const linked = new Set(
      NAV_GROUPS.filter((group) => group.adminOnly).flatMap((group) => group.links.map((link) => link.href)),
    );
    const adminRoutes = [...ROUTES].filter(
      (route) => route.startsWith("/admin") && !route.includes("["),
    );
    expect(adminRoutes.length).toBeGreaterThanOrEqual(9);
    for (const route of adminRoutes) {
      expect(linked.has(route)).toBe(true);
    }
  });

  it("marks exactly one group as admin-only", () => {
    const adminGroups = NAV_GROUPS.filter((group) => group.adminOnly);
    expect(adminGroups.length).toBe(1);
    expect(adminGroups[0]?.links.every((link) => link.href.startsWith("/admin"))).toBe(true);
  });
});

describe("visibleLinks", () => {
  it("shows unconditionally-linked entries regardless of visibility", () => {
    const hrefs = visibleLinks(NAV_GROUPS[0]!.links, NONE_VISIBLE).map((link) => link.href);
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).toContain("/invoices");
    expect(hrefs).toContain("/profiles");
    // Gated entries are hidden with the flags off.
    expect(hrefs).not.toContain("/payments");
    expect(hrefs).not.toContain("/customers");
    expect(hrefs).not.toContain("/projects");
    // Feature 10: bank/signer links follow their view permissions too.
    expect(hrefs).not.toContain("/bank-accounts");
    expect(hrefs).not.toContain("/signers");
  });

  it("reveals each gated entry only when its flag turns on", () => {
    expect(visibleLinks(NAV_GROUPS[0]!.links, ALL_VISIBLE).map((link) => link.href)).toEqual(
      expect.arrayContaining(["/payments", "/customers", "/projects", "/bank-accounts", "/signers"]),
    );
    const onlyPayments: NavVisibility = {
      payments: true,
      customers: false,
      projects: false,
      bankAccounts: false,
      signers: false,
    };
    const hrefs = visibleLinks(NAV_GROUPS[0]!.links, onlyPayments).map((link) => link.href);
    expect(hrefs).toContain("/payments");
    expect(hrefs).not.toContain("/customers");
    expect(hrefs).not.toContain("/projects");
    expect(hrefs).not.toContain("/bank-accounts");
    expect(hrefs).not.toContain("/signers");
  });
});

