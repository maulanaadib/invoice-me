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

/** Where `saveInvoicePdf` puts a file: `{orgId}/{year}/{safeFilename}.pdf`. */
export interface SaveInvoicePdfOptions {
  /** Owning organization id — validated path segment (never raw user input). */
  orgId: string;
  /** Invoice year for the folder, e.g. 2026. */
  year: number;
  /** Safe filename ending in `.pdf`, e.g. INV-SB-VII-2026-001.pdf */
  filename: string;
}

export interface StorageService {
  upload(file: File, options: UploadOptions): Promise<StoredObject>;
  read(path: string): Promise<StoredContent>;
  delete(path: string): Promise<void>;
  /**
   * Persists a GENERATED invoice PDF (feature 06) at
   * `invoices/organizations/{orgId}/{year}/{filename}` — the persistent path
   * shape from architecture-context Storage Model. Unlike `upload` this is
   * for bytes the server itself produced: it validates the path segments and
   * the `%PDF-` magic bytes instead of accepting any client type.
   */
  saveInvoicePdf(data: Buffer, options: SaveInvoicePdfOptions): Promise<StoredObject>;
}
