// src/modules/storage/validate.test.ts
// Spec: size limit with a clear message, MIME decided by magic bytes (a PDF
// named .png is rejected), unknown content rejected, sha256 returned.

import { describe, expect, it } from "vitest";
import { isAppError, type AppError } from "@/lib/errors";
import { validateUpload } from "@/modules/storage/validate";

// 1×1 PNG (real, decodable) — the positive path.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ALLOWED = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX = 2 * 1024 * 1024;

async function expectValidationError(promise: Promise<unknown>, match: RegExp): Promise<AppError> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isAppError(caught)).toBe(true);
  const appError = caught as AppError;
  expect(appError.code).toBe("VALIDATION_ERROR");
  expect(appError.message).toMatch(match);
  return appError;
}

describe("validateUpload", () => {
  it("accepts a real PNG and returns sniffed type, extension and hash", async () => {
    const result = await validateUpload(PNG, { maxBytes: MAX, allowedMimeTypes: ALLOWED });
    expect(result.mimeType).toBe("image/png");
    expect(result.extension).toBe(".png");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.buffer.length).toBe(PNG.length);
  });

  it("rejects files over the size limit with a clear Indonesian message", async () => {
    const oversize = Buffer.concat([PNG, Buffer.alloc(MAX - PNG.length + 1)]);
    const error = await expectValidationError(
      validateUpload(oversize, { maxBytes: MAX, allowedMimeTypes: ALLOWED }),
      /melebihi batas 2 MB/,
    );
    expect(error.message).toMatch(/Kompres atau pilih file yang lebih kecil/);
  });

  it("rejects a fake extension: PDF bytes named .png are decided by content", async () => {
    const fakePng = Buffer.from("%PDF-1.7\n1 0 obj\n<< >>\nendobj\ntrailer\n");
    const error = await expectValidationError(
      validateUpload(fakePng, { maxBytes: MAX, allowedMimeTypes: ALLOWED }),
      /terdeteksi sebagai PDF/,
    );
    expect(error.message).toContain("PNG"); // lists what IS allowed
  });

  it("rejects formats outside the allow-list (e.g. GIF) and unknown bytes", async () => {
    // 1×1 GIF87a
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    await expectValidationError(
      validateUpload(gif, { maxBytes: MAX, allowedMimeTypes: ALLOWED }),
      /Format yang diizinkan/,
    );

    await expectValidationError(
      validateUpload(Buffer.from("ini bukan file gambar sama sekali"), {
        maxBytes: MAX,
        allowedMimeTypes: ALLOWED,
      }),
      /tidak dikenali/,
    );
  });

  it("rejects an empty file", async () => {
    await expectValidationError(
      validateUpload(Buffer.alloc(0), { maxBytes: MAX, allowedMimeTypes: ALLOWED }),
      /File kosong/,
    );
  });
});
