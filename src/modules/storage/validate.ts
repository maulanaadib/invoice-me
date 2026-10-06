// src/modules/storage/validate.ts
// Pure upload validation: size limit + MIME sniffing from magic bytes.
// The client-supplied filename and declared type are never consulted, so a
// "photo.png" containing PDF bytes is rejected by content, not by label.

import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { AppError } from "@/lib/errors";

/**
 * Only formats the storage layer can name a file for. PDF belongs here because
 * PO-reference uploads (feature 03) accept PDF by content, not by label.
 */
export const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

const MIME_LABELS: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "application/pdf": "PDF",
};

function label(mimeType: string): string {
  return MIME_LABELS[mimeType] ?? mimeType;
}

export interface ValidatedUpload {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  sha256: string;
}

/**
 * Throws AppError VALIDATION_ERROR with an Indonesian message on: empty file,
 * size over maxBytes, unknown content, or content outside the allow-list.
 * Returns the sniffed MIME type + storage extension + content hash on success.
 */
export async function validateUpload(
  buffer: Buffer,
  options: { maxBytes: number; allowedMimeTypes: readonly string[] },
): Promise<ValidatedUpload> {
  if (buffer.length === 0) {
    throw new AppError("VALIDATION_ERROR", "File kosong.");
  }
  if (buffer.length > options.maxBytes) {
    const maxMb = Math.max(1, Math.round(options.maxBytes / (1024 * 1024)));
    throw new AppError(
      "VALIDATION_ERROR",
      `Ukuran file melebihi batas ${maxMb} MB. Kompres atau pilih file yang lebih kecil.`,
    );
  }

  const detected = await fileTypeFromBuffer(buffer);
  const mimeType = detected?.mime ?? "";
  if (!options.allowedMimeTypes.includes(mimeType)) {
    const allowed = options.allowedMimeTypes.map(label).join(", ");
    const detail = detected
      ? `Format file terdeteksi sebagai ${label(mimeType)}.`
      : "Format file tidak dikenali.";
    throw new AppError(
      "VALIDATION_ERROR",
      `${detail} Format yang diizinkan: ${allowed}.`,
    );
  }

  const extension = EXTENSION_BY_MIME[mimeType];
  if (!extension) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Format ${label(mimeType)} tidak didukung penyimpanan.`,
    );
  }

  return {
    buffer,
    mimeType,
    extension,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}
