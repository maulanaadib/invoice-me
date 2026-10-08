// src/modules/invoices/issue-retry.test.ts
// Unit tests for the issue transaction retry (feature 05 Check When Done:
// "Retry pada konflik sequence bekerja"). Conflict-shaped failures
// (P2034/P2002/serialization errors) retry with backoff, bounded by
// ISSUE_MAX_RETRIES; business errors never retry; exhausted retries surface
// as CONFLICT with the invoice still a draft (total rollback happens in the
// service — this file proves the policy).

import { describe, expect, it, vi } from "vitest";
import { AppError, isAppError } from "@/lib/errors";
import {
  ISSUE_MAX_RETRIES,
  isRetryableIssueError,
  withIssueRetry,
} from "@/modules/invoices/issue-service";

function conflictError(code: string, message = "transaction failed"): Error {
  return Object.assign(new Error(message), { code });
}

describe("isRetryableIssueError", () => {
  it("marks Prisma conflict codes retryable", () => {
    expect(isRetryableIssueError(conflictError("P2034"))).toBe(true);
    expect(isRetryableIssueError(conflictError("P2002"))).toBe(true);
  });

  it("marks raw serialization failures retryable (message shape)", () => {
    expect(
      isRetryableIssueError(new Error("could not serialize access due to concurrent update")),
    ).toBe(true);
    expect(isRetryableIssueError(new Error("deadlock detected"))).toBe(true);
    expect(isRetryableIssueError(new Error('SQLSTATE 40001: write conflict'))).toBe(true);
  });

  it("never retries business errors or unknown failures", () => {
    expect(isRetryableIssueError(new AppError("LOCKED", "Invoice sudah terbit."))).toBe(false);
    expect(isRetryableIssueError(new AppError("NOT_FOUND", "Invoice tidak ditemukan."))).toBe(false);
    expect(isRetryableIssueError(new Error("boom"))).toBe(false);
    expect(isRetryableIssueError("P2034")).toBe(false);
  });
});

describe("withIssueRetry", () => {
  it("returns the first success without sleeping", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi.fn(async () => "ok");
    await expect(withIssueRetry(run, { sleep })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a sequence conflict then succeeds (2 attempts, one retry)", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(conflictError("P2034"))
      .mockResolvedValueOnce("INV/SB/VII/2026/001");

    await expect(withIssueRetry(run, { sleep })).resolves.toBe("INV/SB/VII/2026/001");
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially (25ms, 50ms, 100ms)", async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(conflictError("P2034"))
      .mockRejectedValueOnce(conflictError("P2002"))
      .mockRejectedValueOnce(new Error("could not serialize access due to concurrent update"))
      .mockResolvedValueOnce("ok");

    await expect(withIssueRetry(run, { sleep })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([25, 50, 100]);
  });

  it("gives up after ISSUE_MAX_RETRIES with CONFLICT (spec: maks 3 retry)", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi.fn(async () => {
      throw conflictError("P2034");
    });

    let caught: unknown = null;
    try {
      await withIssueRetry(run, { sleep });
    } catch (error) {
      caught = error;
    }
    expect(isAppError(caught)).toBe(true);
    expect((caught as AppError).code).toBe("CONFLICT");
    // First attempt + ISSUE_MAX_RETRIES retries.
    expect(run).toHaveBeenCalledTimes(1 + ISSUE_MAX_RETRIES);
    expect(sleep).toHaveBeenCalledTimes(ISSUE_MAX_RETRIES);
    expect(((caught as AppError).message as string)).toMatch(/nomor invoice|coba lagi/i);
  });

  it("propagates non-retryable errors immediately", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi.fn(async () => {
      throw new AppError("LOCKED", "Invoice sudah terbit.");
    });

    await expect(withIssueRetry(run, { sleep })).rejects.toMatchObject({ code: "LOCKED" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
