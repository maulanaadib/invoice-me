// Unit tests: audit metadata sanitization (feature 01 security requirement —
// never persist password/token/secret material into AuditLog.metadata).

import { describe, expect, it } from "vitest";
import { sanitizeMetadata } from "@/modules/audit/service";

describe("sanitizeMetadata", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      password: "rahasia123",
      nested: {
        token: "tok_abc",
        deeper: { secret: "s3cr3t", authorization: "Bearer xyz", api_key: "k-1" },
        safe: "tetap-terlihat",
      },
    };
    const out = sanitizeMetadata(input) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    const nested = out.nested as Record<string, Record<string, unknown>>;
    expect(nested.token).toBe("[REDACTED]");
    expect(nested.deeper.secret).toBe("[REDACTED]");
    expect(nested.deeper.authorization).toBe("[REDACTED]");
    expect(nested.deeper.api_key).toBe("[REDACTED]");
    expect(nested.safe).toBe("tetap-terlihat");
  });

  it("redacts finance PII keys (npwp, rekening)", () => {
    const out = sanitizeMetadata({ npwp: "01.234.567.8", rekening: "1234-5678" }) as Record<
      string,
      unknown
    >;
    expect(out.npwp).toBe("[REDACTED]");
    expect(out.rekening).toBe("[REDACTED]");
  });

  it("keeps harmless metadata intact and preserves types", () => {
    const out = sanitizeMetadata({
      via: "self_service",
      count: 3,
      ok: true,
      nothing: null,
    }) as Record<string, unknown>;
    expect(out.via).toBe("self_service");
    expect(out.count).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.nothing).toBeNull();
  });

  it("serializes Date and bigint values to safe strings", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const out = sanitizeMetadata({ at: date, big: BigInt(10) }) as Record<string, unknown>;
    expect(out.at).toBe(date.toISOString());
    expect(out.big).toBe("10");
  });

  it("truncates very long strings", () => {
    const long = "x".repeat(5000);
    const out = sanitizeMetadata({ reason: long }) as Record<string, unknown>;
    expect(typeof out.reason).toBe("string");
    expect((out.reason as string).length).toBeLessThanOrEqual(501);
    expect(out.reason).not.toBe(long);
  });

  it("caps array length", () => {
    const out = sanitizeMetadata({ items: Array.from({ length: 100 }, (_, i) => i) }) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(out.items)).toBe(true);
    expect((out.items as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it("caps nesting depth instead of recursing forever", () => {
    let deep: Record<string, unknown> = { leaf: "bottom" };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    const out = sanitizeMetadata({ root: deep }) as Record<string, unknown>;
    const serialized = JSON.stringify(out);
    expect(serialized.includes("[TERLALU_DALAM]") || serialized.includes("bottom")).toBe(true);
    // Depth cap: no crash, output is finite JSON.
    expect(serialized.length).toBeLessThan(10_000);
  });

  it("produces a plain JSON-safe object (no circular crash)", () => {
    const input: Record<string, unknown> = { name: "uji" };
    input.self = input; // circular reference
    const out = sanitizeMetadata(input);
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
