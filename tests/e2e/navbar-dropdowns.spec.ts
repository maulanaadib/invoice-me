// tests/e2e/navbar-dropdowns.spec.ts
// Regression guard for the Base UI "MenuGroupContext is missing" crash (#31).
//
// The topbar dropdowns (workspace switcher + user menu) put a
// DropdownMenuLabel directly inside DropdownMenuContent. Base UI's
// Menu.GroupLabel requires a Menu.Group ancestor; without it, opening the
// dropdown THREW on the client and React unmounted the entire header —
// the navbar (logo, workspace switcher, theme toggle, user menu) vanished
// and every topbar action became unreachable in the browser.
//
// This spec exercises both dropdowns end-to-end: they must open, render
// their labels/items, keep the header mounted, and navigate through the
// menu to /change-password.

import "./setup-env";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/server/db";
import {
  addMembership,
  createOrganization,
  createUser,
  type TestUser,
} from "../factories";

let user: TestUser;
let organizationId: string;

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username atau email").fill(user.username);
  await page.getByLabel("Kata sandi").fill(user.password);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/sign-in/") &&
        response.request().method() === "POST" &&
        response.ok(),
    ),
    page.getByRole("button", { name: "Masuk", exact: true }).click(),
  ]);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

test.describe("navbar dropdowns (Base UI group-context regression)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    user = await createUser({ username: `e2enav.${Date.now().toString(36)}` });
    const org = await createOrganization("PT E2E Navbar Dropdown");
    organizationId = org.id;
    await addMembership(user.id, org.id, "OWNER");
  });

  test.afterAll(async () => {
    await db.membership.deleteMany({ where: { organizationId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.user.deleteMany({ where: { id: user.id } });
  });

  test("workspace switcher dan user menu terbuka tanpa menghancurkan header", async ({ page }) => {
    // A client-side throw in either dropdown unmounts the header; capture it.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await login(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const headerButtons = page.locator("header button");
    await expect(headerButtons).toHaveCount(5);

    // Workspace switcher. All assertions are scoped to the open menu: the
    // dashboard body also contains phrases like "workspace aktif".
    const workspaceMenu = page.getByRole("menu", { name: "Pilih workspace" });
    await page.locator('header button[aria-label="Pilih workspace"]').click();
    // Strict mode: the org name also renders in the trigger button.
    await expect(workspaceMenu.getByText("Workspace aktif")).toBeVisible();
    await expect(workspaceMenu.getByText("PT E2E Navbar Dropdown")).toBeVisible();
    // The header (logo, theme toggle, user menu) must survive opening the menu.
    await expect(headerButtons).toHaveCount(5);
    await page.keyboard.press("Escape");
    await expect(workspaceMenu).toBeHidden();

    // User menu
    await page.locator('header button[aria-label="Menu akun"]').click();
    await expect(page.getByText("Ubah kata sandi")).toBeVisible();
    await expect(headerButtons).toHaveCount(5);

    // Navigation through the menu (guardedPush) reaches the target page.
    await page.getByText("Ubah kata sandi").click();
    await page.waitForURL(/\/change-password/, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/change-password/);
    // /change-password is an (auth) route: a centered form, no app shell. The
    // point of this assertion is that we navigated at all — no error boundary.
    await expect(page.getByRole("button", { name: /Simpan|Ubah|Kirim/i })).toBeVisible();

    expect(errors, "no client-side error may escape the navbar dropdowns").toEqual([]);
  });
});
