# syntax=docker/dockerfile:1
# Console image (Next.js standalone output). Build context is the repo root.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=1

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# The whole workspace is copied: pnpm --frozen-lockfile requires every project the
# lockfile knows about to be present. .dockerignore keeps the context small.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dhara/console... run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Standalone tracing is rooted at the workspace root, so the server keeps its repo paths.
COPY --from=build /app/apps/console/.next/standalone ./
COPY --from=build /app/apps/console/.next/static ./apps/console/.next/static
EXPOSE 3000
CMD ["node", "apps/console/server.js"]
