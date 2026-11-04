# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/storefront/package.json ./apps/storefront/package.json
COPY packages/design-tokens/package.json ./packages/design-tokens/package.json
COPY packages/web-shared/package.json ./packages/web-shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @sayman/storefront --include=dev --include=optional --no-audit --no-fund --maxsockets=5 --fetch-retries=3 --fetch-retry-mintimeout=3000 --fetch-retry-maxtimeout=15000

FROM dependencies AS build
COPY apps/storefront ./apps/storefront
COPY packages/design-tokens ./packages/design-tokens
COPY packages/web-shared ./packages/web-shared
# All rendered shop data is read at request time. No API credentials, local
# environment files or running database are needed to produce this artifact.
RUN SHOP_DATA_MODE=api SHOP_ENABLE_PREVIEW=false npm run build

FROM node:22-bookworm-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    SHOP_DATA_MODE=api SHOP_ENABLE_PREVIEW=false
COPY --from=build --chown=node:node /app/apps/storefront/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=build --chown=node:node /app/apps/storefront/public ./apps/storefront/public
# Fail the image build if a changed tracing layout would omit the entry point.
RUN test -f apps/storefront/server.js && test -d apps/storefront/.next/static
USER node
EXPOSE 3000
# Application liveness only; API/database readiness is checked independently.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "try { const response = await fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/pwa/offline-fa.html', { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(4000) }); process.exit(response.status === 200 ? 0 : 1); } catch { process.exit(1); }"]
CMD ["node", "apps/storefront/server.js"]
