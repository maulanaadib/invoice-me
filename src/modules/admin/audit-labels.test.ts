// Unit tests: feature 09 audit-log labels (src/modules/admin/audit-labels.ts).
// The label map is typed `Record<AuditAction, string>`, so TypeScript already
// fails when the enum grows — these tests catch the runtime half of the same
// drift (empty string, raw enum value leaking into the UI, wrong feature-09
// wording) and pin the fallback rule.

import { AuditAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTION_LABELS, auditActionLabel } from "@/modules/admin/audit-labels";

const ALL_ACTIONS = Object.values(AuditAction);

describe("AUDIT_ACTION_LABELS", () => {
  it("covers every AuditAction with a non-empty Indonesian label", () => {
    expect(ALL_ACTIONS.length).toBeGreaterThan(0);
    for (const action of ALL_ACTIONS) {
      const label = AUDIT_ACTION_LABELS[action];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(label.trim()).toBe(label);
    }
  });

  it("never shows the raw enum value as a label", () => {
    for (const action of ALL_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).not.toBe(action);
    }
  });

  it("carries no keys outside the enum (no stale entries)", () => {
    const keys = Object.keys(AUDIT_ACTION_LABELS).sort();
    expect(keys).toEqual([...ALL_ACTIONS].sort());
  });

  it("labels the four actions feature 09 introduced", () => {
    expect(AUDIT_ACTION_LABELS.ADMIN_VIEWED_INVOICE).toBe("Super admin membaca invoice");
    expect(AUDIT_ACTION_LABELS.USER_ROLE_CHANGED).toBe("Platform role diubah");
    expect(AUDIT_ACTION_LABELS.ORGANIZATION_STATUS_CHANGED).toBe("Status organisasi diubah");
    expect(AUDIT_ACTION_LABELS.PDF_JOB_RETRIED).toBe("Job PDF diulang");
  });
});

describe("auditActionLabel", () => {
  it("returns the label for a known action", () => {
    expect(auditActionLabel("PDF_DOWNLOADED")).toBe("PDF diunduh");
    expect(auditActionLabel(AuditAction.LOGIN_FAILED)).toBe("Login gagal");
  });

  it("falls back to the raw value when the action is unknown", () => {
    expect(auditActionLabel("ACTION_YANG_BELUM_ADA")).toBe("ACTION_YANG_BELUM_ADA");
    expect(auditActionLabel("")).toBe("");
  });
});
