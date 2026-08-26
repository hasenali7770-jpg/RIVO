# syntax=docker/dockerfile:1.7
# RIVO admin dashboard.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY apps/admin/package.json apps/admin/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspaces --include-workspace-root --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY packages/ packages/
COPY apps/admin/ apps/admin/
# NEXT_PUBLIC_* values are inlined at build time, so the API URL must be supplied
# here rather than at container start.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm run build -w @rivo/config \
 && npm run build -w @rivo/contracts \
 && npm run build -w @rivo/admin

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3002
RUN apt-get update && apt-get install -y --no-install-recommends curl dumb-init \
 && rm -rf /var/lib/apt/lists/*

# Next's standalone output bundles only the modules actually reached, so the
# runtime image needs no npm install of its own.
COPY --from=build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=node:node /app/apps/admin/public ./apps/admin/public

USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3002/login || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/admin/server.js"]
