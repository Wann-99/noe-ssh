ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE} AS build

WORKDIR /app

ARG NPM_REGISTRY=
ARG USE_CN_MIRROR=0

RUN if [ "$USE_CN_MIRROR" = "1" ]; then \
      sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories; \
    fi \
 && apk add --no-cache python3 make g++ wget

COPY package.json package-lock.json* ./
COPY client/package.json client/package-lock.json* ./client/

RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --omit=dev --ignore-scripts \
 && npm --prefix client ci

COPY shared ./shared
COPY client ./client
COPY src ./src
COPY scripts ./scripts

RUN npm --prefix client run build

ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE}

WORKDIR /app

ARG NPM_REGISTRY=
ARG USE_CN_MIRROR=0

RUN if [ "$USE_CN_MIRROR" = "1" ]; then \
      sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories; \
    fi \
 && apk add --no-cache python3 make g++ wget

COPY package.json package-lock.json* ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && npm ci --omit=dev --ignore-scripts

COPY src ./src
COPY shared ./shared
COPY --from=build /app/dist/client ./dist/client

ENV NODE_ENV=production
ENV PORT=3000
# Set NOE_SSH_ACCESS_TOKEN in compose/runtime for Docker deployments

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "src/index.js"]
