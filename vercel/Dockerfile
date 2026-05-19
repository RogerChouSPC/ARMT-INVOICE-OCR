# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Azure AD values are baked into the browser bundle at build time.
# These are NOT secrets — the client ID and tenant ID are public by design.
ARG VITE_AZURE_CLIENT_ID
ARG VITE_AZURE_TENANT_ID
ENV VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID
ENV VITE_AZURE_TENANT_ID=$VITE_AZURE_TENANT_ID

RUN npm run build

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install runtime dependencies only (express + tsx, no build tooling).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built frontend + server source.
COPY --from=builder /app/dist ./dist
COPY api ./api
COPY server ./server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["npm", "start"]
