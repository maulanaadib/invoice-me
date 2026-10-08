-- CreateEnum
CREATE TYPE "PdfJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "bankSnapshot" JSONB,
ADD COLUMN     "calculationSnapshot" JSONB,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "contactSnapshot" JSONB,
ADD COLUMN     "customerSnapshot" JSONB,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "issuerSnapshot" JSONB,
ADD COLUMN     "remainingAfter" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "replacedById" TEXT,
ADD COLUMN     "revisedFromId" TEXT,
ADD COLUMN     "signerSnapshot" JSONB,
ADD COLUMN     "templateSnapshot" JSONB;

-- CreateTable
CREATE TABLE "PdfJob" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "PdfJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdfJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePdf" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InvoicePdf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PdfJob_status_createdAt_idx" ON "PdfJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PdfJob_invoiceId_idx" ON "PdfJob"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePdf_invoiceId_idx" ON "InvoicePdf"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePdf_invoiceId_version_key" ON "InvoicePdf"("invoiceId", "version");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_revisedFromId_fkey" FOREIGN KEY ("revisedFromId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdfJob" ADD CONSTRAINT "PdfJob_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePdf" ADD CONSTRAINT "InvoicePdf_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePdf" ADD CONSTRAINT "InvoicePdf_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
