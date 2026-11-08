# syntax=docker/dockerfile:1
# Serveur de salons du mode en ligne (WebSocket). Contexte de build : la racine du dépôt (le serveur partage
# src/net/protocol.ts et src/core/options.ts avec le jeu) : `docker compose build vers-server`.

# --- Étape 1 : bundle esbuild (un seul fichier) -------------------------------------------------------
FROM node:lts-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY src ./src
COPY server ./server
RUN mkdir /out \
 && npx esbuild server/index.ts --bundle --platform=node --format=esm --target=node22 --alias:@=./src --external:ws --outfile=/out/server.mjs \
 && node -e "const v=require('./package.json').devDependencies.ws; require('fs').writeFileSync('/out/package.json', JSON.stringify({name:'vers-server',private:true,type:'module',dependencies:{ws:v}}))"

# --- Étape 2 : exécution minimale (seule dépendance : ws) ---------------------------------------------
FROM node:lts-alpine AS runtime
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=build /out/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /out/server.mjs ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server.mjs"]
