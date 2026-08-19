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

# O tsc nao reescreve o especificador `@pulse-fx/shared` no JS emitido, e o
# symlink de workspace criado pelo npm aponta para `packages/shared`, que nao
# existe nesta imagem - so o JS compilado veio do builder. Reapontamos o pacote
# para a saida compilada em dist/packages/shared.
RUN rm -rf node_modules/@pulse-fx/shared \
    && printf '%s' '{"name":"@pulse-fx/shared","version":"1.0.0","type":"module","main":"./src/index.js","exports":{".":"./src/index.js"}}' > dist/packages/shared/package.json \
    && ln -s /app/dist/packages/shared node_modules/@pulse-fx/shared

# Nao rodar como root. A imagem node ja traz o usuario `node`.
USER node

EXPOSE 3333

CMD ["node", "dist/apps/api/src/server.js"]
