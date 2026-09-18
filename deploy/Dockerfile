FROM node:24.21.0-trixie-slim@sha256:db3ae80f5d8df06e04dabdf7b44cbf008d32de168205fa0294444aabbc08c590 AS base
# Apply supported Trixie security updates missing from the pinned official image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gzip=1.13-1+deb13u1 libpcre2-8-0=10.46-1~deb13u2 \
    libsqlite3-0=3.46.1-7+deb13u2 perl-base=5.40.1-6+deb13u1 \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
COPY public ./public
RUN npm test && npm run typecheck && npm run build && npm run smoke && node --test dist/test/*.test.js
RUN npm prune --omit=dev && npm cache clean --force

FROM base AS runtime
# Runtime starts Node directly; package installation belongs only in the build stage.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /build/package.json ./package.json
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist/src ./dist/src
COPY --from=build /build/public ./public
COPY deploy/healthcheck.mjs ./deploy/healthcheck.mjs
USER 1000:1000
CMD ["node", "dist/src/main.js"]
