// tests/integration/audit-actions.test.ts — feature 11A Check When Done at
// the service layer, against the test database:
//   - "Audit log viewer feature 09 menampilkan semua action dengan filter" —
//     every AuditAction enum value passes the viewer's filter pipeline
//     (listAdminAuditLogs → adminAuditQuerySchema → query) without error
//   - "Audit metadata tidak mengandung password/token/rekening lengkap
//     (verifikasi sample 10 log terbaru)" — 10 rows written through the REAL
//     audit write helper (logAudit → sanitizeMetadata) come back from the
//     database with the sensitive keys redacted and the harmless values intact
//
// The grep half of the audit checklist (every action has an emit point) lives
// in src/modules/audit/emit-points.test.ts.

import { beforeAll, describe, expect, it } from "vitest";
import { AuditAction } from "@prisma/client";
import { logAudit } from "@/modules/audit/service";
import { listAdminAuditLogs, type AdminContext } from "@/modules/admin/service";
import { db } from "@/server/db";
import { resetDatabase } from "../factories";

const adminCtx: AdminContext = {
  platformRole: "SUPER_ADMIN",
  actorUserId: "audit-11a-verifier",
};

beforeAll(async () => {
  await resetDatabase();
});

describe("audit log viewer accepts every AuditAction as a filter", () => {
  it("runs the viewer query for each enum value (the dropdown lists them all)", async () => {
    for (const action of Object.values(AuditAction)) {
      const page = await listAdminAuditLogs(adminCtx, { action });
      expect(page.total).toBeGreaterThanOrEqual(0);
      expect(page.rows.every((row) => row.action === action)).toBe(true);
    }
  });
});

describe("audit metadata sample (Check When Done: 10 log terbaru)", () => {
  it("persists no password/token/account number/NPWP in the latest 10 rows", async () => {
    // Ten rows through the one audit write path every service uses — planted
    // sensitive keys must be redacted before they touch the table, while
    // harmless metadata survives untouched.
    const actions = Object.values(AuditAction);
    for (let index = 0; index < 10; index += 1) {
      await logAudit({
        actorUserId: null,
        organizationId: null,
        action: actions[index],
        entityType: "verification",
        entityId: `sample-${index}`,
        metadata: {
          note: "verifikasi sampel 11a",
          amount: "1500000.00",
          password: "kata-sandi-rahasia-11a",
          token: "token-rahasia-11a",
          apiKey: "api-key-rahasia-11a",
          rekening: "1370021873449",
          accountNumber: "1370021873449",
          npwp: "01.2345.6789.000001",
        },
        request: null,
      });
    }

    const sample = await db.auditLog.findMany({
      where: { entityId: { startsWith: "sample-" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    });
    expect(sample).toHaveLength(10);

    for (const row of sample) {
      const serialized = JSON.stringify(row.metadata);
      // The planted secret VALUES never reach the database...
      expect(serialized).not.toContain("kata-sandi-rahasia-11a");
      expect(serialized).not.toContain("token-rahasia-11a");
      expect(serialized).not.toContain("api-key-rahasia-11a");
      expect(serialized).not.toContain("1370021873449");
      expect(serialized).not.toContain("01.2345.6789.000001");

      const metadata = row.metadata as Record<string, unknown>;
      // ...the sensitive KEYS stay visible as redacted markers...
      expect(metadata.password).toBe("[REDACTED]");
      expect(metadata.token).toBe("[REDACTED]");
      expect(metadata.apiKey).toBe("[REDACTED]");
      expect(metadata.rekening).toBe("[REDACTED]");
      expect(metadata.accountNumber).toBe("[REDACTED]");
      expect(metadata.npwp).toBe("[REDACTED]");
      // ...and harmless metadata is preserved as stored.
      expect(metadata.note).toBe("verifikasi sampel 11a");
      expect(metadata.amount).toBe("1500000.00");
    }
  });
});
