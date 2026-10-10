#!/usr/bin/env node
// scripts/maintenance.mjs — feature 11A: operational maintenance jobs.
//
// Runs two idempotent jobs and prints ONE structured JSON line per event
// (error-handling.md: structured logs, never any secret/PII):
//
//   1. orphan file cleanup — walk STORAGE_ROOT and delete files that NO
//      database record references: UploadRecord.path, InvoicePdf.storagePath,
//      Invoice.pdfPath, ProjectReference.attachmentPath, InvoiceProfile.logoPath,
//      Signer.signatureImagePath, Payment.proofPath. A file with any of those
//      references is kept; a file with none is an orphan (its owner is gone and
//      the best-effort file delete failed, or it is a leftover fixture).
//      Hidden files (`.health-check` probes) are never touched.
//   2. OVERDUE recompute — persist the on-read OVERDUE status in batches of
//      100: status ∈ (ISSUED, SENT, PARTIALLY_PAID) AND dueDate < today
//      (Asia/Jakarta) → status = OVERDUE. PAID / CANCELLED / DRAFT / REVISED
//      are never selected, and a dueDate equal to today is NOT overdue — the
//      same strict calendar rule as `isPastDue` in
//      src/modules/invoices/lifecycle-service.ts, mirrored here because this
//      script runs on plain `node` and cannot import TypeScript (same
//      precedent as rotate-bank-key.mjs).
//
// Entry point: scripts/maintenance.sh (loads .env / .env.local; caller env
// wins). Scheduling (Coolify scheduled task / host cron) is deployment
// configuration — feature 11C, deliberately out of this feature's scope.
//
// Usage:
//   scripts/maintenance.sh
//   STORAGE_ROOT=/data DATABASE_URL=... scripts/maintenance.sh

import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

/** Statuses that can still become overdue — mirrors OVERDUE_ELIGIBLE_STATUSES
 * in modules/invoices/lifecycle-service.ts (PAID is settled, DRAFT is not a
 * bill, CANCELLED/REVISED are excluded by definition). */
export const OVERDUE_ELIGIBLE_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID"];

/** Spec 11A: overdue recompute runs in batches of 100 and logs each batch. */
export const OVERDUE_BATCH_SIZE = 100;

/** Every column that owns a storage path — a file referenced by any of these
 * has a record and must never be treated as an orphan. */
const REFERENCE_COLUMNS = [
  ["uploadRecord", "path"],
  ["invoicePdf", "storagePath"],
  ["invoice", "pdfPath"],
  ["projectReference", "attachmentPath"],
  ["invoiceProfile", "logoPath"],
  ["signer", "signatureImagePath"],
  ["payment", "proofPath"],
];

/** One structured JSON line per maintenance event (stdout for progress,
 * stderr for failures — no secrets, no account numbers, no NPWP). */
function logEvent(fields) {
  const line = JSON.stringify({
    level: fields.level ?? "info",
    module: "maintenance",
    at: new Date().toISOString(),
    ...fields,
  });
  if ((fields.level ?? "info") === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** UTC midnight of "today" in Asia/Jakarta — dueDate is a stored calendar day
 * (UTC midnight), exactly like the app's `todayInJakarta` boundary. */
export function startOfTodayJakarta(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${day}T00:00:00.000Z`);
}

/** Pure selection rule (unit-tested): eligible status AND dueDate strictly
 * before today in Jakarta. A missing dueDate is never overdue. */
export function isOverdueCandidate(row, now = new Date()) {
  if (!row || !OVERDUE_ELIGIBLE_STATUSES.includes(row.status)) return false;
  if (!row.dueDate) return false;
  return new Date(row.dueDate).getTime() < startOfTodayJakarta(now).getTime();
}

/** The stored status a row should have after the sweep — OVERDUE when the
 * candidate rule matches, otherwise the row's own status, untouched. */
export function nextStoredStatus(row, now = new Date()) {
  return isOverdueCandidate(row, now) ? "OVERDUE" : row.status;
}

async function collectReferencedPaths(prisma) {
  const referenced = new Set();
  for (const [model, column] of REFERENCE_COLUMNS) {
    const rows = await prisma[model].findMany({ select: { [column]: true } });
    for (const row of rows) {
      const path = row[column];
      if (path) referenced.add(path);
    }
  }
  return referenced;
}

/** Recursively lists files under `dir` as root-relative POSIX paths.
 * Missing directories are "nothing to scan"; hidden files are skipped. */
async function walkFiles(dir, root, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolute, root, out);
    } else if (entry.isFile() && !entry.name.startsWith(".")) {
      out.push(relative(root, absolute).split(sep).join("/"));
    }
  }
  return out;
}

/**
 * Job 1 — orphan file cleanup. Deletes files under `storageRoot` that no
 * database record references. Idempotent: a second run finds nothing to
 * delete. Individual failures are logged and counted instead of aborting the
 * job, so one unreadable file never stops the sweep.
 */
export async function cleanupOrphanFiles(prisma, options = {}) {
  const storageRoot = resolve(options.storageRoot ?? process.env.STORAGE_ROOT ?? "./.data");
  const log = options.log ?? logEvent;
  const referenced = await collectReferencedPaths(prisma);
  const files = await walkFiles(storageRoot, storageRoot);

  let kept = 0;
  let deleted = 0;
  let failed = 0;
  for (const relativePath of files) {
    if (referenced.has(relativePath)) {
      kept += 1;
      continue;
    }
    try {
      await rm(join(storageRoot, relativePath), { force: true });
      deleted += 1;
      log({ job: "orphan-cleanup", event: "deleted", path: relativePath });
    } catch (error) {
      failed += 1;
      log({
        level: "error",
        job: "orphan-cleanup",
        event: "delete-failed",
        path: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  log({
    job: "orphan-cleanup",
    event: "summary",
    storageRoot,
    scanned: files.length,
    kept,
    deleted,
    failed,
  });
  return { scanned: files.length, kept, deleted, failed };
}

/**
 * Job 2 — batched OVERDUE recompute (spec: batch 100, log the count). Each
 * batch re-checks the predicate on UPDATE (a row that changed under us is
 * simply not counted), and a batch that makes no progress stops the loop, so
 * the sweep can never spin. Running it again updates 0 rows — idempotent.
 */
export async function recomputeOverdue(prisma, options = {}) {
  const batchSize = options.batchSize ?? OVERDUE_BATCH_SIZE;
  const now = options.now ?? new Date();
  const log = options.log ?? logEvent;
  const startOfToday = startOfTodayJakarta(now);

  let updated = 0;
  let batches = 0;
  for (;;) {
    const rows = await prisma.invoice.findMany({
      where: {
        status: { in: OVERDUE_ELIGIBLE_STATUSES },
        dueDate: { not: null, lt: startOfToday },
      },
      select: { id: true },
      take: batchSize,
    });
    if (rows.length === 0) break;

    const result = await prisma.invoice.updateMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        status: { in: OVERDUE_ELIGIBLE_STATUSES },
        dueDate: { not: null, lt: startOfToday },
      },
      data: { status: "OVERDUE" },
    });
    batches += 1;
    updated += result.count;
    log({
      job: "overdue-recompute",
      event: "batch",
      batch: batches,
      matched: rows.length,
      updated: result.count,
    });
    // No progress (rows changed concurrently) or a partial batch means the
    // candidate set is drained — stop instead of re-querying forever.
    if (result.count === 0 || rows.length < batchSize) break;
  }
  log({ job: "overdue-recompute", event: "summary", batches, updated });
  return { updated, batches };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    logEvent({
      level: "error",
      event: "fatal",
      error:
        "DATABASE_URL belum di-set — jalankan lewat scripts/maintenance.sh (memuat .env / .env.local) atau export DATABASE_URL.",
    });
    return 1;
  }

  const storageRoot = resolve(process.env.STORAGE_ROOT || "./.data");
  const prisma = new PrismaClient();
  let exitCode = 0;
  try {
    logEvent({ event: "start", storageRoot, jobs: ["orphan-cleanup", "overdue-recompute"] });
    const orphan = await cleanupOrphanFiles(prisma, { storageRoot });
    const overdue = await recomputeOverdue(prisma, {});
    logEvent({
      event: "done",
      orphanCleanup: {
        scanned: orphan.scanned,
        kept: orphan.kept,
        deleted: orphan.deleted,
        failed: orphan.failed,
      },
      overdueRecompute: { updated: overdue.updated, batches: overdue.batches },
    });
    if (orphan.failed > 0) exitCode = 1;
  } catch (error) {
    logEvent({
      level: "error",
      event: "fatal",
      error: error instanceof Error ? error.message : String(error),
    });
    exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
  return exitCode;
}

// Run only when executed directly — tests import the job functions instead.
const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedUrl === import.meta.url) {
  process.exit(await main());
}
