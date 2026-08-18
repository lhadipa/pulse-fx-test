# Imagem do frontend: build estatico com Vite, servido por nginx.
#
# A URL da API entra em BUILD TIME (o Vite injeta import.meta.env dentro do
# bundle), por isso ela e um ARG de build e nao uma variavel de runtime.

# ---------- estagio 1: build ----------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace @pulse-fx/web --workspace @pulse-fx/shared --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

ARG VITE_API_URL=http://localhost:3333
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace @pulse-fx/web

# ---------- estagio 2: runtime ----------
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
