-- Feature 06: invoice preview & PDF
-- Official-PDF pointer on the invoice. The InvoicePdf / PdfJob tables were
-- created in the feature 05 migration (queue enqueued at issue time); this
-- adds the column the worker fills in when the file actually exists.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "pdfPath" TEXT;
