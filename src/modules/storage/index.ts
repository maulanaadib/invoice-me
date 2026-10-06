// src/modules/storage/index.ts
// StorageService factory — the single dependency-injection point for storage
// backends. Swapping in S3/MinIO means returning another implementation here;
// callers only ever see the StorageService interface.

import { LocalStorageService } from "@/modules/storage/local";
import type { StorageService } from "@/modules/storage/types";

export type {
  StorageService,
  StoredContent,
  StoredObject,
  UploadOptions,
} from "@/modules/storage/types";
export { validateUpload } from "@/modules/storage/validate";

export function getStorageService(): StorageService {
  return new LocalStorageService();
}
