# ─── libssl provider ──────────────────────────────────────────────────────────
# Prisma query engine needs libssl/libcrypto 3 which bookworm-slim omits.
# Build env has no apt access, so copy the shared libs from the full image.
FROM node:22-bookworm AS libs

# ─── Production runner ────────────────────────────────────────────────────────
# Uses the pre-built Next.js standalone output (.next/standalone) from the host.
# Run `npm run build` on the host before building this image.
# No npm registry or apt access required at build time.
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=libs /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3
COPY --from=libs /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && mkdir -p /data/uploads /data/invoices \
 && chown -R nextjs:nodejs /data

COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
COPY prisma ./prisma
COPY scripts ./scripts

RUN chmod +x /app/scripts/healthcheck.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
