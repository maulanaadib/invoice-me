// src/modules/storage/local.ts
// Local filesystem implementation of StorageService.
//
// Path-traversal safety, defense in depth at three layers:
//   1. the stored filename is `randomUUID() + sniffedExt` — the client's
//      filename never reaches the path at all;
//   2. orgId/kind must match a safe segment pattern before joining;
//   3. resolveSafe() re-checks that the resolved absolute path stays under
//      STORAGE_ROOT (catches any future caller that hand-builds a path).

import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { AppError } from "@/lib/errors";
import { env } from "@/server/env";
import { validateUpload } from "@/modules/storage/validate";
import type {
  SaveInvoicePdfOptions,
  StorageService,
  StoredContent,
  StoredObject,
  UploadOptions,
} from "@/modules/storage/types";

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
// Generated PDF names are built server-side (safePdfFilename); re-check the
// shape anyway so no future caller can smuggle a traversal through `filename`.
const SAFE_PDF_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.pdf$/;

export class LocalStorageService implements StorageService {
  private readonly root: string;

  constructor(root?: string) {
    this.root = resolve(root ?? env.STORAGE_ROOT);
  }

  /** Absolute path for a stored path; throws unless it stays under root. */
  private resolveSafe(path: string): string {
    if (!path || path.startsWith("/") || path.includes("\0")) {
      throw new AppError("VALIDATION_ERROR", "Path file tidak valid.");
    }
    const absolute = resolve(this.root, path);
    if (absolute !== this.root && !absolute.startsWith(this.root + sep)) {
      throw new AppError("VALIDATION_ERROR", "Path file tidak valid.");
    }
    return absolute;
  }

  async upload(file: File, options: UploadOptions): Promise<StoredObject> {
    if (!SAFE_SEGMENT.test(options.orgId) || !SAFE_SEGMENT.test(options.kind)) {
      throw new AppError("VALIDATION_ERROR", "Tujuan penyimpanan file tidak valid.");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const validated = await validateUpload(bytes, {
      maxBytes: Math.round(env.UPLOAD_MAX_MB * 1024 * 1024),
      allowedMimeTypes: options.allowedMimeTypes,
    });

    const path = [
      "uploads",
      "organizations",
      options.orgId,
      options.kind,
      `${randomUUID()}${validated.extension}`,
    ].join("/");
    const absolute = this.resolveSafe(path);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, validated.buffer);

    return {
      path,
      size: validated.buffer.length,
      mimeType: validated.mimeType,
      sha256: validated.sha256,
    };
  }

  async read(path: string): Promise<StoredContent> {
    const absolute = this.resolveSafe(path);
    let data: Buffer;
    try {
      data = await readFile(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError("NOT_FOUND", "File tidak ditemukan.");
      }
      throw error;
    }
    const detected = await fileTypeFromBuffer(data);
    return { data, mimeType: detected?.mime ?? "application/octet-stream" };
  }

  async saveInvoicePdf(data: Buffer, options: SaveInvoicePdfOptions): Promise<StoredObject> {
    if (!SAFE_SEGMENT.test(options.orgId)) {
      throw new AppError("VALIDATION_ERROR", "Tujuan penyimpanan file tidak valid.");
    }
    if (!Number.isInteger(options.year) || options.year < 2000 || options.year > 9999) {
      throw new AppError("VALIDATION_ERROR", "Tahun penyimpanan file tidak valid.");
    }
    if (!SAFE_PDF_FILENAME.test(options.filename)) {
      throw new AppError("VALIDATION_ERROR", "Nama file PDF tidak valid.");
    }
    // Defense in depth: only a real PDF reaches the persistent volume.
    if (data.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new AppError("VALIDATION_ERROR", "Isi file bukan PDF yang valid.");
    }

    const path = [
      "invoices",
      "organizations",
      options.orgId,
      String(options.year),
      options.filename,
    ].join("/");
    const absolute = this.resolveSafe(path);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);

    return {
      path,
      size: data.length,
      mimeType: "application/pdf",
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  }

  async delete(path: string): Promise<void> {
    await rm(this.resolveSafe(path), { force: true });
  }
}
