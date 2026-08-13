# syntax=docker/dockerfile:1
# Runner PWA: built to static assets, served by nginx (doc 10 §2).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
ENV CI=1
# The whole workspace is copied: pnpm --frozen-lockfile requires every project the
# lockfile knows about to be present. .dockerignore keeps the context small.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dhara/runner... run build

FROM nginx:1.27-alpine AS runtime
COPY infra/nginx/runner.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/runner/dist /usr/share/nginx/html
EXPOSE 80
