// Unit tests: shared security helpers (secure cookies flag, admin role mirror,
// open-redirect-safe next-path parsing).

import { describe, expect, it } from "vitest";
import { adminRoleForPlatform, safeNextPath, shouldUseSecureCookies } from "@/lib/security";

describe("shouldUseSecureCookies", () => {
  it("is true only in production", () => {
    expect(shouldUseSecureCookies("production")).toBe(true);
    expect(shouldUseSecureCookies("development")).toBe(false);
    expect(shouldUseSecureCookies("test")).toBe(false);
  });
});

describe("adminRoleForPlatform", () => {
  it("mirrors the platform role verbatim (one vocabulary, no mapping table)", () => {
    expect(adminRoleForPlatform("SUPER_ADMIN")).toBe("SUPER_ADMIN");
    expect(adminRoleForPlatform("USER")).toBe("USER");
  });
});

describe("safeNextPath", () => {
  it("passes same-site absolute paths through", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/change-password?from=admin")).toBe("/change-password?from=admin");
    expect(safeNextPath("/admin/users")).toBe("/admin/users");
  });

  it("falls back for empty, external and protocol-relative targets", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example/phish")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("honors a custom fallback", () => {
    expect(safeNextPath(null, "/login")).toBe("/login");
    expect(safeNextPath("//evil.example", "/login")).toBe("/login");
  });
});
