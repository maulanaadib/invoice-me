This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Rotating the bank account encryption key

Bank account numbers are encrypted at rest (AES-256-GCM) with a key derived
from `BANK_ACCOUNT_ENCRYPTION_KEY` (SHA-256 of the secret, stored value format
`iv:tag:ciphertext`). To rotate the key — for example after a secret leak or a
scheduled rotation in Coolify:

```bash
# 1. Pick a new secret (≥ 32 characters) and re-encrypt every stored number:
NEW_BANK_ACCOUNT_ENCRYPTION_KEY="<new-secret-with-at-least-32-chars>" \
  scripts/rotate-bank-key.sh

# 2. Put the new secret in your environment as BANK_ACCOUNT_ENCRYPTION_KEY
#    (Coolify dashboard in production, .env.local in development) and restart
#    the app.
```

The script reads `DATABASE_URL` and the current key from the app's env files
(`.env` / `.env.local`); set `OLD_BANK_ACCOUNT_ENCRYPTION_KEY` explicitly if
your old key is not in those files. It decrypts each row with the old key,
re-encrypts with the new key, verifies the round-trip **before** writing, and
never prints a plaintext number or a key. Rows already on the new key are
skipped, so the script is safe to re-run. This is a maintenance script — the
app itself has no UI for rotation.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
