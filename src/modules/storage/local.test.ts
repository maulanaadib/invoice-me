// src/modules/storage/local.test.ts
// Spec: StorageService path traversal safety — a hostile client filename
// (../../etc/passwd) never reaches the stored path, orgId/kind segments are
// validated, and resolveSafe refuses reads/deletes outside the root.

import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError, type ApiErrorCode, type AppError } from "@/lib/errors";
import { LocalStorageService } from "@/modules/storage/local";

// 1×1 PNG, held as a plain ArrayBuffer-backed view (File parts dislike the
// Node-specific Buffer typing under strict TS).
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const ALLOWED = ["image/png", "image/jpeg", "image/webp"] as const;

let root: string;
let storage: LocalStorageService;

async function expectFailure(
  promise: Promise<unknown>,
  code: ApiErrorCode,
  match?: RegExp,
): Promise<AppError> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(isAppError(caught)).toBe(true);
  const appError = caught as AppError;
  expect(appError.code).toBe(code);
  if (match) expect(appError.message).toMatch(match);
  return appError;
}

beforeAll(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  root = await mkdtemp(join("/tmp/opencode", "storage-test-"));
  storage = new LocalStorageService(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalStorageService.upload", () => {
  it("ignores a hostile client filename — ../../etc/passwd cannot escape the root", async () => {
    const file = new File([PNG], "../../etc/passwd", { type: "image/png" });
    const stored = await storage.upload(file, {
      orgId: "org_uji",
      kind: "logo",
      allowedMimeTypes: ALLOWED,
    });

    // Random UUID name, fixed segments — no client input anywhere in the path.
    expect(stored.path).toMatch(
      /^uploads\/organizations\/org_uji\/logo\/[0-9a-f-]{36}\.png$/,
    );
    expect(stored.path).not.toContain("..");
    expect(stored.path).not.toContain("passwd");

    const absolute = resolve(root, stored.path);
    expect(absolute === root || absolute.startsWith(root + sep)).toBe(true);

    // Only the expected tree exists under the fresh root — nothing escaped.
    expect(await readdir(root)).toEqual(["uploads"]);
    expect(await readdir(join(root, "uploads"))).toEqual(["organizations"]);

    const content = await storage.read(stored.path);
    expect(content.mimeType).toBe("image/png");
    expect(content.data.equals(Buffer.from(PNG))).toBe(true);
  });

  it("rejects unsafe orgId/kind segments before joining a path", async () => {
    const file = new File([PNG], "logo.png", { type: "image/png" });
    await expectFailure(
      storage.upload(file, {
        orgId: "../../etc",
        kind: "logo",
        allowedMimeTypes: ALLOWED,
      }),
      "VALIDATION_ERROR",
      /tidak valid/,
    );
    await expectFailure(
      storage.upload(file, {
        orgId: "org_uji",
        kind: "../..",
        allowedMimeTypes: ALLOWED,
      }),
      "VALIDATION_ERROR",
      /tidak valid/,
    );
  });
});

describe("path containment (resolveSafe)", () => {
  it("refuses reads and deletes outside the storage root", async () => {
    await expectFailure(storage.read("/etc/passwd"), "VALIDATION_ERROR", /tidak valid/);
    await expectFailure(
      storage.read("uploads/organizations/../../../etc/passwd"),
      "VALIDATION_ERROR",
      /tidak valid/,
    );
    await expectFailure(
      storage.delete("../../penting.txt"),
      "VALIDATION_ERROR",
      /tidak valid/,
    );
    await expectFailure(storage.read(""), "VALIDATION_ERROR", /tidak valid/);
    await expectFailure(storage.read("file\0.txt"), "VALIDATION_ERROR", /tidak valid/);
  });

  it("reads existing files and treats delete of a missing file as a no-op", async () => {
    const file = new File([PNG], "x.png", { type: "image/png" });
    const stored = await storage.upload(file, {
      orgId: "org_uji",
      kind: "logo",
      allowedMimeTypes: ALLOWED,
    });

    await storage.delete(stored.path); // force: no throw when gone
    await expectFailure(storage.read(stored.path), "NOT_FOUND", /tidak ditemukan/);
    await expectFailure(
      storage.read("uploads/organizations/org_uji/logo/tidak-ada.png"),
      "NOT_FOUND",
      /tidak ditemukan/,
    );
  });
});
