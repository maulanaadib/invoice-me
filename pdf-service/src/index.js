// pdf-service/src/index.js
// PDF rendering service skeleton — feature 00.
// Full HTML→PDF rendering is implemented in feature 06.
// This file provides: health endpoint + signed request verification.

import express from "express";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 3001;
const INTERNAL_PDF_SECRET = process.env.INTERNAL_PDF_SECRET;
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "/data";

if (!INTERNAL_PDF_SECRET) {
  console.error("INTERNAL_PDF_SECRET is required");
  process.exit(1);
}

/**
 * Verify signed token from the app.
 * Token format: base64(JSON { payload, expiry }) + "." + HMAC-SHA256 signature
 */
function verifySignedToken(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return false;

  const data = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  // Verify HMAC
  const expected = crypto
    .createHmac("sha256", INTERNAL_PDF_SECRET)
    .update(data)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }

  // Check expiry
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!parsed.expiry || Date.now() > parsed.expiry) return false;
    return true;
  } catch {
    return false;
  }
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
    },
    timestamp: new Date().toISOString(),
  });
});

// ─── Render endpoint (skeleton) ───────────────────────────────────────────────

app.post("/render", (req, res) => {
  // Verify signed token before processing
  if (!verifySignedToken(req.headers.authorization)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Full HTML→PDF rendering via Playwright is implemented in feature 06.
  // Signature verification above is fully functional.
  res.status(503).json({
    error: "Render not yet implemented",
    message: "PDF rendering is implemented in feature 06.",
  });
});

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: `pdf-service started on port ${PORT}`,
      timestamp: new Date().toISOString(),
    }),
  );
});
