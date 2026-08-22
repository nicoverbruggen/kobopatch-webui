# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# Keep the two expensive, lock-pinned downloads in layers that only change when
# their inputs do. The later source copy does not overwrite their gitignored
# output directories.
COPY installables.lock ./
COPY tools/installables/ ./tools/installables/
COPY src/js/nickelmenu/features/additional-fonts/catalogue.js ./src/js/nickelmenu/features/additional-fonts/catalogue.js
RUN npm run setup:installables

COPY tools/kobopatch-wasm/setup.sh ./tools/kobopatch-wasm/setup.sh
RUN npm run setup:wasm

COPY . .

# Coolify supplies SOURCE_COMMIT when "Include Source Commit in Build" is
# enabled. It lets the generated footer link to the exact deployed revision
# even though .git is intentionally excluded from the image context.
ARG SOURCE_COMMIT=""
ARG SOURCE_TAG=""
RUN npm run build:wasm \
    && npm run build \
    && npm run validate:dist

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8888 \
    STORAGE_DIR=/app/storage

WORKDIR /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts/serve-dist.mjs /app/scripts/storage.mjs ./scripts/

RUN mkdir -p /app/storage && chown node:node /app/storage

USER node

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8888/').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "scripts/serve-dist.mjs"]
