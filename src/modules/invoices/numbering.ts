// src/modules/invoices/numbering.ts
// Numbering engine (feature 04): sequence-key reset policy + draft preview
// numbers + the final-number allocator. The token grammar lives in
// modules/profiles/number-pattern (single source of truth since feature 02 —
// {CODE} {YYYY} {YY} {MM} {DD} {ROMAN_MONTH} {SEQ:n}); this module adds the
// reset policy (sequenceKey) around it.
//
// Reset policy decides which InvoiceSequence bucket a draft/issue draws from
// (unique [invoiceProfileId, sequenceKey] per data-model):
//   MONTHLY → "2026-07"   (per year+month)
//   YEARLY  → "2026"      (per year)
//   NEVER   → "*"         (one global counter)
//
// Final allocation (`allocateFinalNumber`) happens ONLY at issue time
// (feature 05) — inside a transaction, so drafts never burn a real number.
// Drafts carry a non-binding `numberPreview` (current bucket value + 1),
// which may legitimately repeat across concurrent drafts: the uniqueness
// invariant lives on the ISSUED number.

import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { previewNumber, validateNumberPattern } from "@/modules/profiles/number-pattern";
import { renderNumberPreview, sequenceKeyFor } from "@/modules/invoices/numbering-core";
import type { Prisma, SequenceResetPolicy } from "@prisma/client";

// Pure helpers live in numbering-core (client-safe so the editor preview can
// render the same preview number); re-exported here for the server call sites
// and tests that import from the engine module.
export { NEVER_RESET_KEY, renderNumberPreview, sequenceKeyFor, type NumberPreviewProfile } from "@/modules/invoices/numbering-core";

/**
 * Non-binding draft preview from the ACTIVE bucket's next value. Never
 * allocates, never writes.
 */
export async function buildNumberPreview(
  profile: {
    id: string;
    code: string;
    numberPattern: string;
    sequenceResetPolicy: SequenceResetPolicy;
  },
  invoiceDate: Date,
  tx?: Prisma.TransactionClient,
): Promise<string | null> {
  const client = tx ?? db;
  const key = sequenceKeyFor(profile.sequenceResetPolicy, invoiceDate);
  const existing = await client.invoiceSequence.findUnique({
    where: {
      invoiceProfileId_sequenceKey: { invoiceProfileId: profile.id, sequenceKey: key },
    },
    select: { currentValue: true },
  });
  return renderNumberPreview(profile, invoiceDate, (existing?.currentValue ?? 0) + 1);
}

/**
 * Allocate the next sequence value for a profile/date (feature 05 calls this
 * inside the issue transaction). Row-locked (`FOR UPDATE`) upsert against the
 * unique [invoiceProfileId, sequenceKey] index, so two concurrent issues on
 * the same bucket serialize and can never produce the same number. The
 * "INSERT … DO NOTHING, then SELECT … FOR UPDATE" dance is required because
 * Postgres cannot lock a row it has just inserted in the same statement.
 */
export async function nextSequence(
  tx: Prisma.TransactionClient,
  profile: { id: string; sequenceResetPolicy: SequenceResetPolicy },
  invoiceDate: Date,
): Promise<number> {
  const key = sequenceKeyFor(profile.sequenceResetPolicy, invoiceDate);
  // The primary key must be supplied by hand: @default(cuid()) is a
  // CLIENT-side default, so a raw INSERT would otherwise hit NOT NULL (23502).
  // randomUUID() keeps the same contract the data model asks for — a
  // non-sequential, unguessable id (node:crypto, never a counter).
  await tx.$executeRaw`
    INSERT INTO "InvoiceSequence" ("id", "invoiceProfileId", "sequenceKey", "currentValue", "updatedAt")
    VALUES (${randomUUID()}, ${profile.id}, ${key}, 0, now())
    ON CONFLICT ("invoiceProfileId", "sequenceKey") DO NOTHING
  `;
  // Lock the bucket row: a concurrent allocator blocks here until we commit.
  await tx.$queryRaw`
    SELECT id FROM "InvoiceSequence"
    WHERE "invoiceProfileId" = ${profile.id} AND "sequenceKey" = ${key}
    FOR UPDATE
  `;
  const updated = await tx.invoiceSequence.update({
    where: { invoiceProfileId_sequenceKey: { invoiceProfileId: profile.id, sequenceKey: key } },
    data: { currentValue: { increment: 1 } },
    select: { currentValue: true },
  });
  return updated.currentValue;
}

/**
 * Render a FINAL invoice number for a profile/date, allocating the sequence
 * (feature 05 issue flow). previewNumber zero-pads {SEQ:n} to the pattern
 * width, so the allocated int goes through as-is.
 */
export async function allocateFinalNumber(
  tx: Prisma.TransactionClient,
  profile: {
    id: string;
    code: string;
    numberPattern: string;
    sequenceResetPolicy: SequenceResetPolicy;
  },
  invoiceDate: Date,
): Promise<string> {
  const validation = validateNumberPattern(profile.numberPattern);
  if (!validation.ok) {
    // Issue-time hard failure — feature 05 surfaces this before any write.
    throw new Error(validation.message);
  }
  const allocated = await nextSequence(tx, profile, invoiceDate);
  return previewNumber(profile.numberPattern, {
    code: profile.code,
    date: invoiceDate,
    nextSequence: allocated,
  });
}
