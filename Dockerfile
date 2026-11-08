# syntax=docker/dockerfile:1

# --- Étape 1 : build -------------------------------------------------------
FROM node:lts-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

# --- Étape 2 : service statique -------------------------------------------
FROM nginx:alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/vers.conf
COPY nginx-security.inc /etc/nginx/conf.d/vers-security.inc
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/healthz || exit 1
