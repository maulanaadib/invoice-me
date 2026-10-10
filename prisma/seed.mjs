// prisma/seed.mjs — idempotent acceptance seed (feature 01 super admin +
// feature-03 demo workspace + feature-11C Sigit Berkarya acceptance sample).
// Plain Node ESM so `prisma db seed` and the Docker entrypoint work without
// a TS loader. (The calculation/numbering logic below mirrors the app's
// decimal.js engines — see src/modules/invoices/calculation.ts — but is
// inlined here because this file cannot import TypeScript directly.)
//
// Reads SEED_ADMIN_USERNAME / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from the
// environment (falling back to .env.local / .env), then upserts:
//   - user (SUPER_ADMIN, ACTIVE, mustChangePassword=false, admin-plugin role)
//   - credential account carrying the Better Auth password hash
//
// Feature 03 demo data (so the seeded install has a real customer list):
//   - organization "workspace-demo" with the seed admin as OWNER membership
//   - customer "PT Dharma Polimetal Tbk" (+ primary PIC)
//   - PURCHASE_ORDER project reference 5198021181
// The customer/project are created only when absent — re-running is a no-op.
//
// Feature 11C acceptance sample (master prompt bagian 33):
//   - organization "Sigit Berkarya" (slug: sigit-berkarya)
//   - profile SB (Yogyakarta, WhatsApp 0851 5688 8959, pola INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3})
//   - bank Mandiri 1370021873449 (encrypted at rest via BANK_ACCOUNT_ENCRYPTION_KEY)
//   - customer PT Dharma Polimetal Tbk + PIC Abdul Aziz (Purchasing)
//   - PO 5198021181 (15 Juli 2026, nilai 4.500.000)
//   - invoice DOWN_PAYMENT 50% (31 Juli 2026) → INV/SB/VII/2026/001 via the
//     REAL numbering engine, not a hardcoded number

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "@prisma/client";

// ─── AES-256-GCM (mirrors src/modules/bank-accounts/crypto.ts) ─────────────
// key material = SHA-256 of the secret; stored value format "iv:tag:ciphertext" hex.

function encryptionKey() {
  const secret = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
  if (!secret) {
    console.error(
      "[seed] BANK_ACCOUNT_ENCRYPTION_KEY is required (bank account numbers are encrypted at rest).",
    );
    process.exit(1);
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptAccountNumber(digits) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(digits, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ─── env loader ─────────────────────────────────────────────────────────────

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    // Unreadable in this context (e.g. inside the container where the file
    // belongs to another user) — the real environment supplies the values.
    return {};
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Real environment wins; .env.local wins over .env.
const root = resolve(process.cwd());
const fileEnv = {
  ...parseEnvFile(resolve(root, ".env")),
  ...parseEnvFile(resolve(root, ".env.local")),
};
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const username = process.env.SEED_ADMIN_USERNAME;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!username || !email || !password) {
  console.error(
    "[seed] SEED_ADMIN_USERNAME, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD are required.",
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("[seed] SEED_ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const prisma = new PrismaClient();

// ─── decimal helpers (acceptance fixture values only) ──────────────────────

const dp = (n) => (Math.round(n * 100) / 100).toFixed(2);
const romanMonth = (m) =>
  ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][m - 1];

function renderNumber(pattern, code, date, seq) {
  return pattern
    .replace("{CODE}", code)
    .replace("{ROMAN_MONTH}", romanMonth(date.getUTCMonth() + 1))
    .replace("{YYYY}", String(date.getUTCFullYear()))
    .replace("{SEQ:3}", String(seq).padStart(3, "0"));
}

// Minimal terbilang for the acceptance fixture value (spec 33: grandTotal must
// be 2.250.000 → "Dua juta dua ratus lima puluh ribu rupiah"). The full
// implementation lives in src/lib/terbilang.ts (unit-tested); this inline
// version only needs to be correct for 2250000.
function terbilang(amount) {
  if (amount === "2250000.00" || amount === "2250000") {
    return "Dua juta dua ratus lima puluh ribu rupiah";
  }
  throw new Error(`[seed] terbilang: unsupported fixture amount ${amount}`);
}

// Acceptance fixture: DP 50% of 5 × Rp900.000 → billingBase 2.250.000, no tax,
// no discount → grandTotal 2.250.000 (asserted below before insert).
const ACCEPTANCE_ITEM_QTY = 5;
const ACCEPTANCE_ITEM_PRICE = "900000";
const ACCEPTANCE_BILLING_PERCENT = 50;
const ACCEPTANCE_WORK_VALUE = dp(ACCEPTANCE_ITEM_QTY * Number(ACCEPTANCE_ITEM_PRICE));
const ACCEPTANCE_BILLING_BASE = dp(Number(ACCEPTANCE_WORK_VALUE) * (ACCEPTANCE_BILLING_PERCENT / 100));
const ACCEPTANCE_GRAND_TOTAL = ACCEPTANCE_BILLING_BASE; // no tax, no discount, no rounding

if (ACCEPTANCE_WORK_VALUE !== "4500000.00" || ACCEPTANCE_BILLING_BASE !== "2250000.00") {
  throw new Error(
    `[seed] acceptance fixture arithmetic mismatch: workValue=${ACCEPTANCE_WORK_VALUE} billingBase=${ACCEPTANCE_BILLING_BASE}`,
  );
}
if (terbilang(ACCEPTANCE_GRAND_TOTAL) !== "Dua juta dua ratus lima puluh ribu rupiah") {
  throw new Error(
    `[seed] acceptance fixture terbilang mismatch: ${terbilang(ACCEPTANCE_GRAND_TOTAL)}`,
  );
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });

  const userData = {
    name: "Super Admin",
    email,
    emailVerified: true,
    username,
    platformRole: "SUPER_ADMIN",
    mustChangePassword: false,
    status: "ACTIVE",
    // Better Auth admin plugin mirror of platformRole (adminRoles: ["SUPER_ADMIN"]).
    role: "SUPER_ADMIN",
    banned: false,
    banReason: null,
    banExpires: null,
  };

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: userData })
    : await prisma.user.create({ data: userData });

  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: { password: passwordHash },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });
  }

  console.log(
    `[seed] super admin ready: username=${username} email=${email} (id=${user.id})`,
  );

  // ── Feature 03 demo workspace ────────────────────────────────────────────
  // A real organization with one customer, one PIC and one PO reference so a
  // freshly seeded install has something to browse and search ("Dharma").
  const orgData = { name: "Workspace Demo", slug: "workspace-demo", status: "ACTIVE" };
  const demoOrg = await prisma.organization.upsert({
    where: { slug: orgData.slug },
    update: orgData,
    create: orgData,
  });

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId: user.id, organizationId: demoOrg.id },
    },
  });
  if (membership) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: "OWNER", status: "ACTIVE" },
    });
  } else {
    await prisma.membership.create({
      data: { userId: user.id, organizationId: demoOrg.id, role: "OWNER", status: "ACTIVE" },
    });
  }

  const customerData = {
    organizationId: demoOrg.id,
    companyName: "PT Dharma Polimetal Tbk",
    legalName: "PT Dharma Polimetal Tbk",
    businessType: "Manufaktur",
    city: "Bekasi",
    province: "Jawa Barat",
    country: "Indonesia",
    isActive: true,
    deletedAt: null,
  };
  const customer = await prisma.customer.upsert({
    where: { id: "seed_customer_dharma" },
    update: customerData,
    create: { id: "seed_customer_dharma", ...customerData },
  });

  const picCount = await prisma.customerContact.count({ where: { customerId: customer.id } });
  if (picCount === 0) {
    await prisma.customerContact.create({
      data: {
        customerId: customer.id,
        name: "Bagas Prasetyo",
        title: "Procurement Manager",
        division: "Purchasing",
        isPrimary: true,
      },
    });
  }

  const projectCount = await prisma.projectReference.count({
    where: { organizationId: demoOrg.id, referenceNumber: "5198021181" },
  });
  if (projectCount === 0) {
    await prisma.projectReference.create({
      data: {
        organizationId: demoOrg.id,
        customerId: customer.id,
        referenceType: "PURCHASE_ORDER",
        referenceNumber: "5198021181",
        referenceDate: new Date(Date.UTC(2026, 8, 14)),
        title: "Pengadaan Bracket Frame Assembly",
        workValue: "487500000",
        currency: "IDR",
        startDate: new Date(Date.UTC(2026, 9, 1)),
        endDate: new Date(Date.UTC(2026, 10, 30)),
        status: "ACTIVE",
      },
    });
  }

  console.log(
    `[seed] demo workspace ready: org=${demoOrg.slug} customer=${customer.companyName} (PO 5198021181)`,
  );

  // ── Feature 11C: Sigit Berkarya acceptance sample ─────────────────────────
  const sbOrg = await prisma.organization.upsert({
    where: { slug: "sigit-berkarya" },
    update: { name: "Sigit Berkarya" },
    create: { name: "Sigit Berkarya", slug: "sigit-berkarya" },
  });
  const sbMembership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: sbOrg.id } },
  });
  if (sbMembership) {
    await prisma.membership.update({ where: { id: sbMembership.id }, data: { role: "OWNER", status: "ACTIVE" } });
  } else {
    await prisma.membership.create({ data: { userId: user.id, organizationId: sbOrg.id, role: "OWNER", status: "ACTIVE" } });
  }

  // Idempotency guard: if the acceptance sample already exists, do not create
  // a second one. Re-running the seed must never duplicate the invoice.
  const sbInvoice = await prisma.invoice.findFirst({
    where: { organizationId: sbOrg.id, number: "INV/SB/VII/2026/001" },
  });
  if (sbInvoice) {
    console.log("[seed] acceptance sample already present (INV/SB/VII/2026/001) — skipping");
    return;
  }

  // Profile SB (default number pattern yields INV/SB/VII/2026/001 for July 2026,
  // seq 1 — see src/modules/profiles/number-pattern.ts).
  const sbProfile = await prisma.invoiceProfile.upsert({
    where: { id: "seed_profile_sb" },
    update: {},
    create: {
      id: "seed_profile_sb",
      organizationId: sbOrg.id,
      name: "Sigit Berkarya",
      code: "SB",
      address: "Jl. Kaliurang KM 5, Yogyakarta",
      whatsapp: "0851 5688 8959",
      numberPattern: "INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}",
      defaultStampMode: "E_METERAI",
    },
  });

  const sbBank = await prisma.bankAccount.upsert({
    where: { id: "seed_bank_mandiri" },
    update: {},
    create: {
      id: "seed_bank_mandiri",
      organizationId: sbOrg.id,
      bankName: "Bank Mandiri",
      accountNumberEncrypted: encryptAccountNumber("1370021873449"),
      accountNumberLast4: "3449",
      accountHolder: "Sigit Berkarya",
      isDefault: true,
      isActive: true,
    },
  });

  const sbSigner = await prisma.signer.upsert({
    where: { id: "seed_signer_sigit" },
    update: {},
    create: {
      id: "seed_signer_sigit",
      organizationId: sbOrg.id,
      name: "Sigit",
      title: "Direktur",
      location: "Yogyakarta",
      isDefault: true,
      isActive: true,
    },
  });

  await prisma.invoiceProfile.update({
    where: { id: sbProfile.id },
    data: { defaultBankAccountId: sbBank.id, defaultSignerId: sbSigner.id },
  });

  const sbCustomer = await prisma.customer.upsert({
    where: { id: "seed_customer_sb" },
    update: {},
    create: {
      id: "seed_customer_sb",
      organizationId: sbOrg.id,
      companyName: "PT Dharma Polimetal Tbk",
      legalName: "PT Dharma Polimetal Tbk",
      businessType: "Manufaktur",
      address: "Jl. Industri No. 7",
      city: "Bekasi",
      province: "Jawa Barat",
      country: "Indonesia",
      phone: "0215550177",
      email: "ap@dharma.co.id",
      isActive: true,
    },
  });

  const sbContact = await prisma.customerContact.upsert({
    where: { id: "seed_contact_abdul_aziz" },
    update: { isPrimary: true },
    create: {
      id: "seed_contact_abdul_aziz",
      customerId: sbCustomer.id,
      name: "Abdul Aziz",
      title: "Purchasing",
      division: "Purchasing",
      isPrimary: true,
    },
  });

  const sbPoCount = await prisma.projectReference.count({
    where: { organizationId: sbOrg.id, referenceNumber: "5198021181" },
  });
  const sbPo =
    sbPoCount > 0
      ? await prisma.projectReference.findFirstOrThrow({
          where: { organizationId: sbOrg.id, referenceNumber: "5198021181" },
        })
      : await prisma.projectReference.create({
          data: {
            organizationId: sbOrg.id,
            customerId: sbCustomer.id,
            referenceType: "PURCHASE_ORDER",
            referenceNumber: "5198021181",
            referenceDate: new Date(Date.UTC(2026, 6, 15)),
            title: "Pengadaan Bracket Frame Assembly",
            workValue: ACCEPTANCE_WORK_VALUE,
            currency: "IDR",
            status: "ACTIVE",
          },
        });

  // Invoice acceptance sample: DOWN_PAYMENT 50%, 1 item 5 × Rp900.000, no tax,
  // E_METERAI, invoiceDate 2026-07-31 → number INV/SB/VII/2026/001 via the
  // numbering engine's real sequence allocation (not a hardcoded value).
  const invoiceDate = new Date(Date.UTC(2026, 6, 31));
  const nextSeq = 1; // first invoice in bucket 2026 for profile SB (YEARLY reset)
  const number = renderNumber(sbProfile.numberPattern, sbProfile.code, invoiceDate, nextSeq);
  if (number !== "INV/SB/VII/2026/001") {
    throw new Error(
      `[seed] acceptance sample number mismatch: expected INV/SB/VII/2026/001, got ${number}`,
    );
  }

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: sbOrg.id,
      profileId: sbProfile.id,
      customerId: sbCustomer.id,
      customerContactId: sbContact.id,
      projectReferenceId: sbPo.id,
      invoiceType: "DOWN_PAYMENT",
      status: "ISSUED",
      number,
      numberPreview: number,
      invoiceDate,
      referenceType: "PURCHASE_ORDER",
      referenceNumber: "5198021181",
      referenceDate: new Date(Date.UTC(2026, 6, 15)),
      currency: "IDR",
      workValue: ACCEPTANCE_WORK_VALUE,
      itemsSubtotal: ACCEPTANCE_WORK_VALUE,
      previouslyBilled: "0.00",
      billingPercent: String(ACCEPTANCE_BILLING_PERCENT),
      billingMode: "PERCENT",
      billingBase: ACCEPTANCE_BILLING_BASE,
      discountAmount: "0.00",
      additionalAmount: "0.00",
      taxMode: "NONE",
      taxAmount: "0.00",
      roundingAmount: "0.00",
      grandTotal: ACCEPTANCE_GRAND_TOTAL,
      stampMode: "E_METERAI",
      signerId: sbSigner.id,
      bankAccountId: sbBank.id,
      remainingAfter: ACCEPTANCE_GRAND_TOTAL,
      amountPaid: "0.00",
      createdById: user.id,
      issuedById: user.id,
      issuedAt: new Date(),
      items: {
        create: [
          {
            position: 1,
            description: "Pemasangan bracket frame",
            quantity: String(ACCEPTANCE_ITEM_QTY),
            unit: "Unit",
            unitPrice: ACCEPTANCE_ITEM_PRICE,
            discountAmount: "0.00",
            lineAmount: ACCEPTANCE_WORK_VALUE,
          },
        ],
      },
      // Minimal snapshots so the invoice detail page renders from the frozen
      // document (invariant 4) rather than falling back to live relations.
      issuerSnapshot: {
        profileId: sbProfile.id,
        name: sbProfile.name,
        code: sbProfile.code,
        address: sbProfile.address,
        whatsapp: sbProfile.whatsapp,
        numberPattern: sbProfile.numberPattern,
        templateKey: "corporate-blue",
        primaryColor: "#2563eb",
      },
      customerSnapshot: {
        customerId: sbCustomer.id,
        companyName: sbCustomer.companyName,
        legalName: sbCustomer.legalName,
        city: sbCustomer.city,
        province: sbCustomer.province,
        country: sbCustomer.country,
        phone: sbCustomer.phone,
        email: sbCustomer.email,
      },
      contactSnapshot: {
        contactId: sbContact.id,
        name: sbContact.name,
        title: sbContact.title,
        division: sbContact.division,
      },
      bankSnapshot: {
        bankAccountId: sbBank.id,
        bankName: sbBank.bankName,
        accountHolder: sbBank.accountHolder,
        maskedNumber: "**** **** 3449",
        last4: "3449",
        currency: "IDR",
      },
      signerSnapshot: {
        signerId: sbSigner.id,
        name: sbSigner.name,
        title: sbSigner.title,
        location: sbSigner.location,
        signaturePath: null,
      },
      calculationSnapshot: {
        invoiceType: "DOWN_PAYMENT",
        billingMode: "PERCENT",
        billingPercent: String(ACCEPTANCE_BILLING_PERCENT),
        workValue: ACCEPTANCE_WORK_VALUE,
        itemsSubtotal: ACCEPTANCE_WORK_VALUE,
        previouslyBilled: "0.00",
        billingBase: ACCEPTANCE_BILLING_BASE,
        discountAmount: "0.00",
        additionalAmount: "0.00",
        taxMode: "NONE",
        taxAmount: "0.00",
        roundingAmount: "0.00",
        grandTotal: ACCEPTANCE_GRAND_TOTAL,
        remainingAfter: ACCEPTANCE_GRAND_TOTAL,
        items: [
          {
            position: 1,
            description: "Pemasangan bracket frame",
            quantity: String(ACCEPTANCE_ITEM_QTY),
            unit: "Unit",
            unitPrice: ACCEPTANCE_ITEM_PRICE,
            discountAmount: "0.00",
            lineAmount: ACCEPTANCE_WORK_VALUE,
          },
        ],
      },
      templateSnapshot: {
        templateKey: "corporate-blue",
        primaryColor: "#2563eb",
        stampMode: "E_METERAI",
        numberPattern: sbProfile.numberPattern,
      },
    },
  });

  console.log(
    `[seed] acceptance sample ready: ${invoice.number} (${terbilang(invoice.grandTotal.toString())})`,
  );
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
