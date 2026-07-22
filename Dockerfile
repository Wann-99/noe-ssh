# bookworm-slim (glibc): better-sqlite3 can compile / use prebuilds without
# Alpine's unofficial-builds.nodejs.org header download (often times out in CN).
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build

WORKDIR /app

ARG NPM_REGISTRY=
ARG USE_CN_MIRROR=0

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY client/package.json client/package-lock.json* ./client/

RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --omit=dev --ignore-scripts \
 && npm --prefix client ci

COPY shared ./shared
COPY client ./client
COPY src ./src

RUN npm --prefix client run build

ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

WORKDIR /app

ARG NPM_REGISTRY=
ARG USE_CN_MIRROR=0

# Build tools for native module compile; keep wget/xauth for healthcheck + X11.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 make g++ wget ca-certificates xauth \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# npm 10+ removed `npm config set disturl`; pass mirror via env for node-gyp.
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --omit=dev --ignore-scripts \
 && if [ "$USE_CN_MIRROR" = "1" ]; then \
      export npm_config_disturl=https://npmmirror.com/mirrors/node; \
      export NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node; \
    fi \
 && npm rebuild better-sqlite3 \
 && apt-get purge -y python3 make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*

COPY src ./src
COPY shared ./shared
COPY --from=build /app/dist/client ./dist/client

ENV NODE_ENV=production
ENV PORT=3000
ENV NOE_SSH_DATA_DIR=/data
# Prefer NOE_SSH_ADMIN_PASSWORD (account mode). Legacy: NOE_SSH_ACCESS_TOKEN.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "src/index.js"]
