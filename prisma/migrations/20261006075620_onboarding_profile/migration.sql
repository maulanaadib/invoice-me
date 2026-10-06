-- CreateEnum
CREATE TYPE "SequenceResetPolicy" AS ENUM ('MONTHLY', 'YEARLY', 'NEVER');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('NONE', 'INCLUSIVE', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "StampMode" AS ENUM ('NONE', 'E_METERAI', 'PHYSICAL', 'BLANK_SPACE');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "InvoiceProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT,
    "logoPath" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
    "address" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "website" TEXT,
    "taxId" TEXT,
    "defaultBankAccountId" TEXT,
    "defaultSignerId" TEXT,
    "numberPattern" TEXT NOT NULL DEFAULT 'INV/{CODE}/{ROMAN_MONTH}/{YYYY}/{SEQ:3}',
    "sequenceResetPolicy" "SequenceResetPolicy" NOT NULL DEFAULT 'YEARLY',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'IDR',
    "defaultTaxMode" "TaxMode" NOT NULL DEFAULT 'NONE',
    "defaultTaxPercent" DECIMAL(5,2),
    "defaultStampMode" "StampMode" NOT NULL DEFAULT 'NONE',
    "defaultNotes" TEXT,
    "templateKey" TEXT NOT NULL DEFAULT 'corporate-blue',
    "settings" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT,
    "accountNumberEncrypted" TEXT NOT NULL,
    "accountNumberLast4" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "branch" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "location" TEXT,
    "signatureImagePath" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "id" TEXT NOT NULL,
    "invoiceProfileId" TEXT NOT NULL,
    "sequenceKey" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceProfile_organizationId_code_key" ON "InvoiceProfile"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSequence_invoiceProfileId_sequenceKey_key" ON "InvoiceSequence"("invoiceProfileId", "sequenceKey");

-- AddForeignKey
ALTER TABLE "InvoiceProfile" ADD CONSTRAINT "InvoiceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceProfile" ADD CONSTRAINT "InvoiceProfile_defaultBankAccountId_fkey" FOREIGN KEY ("defaultBankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceProfile" ADD CONSTRAINT "InvoiceProfile_defaultSignerId_fkey" FOREIGN KEY ("defaultSignerId") REFERENCES "Signer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "InvoiceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signer" ADD CONSTRAINT "Signer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_invoiceProfileId_fkey" FOREIGN KEY ("invoiceProfileId") REFERENCES "InvoiceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
