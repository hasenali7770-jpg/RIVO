# syntax=docker/dockerfile:1.7
# RIVO API + worker image.
#
# Multi-stage: the build stage carries the full toolchain and devDependencies;
# the runtime stage ships only production dependencies and compiled JavaScript.

# ---------- deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Manifests first so the dependency layer is reused whenever only source changes.
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspaces --include-workspace-root --no-audit --no-fund

# ---------- build ----------
FROM deps AS build
WORKDIR /app
COPY packages/ packages/
COPY apps/api/ apps/api/

RUN npm run build -w @rivo/config \
 && npm run build -w @rivo/contracts \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @rivo/api

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg supplies ffprobe, used to cross-check reel resolution and to extract
# candidate cover frames. openssl is required by the Prisma query engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates dumb-init curl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspaces --include-workspace-root --omit=dev --no-audit --no-fund

COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
# The generated Prisma client lives in node_modules and must come from the build
# stage, where `prisma generate` ran against this exact schema.
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client node_modules/@prisma/client

# Runs unprivileged: a container compromise should not also be root.
RUN chown -R node:node /app
USER node

WORKDIR /app/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1

# dumb-init reaps zombies and forwards SIGTERM, so Nest's shutdown hooks run and
# in-flight jobs finish instead of being killed mid-write.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
