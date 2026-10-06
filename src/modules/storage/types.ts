// src/modules/storage/types.ts
// StorageService contract (code-standards.md "Data and Storage"): upload with
// MIME sniffing + random filename, read with a caller-side authorization
// check before streaming, delete for replacing assets. LocalStorageService is
// the only implementation today; the interface keeps S3/MinIO a drop-in.

export interface UploadOptions {
  /** Owning organization id — becomes part of the path (validated segment). */
  orgId: string;
  /** Asset kind within the organization, e.g. "logo" | "signature". */
  kind: string;
  /**
   * Accept-list checked against the SNIFFED content type (magic bytes), never
   * the client filename/declared type. Required so every caller states its
   * policy explicitly.
   */
  allowedMimeTypes: readonly string[];
}

export interface StoredObject {
  /** Root-relative path, e.g. uploads/organizations/{orgId}/logo/{uuid}.png */
  path: string;
  size: number;
  mimeType: string;
  sha256: string;
}

export interface StoredContent {
  data: Buffer;
  mimeType: string;
}

export interface StorageService {
  upload(file: File, options: UploadOptions): Promise<StoredObject>;
  read(path: string): Promise<StoredContent>;
  delete(path: string): Promise<void>;
}
