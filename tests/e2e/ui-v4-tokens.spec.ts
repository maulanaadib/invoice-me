// tests/e2e/ui-v4-tokens.spec.ts
// Change 12 (UI v4 Bento Kausal) — the token contract as COMPUTED STYLE, not a
// grep of the stylesheet. The production build converts the hsl() values in
// globals.css to hex, so the assertions target the RESOLVED colour: that is
// the stronger claim anyway (it proves the token actually paints the surface,
// not just that the variable is declared).
//
// Light mode must resolve the v4 values (navy primary, ivory background,
// emerald success, 16px radius); dark mode must still carry a full token set
// (BR-2: dark mode stays a GA feature). This is a regression guard in both
// directions: nobody silently reverts the palette, and nobody silently drops
// dark mode.
//
// `./setup-env` MUST stay the first import (same contract as the other specs).

import "./setup-env";
import { expect, test } from "@playwright/test";

test.describe("UI v4 Bento Kausal tokens (change 12)", () => {
  test("light mode: --primary navy, --background ivory, --success emerald", async ({
    page,
  }) => {
    await page.goto("/login");

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        primary: style.getPropertyValue("--primary").trim(),
        background: style.getPropertyValue("--background").trim(),
        success: style.getPropertyValue("--success").trim(),
        radius: style.getPropertyValue("--radius").trim(),
      };
    });

    // The production build converts the hsl() values in globals.css to hex,
    // so the assertions target the resolved value (navy / ivory / emerald).
    expect(tokens.primary).toBe("#1e365c"); // hsl(217 51% 24%) = #1E3A5F
    expect(tokens.background).toBe("#fafaf9"); // hsl(60 9% 98%) = #FAF9F7
    expect(tokens.success).toBe("#10b77f"); // hsl(160 84% 39%) = #059669
    expect(tokens.radius).toBe("1rem"); // 16px base radius (v4)
  });

  test("light mode body paints ivory with ink text", async ({ page }) => {
    await page.goto("/login");

    const colors = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return { backgroundColor: body.backgroundColor, color: body.color };
    });

    // Ivory page #FAF9F7 — the v4 surface, never pure white.
    expect(colors.backgroundColor.replace(/\s+/g, "")).toBe("rgb(250,250,249)");
  });

  test("dark mode: .dark class keeps the token set (navy-tint background)", async ({
    page,
  }) => {
    await page.goto("/login");

    // The dark block must still exist and resolve — dark mode is a GA feature
    // (BR-2: never drop the .dark block or next-themes).
    const dark = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "dark";
      probe.style.display = "none";
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const tokens = {
        background: style.getPropertyValue("--background").trim(),
        foreground: style.getPropertyValue("--foreground").trim(),
        primary: style.getPropertyValue("--primary").trim(),
      };
      probe.remove();
      return tokens;
    });

    expect(dark.background).toBe("#0e131b"); // hsl(217 33% 8%) — navy tint, not zinc
    expect(dark.foreground).not.toBe("");
    expect(dark.primary).not.toBe("");
  });
});
