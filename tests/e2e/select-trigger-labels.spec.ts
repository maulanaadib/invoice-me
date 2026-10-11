// tests/e2e/select-trigger-labels.spec.ts
// Bug card t_5084d0fd "Check When Done": `SelectValue` printed the RAW value
// (id/cuid/enum/sentinel) in the trigger after an option was chosen, because
// Base UI only resolves a label through an `items` map that no call site
// passes. The trigger now renders the label itself (same pattern as
// create-user-dialog / org-members-dialog / project-form), so this spec proves:
//   - editor: every dropdown trigger shows the human label, never the raw
//     id/enum ("DOWN_PAYMENT", "E_METERAI", a cuid, "__custom__")
//   - the VALUE CONTRACT is unchanged: what lands in the database is still
//     the raw id/enum (the label is display-only)
//   - admin: the platform-role dialog trigger shows "User"/"Super Admin",
//     never "USER"/"SUPER_ADMIN"
//
// `./setup-env` MUST stay the first import (DATABASE_URL dari .env.local —
// fixture rows harus masuk ke database yang dibaca dev server).
//
// Requires the dev app on :3000 (playwright starts it — the compose app
// container must NOT hold the port, or the stale image would be tested).

import "./setup-env";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/server/db";
import { createProfile } from "@/modules/profiles/service";
import { createCustomer, type CustomerFormInput } from "@/modules/customers/service";
import { createBankAccount } from "@/modules/bank-accounts/service";
import { createSigner } from "@/modules/signers/service";
import type { OrganizationRole } from "@prisma/client";
import { addMembership, createOrganization, createUser, type TestUser } from "../factories";

let owner: TestUser;
let target: TestUser;
let superAdmin: TestUser;
let organizationId: string;
let profileId: string;
let customerId: string;
let bankSecondId: string;
let signerSecondId: string;

const CUSTOMER_NAME = "PT Label Trigger E2E";
const PROFILE_CODE = "LT";
const BANK_SECOND_NUMBER = "555666777888";

function ctx() {
  return {
    scope: {
      organizationId,
      role: "OWNER" as OrganizationRole,
      userId: owner.id,
    },
    request: null,
  };
}

async function login(page: Page, user: TestUser): Promise<void> {
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

test.describe("select trigger labels (card t_5084d0fd)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    owner = await createUser({ username: `e2elabel.${Date.now().toString(36)}` });
    target = await createUser({ username: `e2etarget.${Date.now().toString(36)}` });
    superAdmin = await createUser({
      username: `e2esuper.${Date.now().toString(36)}`,
      platformRole: "SUPER_ADMIN",
    });

    const org = await createOrganization("PT E2E Select Trigger Labels");
    organizationId = org.id;
    await addMembership(owner.id, org.id, "OWNER");

    const profile = await createProfile(ctx(), { name: "Label Profile", code: PROFILE_CODE });
    profileId = profile.id;

    customerId = (
      await createCustomer(
        {
          companyName: CUSTOMER_NAME,
          legalName: CUSTOMER_NAME,
          businessType: "Dagang",
          isActive: true,
        } as CustomerFormInput,
        ctx(),
      )
    ).id;

    // First bank/signer auto-claim the defaults and prefill the editor; the
    // SECOND one is what this spec selects, so the label flip is observable.
    await createBankAccount(
      { bankName: "BCA E2E Label", accountNumber: "123456789012", accountHolder: "PT E2E" },
      ctx(),
    );
    bankSecondId = (
      await createBankAccount(
        {
          bankName: "Mandiri E2E Label",
          accountNumber: BANK_SECOND_NUMBER,
          accountHolder: "PT E2E",
        },
        ctx(),
      )
    ).id;

    await createSigner({ name: "Penanda Pertama", title: "Direktur" }, ctx());
    signerSecondId = (await createSigner({ name: "Penanda Kedua", title: "Finance" }, ctx())).id;
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.invoiceItem.deleteMany({ where: { invoice: { organizationId } } });
    await db.invoice.deleteMany({ where: { organizationId } });
    await db.invoiceSequence.deleteMany({
      where: { invoiceProfile: { organizationId } },
    });
    await db.invoiceProfile.deleteMany({ where: { organizationId } });
    await db.signer.deleteMany({ where: { organizationId } });
    await db.bankAccount.deleteMany({ where: { organizationId } });
    await db.customer.deleteMany({ where: { organizationId } });
    await db.membership.deleteMany({ where: { organizationId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, target.id, superAdmin.id] } } });
  });

  // The editor autosaves (debounced ~1s) and, on the FIRST successful save,
  // runs router.replace("/invoices/{id}/edit") — which remounts the editor.
  // A remount tears down any Base UI popup and re-resolves the duplicate-id
  // form copies, so a second popup click in the same page session is flaky.
  // Each select is therefore driven from a FRESH /invoices/new load: the
  // selection persists, then the assert reads the SAME live trigger.
  const desktopForm = (page: Page) => page.locator("div.hidden.lg\\:flex");

  async function openEditor(page: Page) {
    await page.goto("/invoices/new");
    await expect(
      page.getByRole("heading", { level: 1, name: "Invoice baru" }).first(),
    ).toBeVisible({ timeout: 30_000 });
  }

  /** Click a desktop-panel trigger, pick an option, assert the label it now shows. */
  async function selectAndExpectLabel(
    page: Page,
    triggerSelector: string,
    optionName: string | RegExp,
    expectedLabel: string,
    notExpected?: string,
  ) {
    const trigger = desktopForm(page).locator(triggerSelector).first();
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // SelectContent is portalled to the body, so the option can only be found
    // page-wide; at most one popup is open at a time.
    await page.getByRole("option", { name: optionName }).click();
    await expect(trigger).toContainText(expectedLabel);
    if (notExpected !== undefined) {
      await expect(trigger).not.toContainText(notExpected);
    }
  }

  test("editor: trigger menampilkan label, nilai tersimpan tetap id/enum asli", async ({ page }) => {
    await login(page, owner);

    // ── Jenis invoice: label, not the enum ─────────────────────────────────
    await openEditor(page);
    await selectAndExpectLabel(
      page,
      "#invoice-type",
      "Down Payment (DP)",
      "Down Payment (DP)",
      "DOWN_PAYMENT",
    );
    // "Dasar tagihan" only renders for DP/TERM; its default is a label too.
    await expect(desktopForm(page).locator("#billing-mode").first()).toContainText("Persentase");

    // ── Profil: "Nama (KODE)", never the profile id ────────────────────────
    await openEditor(page);
    await selectAndExpectLabel(
      page,
      "#invoice-profile",
      `Label Profile (${PROFILE_CODE})`,
      `Label Profile (${PROFILE_CODE})`,
      profileId,
    );

    // ── Customer: company name, never the cuid ─────────────────────────────
    await openEditor(page);
    await selectAndExpectLabel(page, "#invoice-customer", CUSTOMER_NAME, CUSTOMER_NAME, customerId);

    // ── Rekening: "Bank — **** **** 7888 (holder)", never the id ───────────
    await openEditor(page);
    await selectAndExpectLabel(
      page,
      "#bank-account",
      /Mandiri E2E Label/,
      "Mandiri E2E Label — **** **** 7888 (PT E2E)",
      bankSecondId,
    );

    // ── Penanda tangan: "Nama — jabatan", never the id ─────────────────────
    await openEditor(page);
    await selectAndExpectLabel(
      page,
      "#signer",
      /Penanda Kedua/,
      "Penanda Kedua — Finance",
      signerSecondId,
    );

    // ── Meterai: label, not E_METERAI ──────────────────────────────────────
    await openEditor(page);
    await selectAndExpectLabel(page, "#stamp-mode", "E-Meterai", "E-Meterai", "E_METERAI");

    // ── Unit: "Unit khusus...", never the "__custom__" sentinel ────────────
    // The accessible name normalizes the trailing "..." (whitespace collapsed),
    // so match the option on its stable prefix but assert the full label.
    // This page also picks profile + customer (canAutosave needs both) and the
    // same bank/signer/stamp the DB asserts below — it is the saved draft.
    await openEditor(page);
    await selectAndExpectLabel(page, "#invoice-type", "Down Payment (DP)", "Down Payment (DP)");
    await selectAndExpectLabel(
      page,
      "#invoice-profile",
      `Label Profile (${PROFILE_CODE})`,
      `Label Profile (${PROFILE_CODE})`,
    );
    await selectAndExpectLabel(page, "#invoice-customer", CUSTOMER_NAME, CUSTOMER_NAME);
    await selectAndExpectLabel(
      page,
      "#bank-account",
      /Mandiri E2E Label/,
      "Mandiri E2E Label — **** **** 7888 (PT E2E)",
    );
    await selectAndExpectLabel(page, "#signer", /Penanda Kedua/, "Penanda Kedua — Finance");
    await selectAndExpectLabel(page, "#stamp-mode", "E-Meterai", "E-Meterai");
    await selectAndExpectLabel(
      page,
      '[aria-label="Unit item 1"][id^="item-unit-"]',
      /^Unit khusus/,
      "Unit khusus...",
      "__custom__",
    );
    await page.getByLabel("Nama unit khusus").first().fill("m2");

    // Enum defaults already render as labels on first paint, not raw enums.
    // (billing-mode is asserted with the DP selection above — it only renders
    // for DOWN_PAYMENT/TERM.)
    await expect(desktopForm(page).locator("#reference-type").first()).toContainText(
      "Purchase Order (PO)",
    );
    await expect(desktopForm(page).locator("#tax-mode").first()).toContainText("Tanpa pajak");
    // The customer has no PIC → the trigger says so, honestly.
    await expect(desktopForm(page).locator("#invoice-contact").first()).toContainText(
      "Customer ini belum punya PIC",
    );

    await desktopForm(page).locator("#billing-percent").first().fill("50");
    await desktopForm(page).locator("#invoice-date").first().fill("2026-07-31");
    await desktopForm(page).locator("#due-date").first().fill("2026-08-31");
    await page.getByLabel("Deskripsi item 1").first().fill("Pemasangan bracket frame");
    await page.getByLabel("Qty item 1").first().fill("5");
    await page.getByPlaceholder("Harga/satuan").first().fill("900000");

    await page.getByRole("button", { name: /^Simpan (draft|perubahan)$/ }).first().click();
    // The first save also runs router.replace → /invoices/{id}/edit, so wait
    // for the draft to exist server-side rather than for a specific DOM node.
    await expect
      .poll(() => db.invoice.count({ where: { organizationId, status: "DRAFT" } }), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect(page.getByTestId("autosave-indicator").first()).toContainText("Tersimpan", {
      timeout: 30_000,
    });

    // The label is display-only: the row still carries the raw ids/enums.
    const draft = await db.invoice.findFirst({
      where: { organizationId, status: "DRAFT" },
      include: { items: true },
    });
    expect(draft).not.toBeNull();
    expect(draft!.invoiceType).toBe("DOWN_PAYMENT");
    expect(draft!.stampMode).toBe("E_METERAI");
    expect(draft!.profileId).toBe(profileId);
    expect(draft!.customerId).toBe(customerId);
    expect(draft!.bankAccountId).toBe(bankSecondId);
    expect(draft!.signerId).toBe(signerSecondId);
    expect(draft!.items[0]?.unit).toBe("m2");
  });

  test("dialog platform role: trigger menampilkan label peran", async ({ page }) => {
    await login(page, superAdmin);
    await page.goto(`/admin/users/${target.id}`);

    // The select lives inside the dialog; the pending role is SUPER_ADMIN for
    // a USER row, and the trigger already shows the label — never "SUPER_ADMIN".
    await page.getByRole("button", { name: "Naikkan ke Super Admin" }).click();
    const trigger = page.locator(`#role-${target.id}`);
    await expect(trigger).toContainText("Super Admin");
    await expect(trigger).not.toContainText("SUPER_ADMIN");

    // Choosing the other option flips the LABEL only; the value stays "USER".
    await trigger.click();
    await page.getByRole("option", { name: /User — pengguna biasa/ }).click();
    await expect(trigger).toContainText("User");
    await expect(trigger).not.toContainText("USER —");

    // Close without submitting — this spec asserts labels, not role changes.
    await page.getByRole("button", { name: "Batal" }).click();
    const row = await db.user.findUnique({ where: { id: target.id } });
    expect(row?.platformRole).toBe("USER");
  });
});
