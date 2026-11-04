# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/design-tokens/package.json ./packages/design-tokens/package.json
COPY packages/web-shared/package.json ./packages/web-shared/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @sayman/admin --include=dev --include=optional --no-audit --no-fund --maxsockets=5 --fetch-retries=3 --fetch-retry-mintimeout=3000 --fetch-retry-maxtimeout=15000
COPY apps/admin/ ./apps/admin/
COPY packages/design-tokens/ ./packages/design-tokens/
COPY packages/web-shared/ ./packages/web-shared/
# Vite embeds this public origin in its browser bundle. It is the only frontend
# build setting; ADMIN_API_URL and secrets are supplied to the runtime instead.
ARG VITE_STOREFRONT_URL
ENV VITE_STOREFRONT_URL=$VITE_STOREFRONT_URL
RUN node --input-type=module -e "const value = process.env.VITE_STOREFRONT_URL; if (!value) throw new Error('Set VITE_STOREFRONT_URL to the storefront origin.'); const url = new URL(value); const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); if (!(url.protocol === 'https:' || loopback) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('VITE_STOREFRONT_URL must be an HTTPS origin or explicit HTTP loopback origin without credentials, path, query or fragment.');" \
    && npm run build:admin

FROM node:22-bookworm-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/admin/dist/ ./dist/
COPY --chown=node:node apps/admin/server.mjs ./server.mjs
COPY --chown=node:node apps/admin/public-video-proxy.mjs ./public-video-proxy.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "try { const response = await fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/', { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(4000) }); process.exit(response.status === 200 ? 0 : 1); } catch { process.exit(1); }"]
CMD ["node", "server.mjs"]
