// src/modules/storage/index.ts
// StorageService factory — the single dependency-injection point for storage
// backends. Swapping in S3/MinIO means returning another implementation here;
// callers only ever see the StorageService interface.

import { LocalStorageService } from "@/modules/storage/local";
import { RecordingStorageService } from "@/modules/storage/record";
import type { StorageService } from "@/modules/storage/types";

export type {
  StorageService,
  StoredContent,
  StoredObject,
  UploadOptions,
} from "@/modules/storage/types";
export { validateUpload } from "@/modules/storage/validate";
export { reconcileUploadRecords } from "@/modules/storage/record";

/**
 * The single DI point for storage backends — and, since feature 09, the single
 * bookkeeping point: every backend is decorated with RecordingStorageService so
 * UploadRecord stays in sync without touching any caller.
 */
export function getStorageService(): StorageService {
  return new RecordingStorageService(new LocalStorageService());
}
