import { defineConfig, devices } from "@playwright/test";

// E2E runs against the dev app + dev postgres (context/testing-standards.md):
// a Playwright webServer starts `npm run dev` — or reuses one already running
// on :3000 — so the browser, the server and the fixture rows written by the
// spec all share the same database the dev server was started with.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
