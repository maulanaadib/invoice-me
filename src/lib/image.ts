// src/lib/image.ts
// Server-side image preparation shared by logo and signature uploads:
// validate (size + sniffed MIME) → sharp resize/optimize → File ready for
// StorageService.upload. Output format always matches the sniffed input
// format, so the stored extension and content never disagree.

import { AppError } from "@/lib/errors";
import { env } from "@/server/env";
import { validateUpload } from "@/modules/storage/validate";
import { IMAGE_MIME_LABEL, IMAGE_MIME_TYPES } from "@/lib/image-meta";
import sharp from "sharp";

// Re-exported so server callers can keep importing from this module.
export { IMAGE_MIME_LABEL, IMAGE_MIME_TYPES };

export interface PreparedImage {
  /** Optimized image, named generically — StorageService picks the real name. */
  file: File;
}

/**
 * Throws AppError VALIDATION_ERROR with a clear Indonesian message for
 * oversized, empty, fake-extension (magic-byte mismatch), or unprocessable
 * files. Server-side: the browser accepts anything, the server decides.
 */
export async function prepareImageUpload(
  file: File,
  options: { maxWidth?: number } = {},
): Promise<PreparedImage> {
  const raw = Buffer.from(await file.arrayBuffer());
  const validated = await validateUpload(raw, {
    maxBytes: Math.round(env.UPLOAD_MAX_MB * 1024 * 1024),
    allowedMimeTypes: IMAGE_MIME_TYPES,
  });

  let optimized: Buffer;
  try {
    const pipeline = sharp(raw)
      .rotate() // honor EXIF orientation, then strip metadata on output
      .resize({
        width: options.maxWidth ?? 800,
        withoutEnlargement: true,
      });
    if (validated.mimeType === "image/jpeg") {
      optimized = await pipeline.jpeg({ quality: 82 }).toBuffer();
    } else if (validated.mimeType === "image/webp") {
      optimized = await pipeline.webp({ quality: 85 }).toBuffer();
    } else {
      optimized = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    }
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      `File gambar tidak dapat diproses. Pastikan file adalah ${IMAGE_MIME_LABEL} yang tidak rusak.`,
    );
  }

  // Copy into a plain (non-Node) view: BlobPart types don't accept the
  // Node-specific Buffer typing under strict TS.
  return {
    file: new File([new Uint8Array(optimized)], "upload", { type: validated.mimeType }),
  };
}
