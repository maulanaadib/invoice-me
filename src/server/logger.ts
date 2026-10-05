import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "token",
      "secret",
      "BETTER_AUTH_SECRET",
      "INTERNAL_PDF_SECRET",
      "BANK_ACCOUNT_ENCRYPTION_KEY",
      "accountNumber",
      "accountNumberEncrypted",
      "npwp",
      "taxId",
      "*.password",
      "*.token",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
