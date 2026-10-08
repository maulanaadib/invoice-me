// src/instrumentation.ts
// Next.js runs this exactly ONCE per server instance (docs:
// 01-app/03-api-reference/03-file-conventions/instrumentation.md) — the one
// documented place to start long-lived server work. Feature 06 starts the
// PdfJob poller here so dev server, production `next start` and the Docker
// container all run the SAME in-process worker, with no extra entrypoint to
// keep alive (architecture decision: interval di app container, single
// instance MVP).
//
// Gate on NEXT_RUNTIME + dynamic import: `register` also runs in the Edge
// runtime, where node:crypto / Prisma must never be loaded.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startPdfWorker } = await import("@/modules/pdf/worker");
  startPdfWorker();
}
