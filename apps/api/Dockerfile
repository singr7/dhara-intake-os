# syntax=docker/dockerfile:1
# API image. Build context is the repo root (workspace deps must be visible).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=1

FROM base AS build
# argon2 is a native addon (ADR-012 wants a real password hash, not a JS approximation), so
# the build stage needs a toolchain. It stays out of the runtime image.
RUN apk add --no-cache python3 make g++
# The whole workspace is copied: pnpm --frozen-lockfile requires every project the
# lockfile knows about to be present. .dockerignore keeps the context small.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dhara/api... run build

FROM base AS runtime
ENV NODE_ENV=production
# Prisma's query engine is a native binary; the musl target is generated alongside the
# host's by the `binaryTargets` in schema.prisma.
RUN apk add --no-cache openssl
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# Boot crashes here if the environment is incomplete — by design (doc 04 §3).
CMD ["node", "dist/index.js"]
