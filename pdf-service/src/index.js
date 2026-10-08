// pdf-service/src/index.js
// Feature 06: HTML → PDF rendering for issued invoices.
//
// Contract (feature 06 spec):
//   GET  /health  — storage writability probe (compose healthcheck).
//   POST /render  — Authorization: Bearer <signed token>; the SIGNED PAYLOAD
//                   carries everything (printUrl, storagePath, filename,
//                   footer, title/author), so no body part is ever trusted.
//                   401 for missing / malformed / expired / wrong-purpose
//                   signatures.
//
// Render flow (pilih spec: fetch print route, bukan HTML inline — token auth
// is exercised end to end and the HTML always comes from the app):
//   1. verify signature + expiry;
//   2. fetch INTERNAL printUrl with bounded retries (maks 3, backoff);
//   3. Playwright Chromium headless, A4, printBackground, @page margins,
//      waitUntil networkidle — HTML/CSS print, NEVER a screenshot, so the
//      text stays sharp and selectable;
//   4. stamp PDF metadata (Title = invoice number, Author = profile name)
//      via pdf-lib;
//   5. write the shared volume at /data/invoices/organizations/{orgId}/
//      {year}/{filename}.pdf (path re-checked against STORAGE_ROOT);
//   6. return { storagePath, filename, sizeBytes, mimeType, sha256 }.
//
// The pdf-service port is not published in docker-compose (invariant 10:
// internal network only).

import express from "express";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT ?? 3001;
const INTERNAL_PDF_SECRET = process.env.INTERNAL_PDF_SECRET;
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "/data";
/** Hard budget for the Playwright render itself (spec: default 30s). */
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 30_000);
const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_BACKOFF_MS = [500, 1_500];

if (!INTERNAL_PDF_SECRET) {
  console.error("INTERNAL_PDF_SECRET is required");
  process.exit(1);
}

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...extra }));
}

/**
 * Verifies `Authorization: Bearer <data>.<hmac>` (format from the feature 00
 * skeleton). Returns the parsed payload for purpose "render" and unexpired
 * tokens, otherwise null — every failure looks the same from outside.
 */
function verifyRenderToken(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex <= 0) return null;

  const data = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = crypto
    .createHmac("sha256", INTERNAL_PDF_SECRET)
    .update(data)
    .digest("base64url");

  // timingSafeEqual throws on length mismatch — guard first.
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.p !== "render") return null;
    if (typeof parsed.expiry !== "number" || Date.now() > parsed.expiry) return null;
    if (typeof parsed.printUrl !== "string" || typeof parsed.storagePath !== "string") return null;
    if (typeof parsed.filename !== "string" || typeof parsed.title !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Resolves a signed storage path safely under STORAGE_ROOT. */
function resolveStoragePath(relativePath) {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("storagePath tidak valid");
  }
  const absolute = path.resolve(STORAGE_ROOT, relativePath);
  const root = path.resolve(STORAGE_ROOT);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("storagePath di luar STORAGE_ROOT");
  }
  return absolute;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Playwright displayHeaderFooter template (spec: page number dari engine PDF,
 * bukan statis). Header/footer do NOT inherit page CSS — every style must be
 * inline. Chromium provides .pageNumber / .totalPages at print time.
 */
function footerTemplate(referenceLine) {
  return `<div style="width:100%;padding:0 10mm;font-size:7.5px;color:#64748b;display:flex;justify-content:space-between;align-items:center;font-family:Inter,Arial,sans-serif;box-sizing:border-box;">
  <span style="flex:1;margin-right:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(referenceLine)}</span>
  <span style="white-space:nowrap;">Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span>
</div>`;
}

async function fetchPrintHtml(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "manual",
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 404) {
        // Token/invoice problems do not heal — fail immediately.
        const body = await response.text().catch(() => "");
        const error = new Error(`print route menjawab ${response.status}`);
        error.status = response.status;
        error.body = body.slice(0, 200);
        throw error;
      }
      if (!response.ok) {
        throw new Error(`print route menjawab ${response.status}`);
      }
      const html = await response.text();
      if (!html.includes("<html")) {
        throw new Error("respons print route bukan dokumen HTML");
      }
      return html;
    } catch (error) {
      if (error.status === 401 || error.status === 404) throw error;
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        const backoff = FETCH_BACKOFF_MS[attempt - 1] ?? 1_500;
        log("warn", "pengambilan print route gagal, mencoba lagi", { attempt, backoff, err: String(error) });
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError ?? new Error("print route tidak terjangkau");
}

// ─── Health endpoint ──────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  let storageWritable = false;
  try {
    const testPath = path.join(STORAGE_ROOT, ".pdf-health-check");
    await fs.mkdir(STORAGE_ROOT, { recursive: true });
    await fs.writeFile(testPath, "ok");
    await fs.unlink(testPath);
    storageWritable = true;
  } catch {
    // storage check failed
  }

  const status = storageWritable ? "ok" : "degraded";
  res.status(status === "ok" ? 200 : 503).json({
    status,
    checks: {
      storage: storageWritable ? "ok" : "degraded",
      browser: browserReady ? "ok" : "starting",
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── Render endpoint ──────────────────────────────────────────────────────────

app.post("/render", async (req, res) => {
  const payload = verifyRenderToken(req.headers.authorization);
  if (!payload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const startedAt = Date.now();
  const { printUrl, storagePath, filename, footer = "", title, author = "" } = payload;
  if (path.basename(filename) !== filename) {
    return res.status(400).json({ error: "filename tidak valid" });
  }

  try {
    const html = await fetchPrintHtml(printUrl);
    const browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: "networkidle", timeout: RENDER_TIMEOUT_MS });
      await page.emulateMedia({ media: "print" });
      // FontFaceSet is not serializable — await it inside the page.
      await page
        .evaluate(async () => {
          try {
            await document.fonts.ready;
          } catch {
            // fonts API unavailable — render anyway
          }
          return true;
        })
        .catch(() => true);

      const pdfBuffer = Buffer.from(
        await page.pdf({
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: footerTemplate(footer),
          timeout: RENDER_TIMEOUT_MS,
        }),
      );
      await context.close();

      // Metadata (spec: Title = nomor invoice, Author = nama profile).
      const doc = await PDFDocument.load(pdfBuffer);
      doc.setTitle(title);
      doc.setAuthor(author);
      doc.setProducer("invoice-me pdf-service");
      doc.setCreator("invoice-me pdf-service");
      const bytes = await doc.save();
      const finalBuffer = Buffer.from(bytes);

      const absolute = resolveStoragePath(storagePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, finalBuffer);

      const sha256 = crypto.createHash("sha256").update(finalBuffer).digest("hex");
      const result = {
        storagePath,
        filename,
        sizeBytes: finalBuffer.length,
        mimeType: "application/pdf",
        sha256,
      };
      log("info", "render PDF selesai", {
        storagePath,
        sizeBytes: finalBuffer.length,
        durationMs: Date.now() - startedAt,
      });
      return res.status(200).json(result);
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const status = error?.status === 401 || error?.status === 404 ? 502 : 500;
    log("error", "render PDF gagal", {
      storagePath,
      err: String(error?.message ?? error),
      durationMs: Date.now() - startedAt,
    });
    return res.status(status).json({
      error: "Render gagal",
      message: String(error?.message ?? error).slice(0, 300),
    });
  }
});

// ─── Browser lifecycle (one Chromium per process) ─────────────────────────────

let browserPromise = null;
let browserReady = false;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
      })
      .then((browser) => {
        browserReady = true;
        log("info", "Chromium siap", { browserVersion: browser.version() });
        return browser;
      })
      .catch((error) => {
        browserPromise = null; // allow a retry on the next request
        throw error;
      });
  }
  return browserPromise;
}

// ─── Startup + graceful shutdown ─────────────────────────────────────────────

const server = app.listen(PORT, () => {
  log("info", `pdf-service started on port ${PORT}`, {
    storageRoot: STORAGE_ROOT,
    renderTimeoutMs: RENDER_TIMEOUT_MS,
  });
  // Warm the browser so the first invoice does not pay the launch cost.
  getBrowser().catch((error) => log("error", "Chromium gagal dijalankan", { err: String(error) }));
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", `menerima ${signal} — mematikan pdf-service`);
  server.close(() => {});
  try {
    if (browserPromise) await (await browserPromise).close();
  } catch {
    // browser already gone
  }
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
