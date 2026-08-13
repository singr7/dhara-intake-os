# syntax=docker/dockerfile:1
# Worker image. Build context is the repo root.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=1

FROM base AS build
# The whole workspace is copied: pnpm --frozen-lockfile requires every project the
# lockfile knows about to be present. .dockerignore keeps the context small.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dhara/worker... run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
