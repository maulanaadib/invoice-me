// Unit tests: feature 09 UploadRecord bookkeeping (src/modules/storage/record.ts).
// Three contracts, none of which needs a database:
//   • mimeFromExtension — the MIME the storage page counts files by (sniffed
//     from the extension, falling back to octet-stream, never throwing).
//   • Best-effort writes — an action must never fail because bookkeeping failed;
//     reconcile is the safety net, so a throwing db is logged and swallowed.
//   • The decorator — every upload/delete is recorded exactly once, and
//     invoice PDFs are deliberately NOT recorded (InvoicePdf owns those).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageService, StoredContent, StoredObject } from "@/modules/storage/types";

const dbMock = vi.hoisted(() => ({
  uploadRecord: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/server/db", () => ({ db: dbMock }));
vi.mock("@/server/logger", () => ({ logger: loggerMock }));

import {
  mimeFromExtension,
  recordDelete,
  recordUpload,
  RecordingStorageService,
} from "@/modules/storage/record";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mimeFromExtension", () => {
  it("maps every extension the local backend can write", () => {
    expect(mimeFromExtension("logo.png")).toBe("image/png");
    expect(mimeFromExtension("foto.jpg")).toBe("image/jpeg");
    expect(mimeFromExtension("foto.jpeg")).toBe("image/jpeg");
    expect(mimeFromExtension("latar.webp")).toBe("image/webp");
    expect(mimeFromExtension("invoice.pdf")).toBe("application/pdf");
  });

  it("is case-insensitive on the extension", () => {
    expect(mimeFromExtension("LOGO.PNG")).toBe("image/png");
    expect(mimeFromExtension("Scan.Jpg")).toBe("image/jpeg");
  });

  it("falls back to octet-stream for unknown, missing or multi-part extensions", () => {
    expect(mimeFromExtension("catapult.xyz")).toBe("application/octet-stream");
    expect(mimeFromExtension("tanpa-ekstensi")).toBe("application/octet-stream");
    expect(mimeFromExtension("archive.tar.gz")).toBe("application/octet-stream");
    expect(mimeFromExtension("")).toBe("application/octet-stream");
  });
});

describe("recordUpload", () => {
  it("upserts one row keyed by path with the stored size as a BigInt", async () => {
    await recordUpload({
      organizationId: "org_1",
      path: "uploads/organizations/org_1/logos/a.png",
      size: 1024,
      mimeType: "image/png",
      kind: "logos",
    });

    expect(dbMock.uploadRecord.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.uploadRecord.upsert).toHaveBeenCalledWith({
      where: { path: "uploads/organizations/org_1/logos/a.png" },
      update: { sizeBytes: BigInt(1024), mimeType: "image/png", kind: "logos" },
      create: {
        organizationId: "org_1",
        path: "uploads/organizations/org_1/logos/a.png",
        sizeBytes: BigInt(1024),
        mimeType: "image/png",
        kind: "logos",
      },
    });
  });

  it("never throws when the write fails (best effort — reconcile heals it)", async () => {
    dbMock.uploadRecord.upsert.mockRejectedValueOnce(new Error("db sedang sibuk"));
    await expect(
      recordUpload({
        organizationId: "org_1",
        path: "uploads/organizations/org_1/logos/b.png",
        size: 10,
        mimeType: "image/png",
        kind: "logos",
      }),
    ).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(loggerMock.error.mock.calls[0]?.[0])).toContain(
      "uploads/organizations/org_1/logos/b.png",
    );
  });
});

describe("recordDelete", () => {
  it("removes the row for an upload path", async () => {
    await recordDelete("uploads/organizations/org_1/logos/a.png");
    expect(dbMock.uploadRecord.deleteMany).toHaveBeenCalledTimes(1);
    expect(dbMock.uploadRecord.deleteMany).toHaveBeenCalledWith({
      where: { path: "uploads/organizations/org_1/logos/a.png" },
    });
  });

  it("touches NOTHING for a non-upload path (invoice PDFs belong to InvoicePdf)", async () => {
    await recordDelete("invoices/organizations/org_1/2026/INV-SB-001.pdf");
    expect(dbMock.uploadRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("swallows a failing delete instead of breaking the caller", async () => {
    dbMock.uploadRecord.deleteMany.mockRejectedValueOnce(new Error("db mati"));
    await expect(recordDelete("uploads/organizations/org_1/logos/a.png")).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });
});

// ─── RecordingStorageService decorator ──────────────────────────────────────

const STORED: StoredObject = {
  path: "uploads/organizations/org_1/logos/x.png",
  size: 77,
  mimeType: "image/png",
  sha256: "abc",
};

const PDF_STORED: StoredObject = {
  path: "invoices/organizations/org_1/2026/INV-001.pdf",
  size: 512,
  mimeType: "application/pdf",
  sha256: "def",
};

function fakeInner(): StorageService {
  return {
    upload: vi.fn(async () => STORED),
    delete: vi.fn(async () => undefined),
    read: vi.fn(
      async (): Promise<StoredContent> => ({ data: Buffer.alloc(4), mimeType: "image/png" }),
    ),
    saveInvoicePdf: vi.fn(async () => PDF_STORED),
  };
}

describe("RecordingStorageService", () => {
  it("records every upload under the caller's organization", async () => {
    const inner = fakeInner();
    const service = new RecordingStorageService(inner);
    const options = {
      orgId: "org_1",
      kind: "logos",
      allowedMimeTypes: ["image/png"],
    } as const;

    const stored = await service.upload(new File([new Uint8Array([1])], "x.png"), options);

    expect(stored).toEqual(STORED);
    expect(inner.upload).toHaveBeenCalledTimes(1);
    expect(dbMock.uploadRecord.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.uploadRecord.upsert.mock.calls[0]?.[0]).toMatchObject({
      create: { organizationId: "org_1", path: STORED.path, kind: "logos" },
    });
  });

  it("keeps the bookkeeping off the hot path: a recorded write that fails still returns", async () => {
    const inner = fakeInner();
    const service = new RecordingStorageService(inner);
    dbMock.uploadRecord.upsert.mockRejectedValueOnce(new Error("db mati"));

    await expect(
      service.upload(new File([new Uint8Array([1])], "x.png"), {
        orgId: "org_1",
        kind: "logos",
        allowedMimeTypes: ["image/png"],
      }),
    ).resolves.toEqual(STORED);
    expect(inner.upload).toHaveBeenCalledTimes(1);
  });

  it("deletes the file first, then its row", async () => {
    const inner = fakeInner();
    const service = new RecordingStorageService(inner);

    await service.delete(STORED.path);

    expect(inner.delete).toHaveBeenCalledWith(STORED.path);
    expect(dbMock.uploadRecord.deleteMany).toHaveBeenCalledWith({ where: { path: STORED.path } });
    // Inner delete runs before the row removal (file gone → row must go too).
    expect(vi.mocked(inner.delete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dbMock.uploadRecord.deleteMany).mock.invocationCallOrder[0]!,
    );
  });

  it("propagates a real delete failure and does not remove the row", async () => {
    const inner = fakeInner();
    inner.delete = vi.fn(async () => {
      throw new Error("file terkunci");
    }) as StorageService["delete"];
    const service = new RecordingStorageService(inner);

    await expect(service.delete(STORED.path)).rejects.toThrow("file terkunci");
    expect(dbMock.uploadRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("reads through without recording anything", async () => {
    const inner = fakeInner();
    const service = new RecordingStorageService(inner);

    const content = await service.read(STORED.path);

    expect(content.data).toHaveLength(4);
    expect(dbMock.uploadRecord.upsert).not.toHaveBeenCalled();
    expect(dbMock.uploadRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("never records invoice PDFs — InvoicePdf is their source of truth", async () => {
    const inner = fakeInner();
    const service = new RecordingStorageService(inner);

    const stored = await service.saveInvoicePdf(Buffer.from("%PDF-1.4\n%%EOF\n"), {
      orgId: "org_1",
      year: 2026,
      filename: "INV-001.pdf",
    });

    expect(stored).toEqual(PDF_STORED);
    expect(inner.saveInvoicePdf).toHaveBeenCalledTimes(1);
    expect(dbMock.uploadRecord.upsert).not.toHaveBeenCalled();
    expect(dbMock.uploadRecord.deleteMany).not.toHaveBeenCalled();
  });
});
