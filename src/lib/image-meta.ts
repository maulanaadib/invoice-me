// src/lib/image-meta.ts
// Client-safe image metadata. Lives apart from src/lib/image.ts (which pulls
// in sharp/Node built-ins) so upload UI can show accepted types and limits
// without dragging the server pipeline into the browser bundle.

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const IMAGE_MIME_LABEL = "PNG, JPEG, atau WebP";
