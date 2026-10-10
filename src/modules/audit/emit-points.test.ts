// src/modules/audit/emit-points.test.ts — feature 11A Check When Done:
// "Semua 22+ AuditAction punya emit point di codebase (grep bukti)" and
// "Audit log viewer feature 09 menampilkan semua action dengan filter".
//
// This is the automated grep: for EVERY value of the AuditAction enum the test
// searches the application source (excluding test files) for the quoted action
// literal — the shape every `log()` / `logAudit()` / `writeAudit()` call site
// uses (`action: "LOGIN_SUCCESS"`, `writeAudit(ctx, "CUSTOMER_CREATED", ...)`,
// the PROJECT_CREATED/PROJECT_UPDATED ternary, ...). A future enum value added
// without an emit point fails here; an action mentioned only in tests or in
// the label map (whose keys are unquoted identifiers, so they cannot match)
// never passes by accident.
//
// The viewer half proves feature 09's dropdown/filter contract still covers
// the whole enum: the select is built from Object.values(AuditAction) and
// validated by adminAuditQuerySchema, and every action carries an Indonesian
// label (Record<AuditAction, string> — typecheck already enforces presence).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AuditAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTION_LABELS } from "@/modules/admin/audit-labels";
import { adminAuditQuerySchema } from "@/modules/admin/schema";

const SRC_ROOT = join(process.cwd(), "src");
const ALL_ACTIONS = Object.values(AuditAction);

/** A file counts as an emit point only when it BOTH mentions the action
 * literal AND imports the audit write helper — that is the service-layer
 * `log()` / `logAudit()` call shape. Label maps (`AUDIT_ACTION_LABELS`,
 * `ACTIVITY_LABELS`) and UI comparisons never import the audit module, so
 * they can never satisfy the rule (spec: emit point di service layer, bukan
 * UI — `modules/audit` is a cross-cutting import per architecture-standards). */
const AUDIT_QUOTE = /from "@\/modules\/audit\/service"/;

function filesEmitting(action: string): string[] {
  const needle = `"${action}"`;
  return SOURCE_FILES.filter((file) => {
    const content = readFileSync(file, "utf8");
    return content.includes(needle) && AUDIT_QUOTE.test(content);
  });
}

/** All application source files — tests excluded so a fixture mention
 * can never masquerade as an emit point. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = collectSourceFiles(SRC_ROOT);

describe("every AuditAction has an emit point (grep evidence)", () => {
  it("collects the application source tree (sanity guard)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(30);
  });

  it.each(ALL_ACTIONS)("%s is emitted from a service-layer module", (action) => {
    const hits = filesEmitting(action);
    expect(
      hits.length,
      `no service-layer emit point found for ${action} — add a log()/logAudit() call in the owning module`,
    ).toBeGreaterThan(0);
  });

  it("label maps and UI files are never counted as emit points", () => {
    // The dashboard timeline compares PAYMENT_RECORDED with a quoted literal,
    // but it does not import the audit helper — proof the rule above is strict.
    const uiOnlyFiles = SOURCE_FILES.filter((file) => {
      const content = readFileSync(file, "utf8");
      return (
        content.includes('"PAYMENT_RECORDED"') &&
        !AUDIT_QUOTE.test(content) &&
        file.includes("activity-timeline")
      );
    });
    expect(uiOnlyFiles.length).toBe(1);
    expect(uiOnlyFiles.some((file) => filesEmitting("PAYMENT_RECORDED").includes(file))).toBe(
      false,
    );
  });
});

describe("audit log viewer (feature 09) covers every action", () => {
  it("every action carries a non-empty Indonesian label", () => {
    for (const action of ALL_ACTIONS) {
      const label = AUDIT_ACTION_LABELS[action];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(action);
    }
  });

  it("the action filter validates every enum value (the dropdown lists them all)", () => {
    for (const action of ALL_ACTIONS) {
      const parsed = adminAuditQuerySchema.safeParse({ action });
      expect(parsed.success, `viewer filter rejected ${action}`).toBe(true);
    }
  });

  it("still rejects an unknown action", () => {
    expect(adminAuditQuerySchema.safeParse({ action: "BUKAN_AKSI" }).success).toBe(false);
  });
});
