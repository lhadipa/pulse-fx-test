# Imagem da API e do worker (mesma imagem, entrypoints diferentes).
#
# Build em multi-stage: o estagio final nao carrega TypeScript, devDependencies
# nem codigo-fonte - apenas o JavaScript compilado e as dependencias de
# producao.

# ---------- estagio 1: dependencias + build ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Copiamos apenas os manifestos primeiro: enquanto eles nao mudarem, o Docker
# reaproveita a camada de node_modules e o build fica em segundos.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace @pulse-fx/api --workspace @pulse-fx/shared --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm run build --workspace @pulse-fx/api

# ---------- estagio 2: dependencias de producao ----------
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci --omit=dev --workspace @pulse-fx/api --workspace @pulse-fx/shared --include-workspace-root \
    && npm cache clean --force

# ---------- estagio 3: runtime ----------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    TZ=UTC

WORKDIR /app

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
# As migrations sao lidas em runtime pelo migrator; o caminho relativo a
# dist/apps/api/src/infrastructure/db/ aponta para ./dist/apps/api/migrations.
COPY --from=builder /app/apps/api/migrations ./dist/apps/api/migrations
COPY apps/api/package.json ./package.json

# Nao rodar como root. A imagem node ja traz o usuario `node`.
USER node

EXPOSE 3333

CMD ["node", "dist/apps/api/src/server.js"]
