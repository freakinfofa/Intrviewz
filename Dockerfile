# ── Build stage ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# ── Runtime stage ─────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Create data directory for SQLite volume mount – owned by non-root 'node' user
RUN mkdir -p /app/data && chown -R node:node /app/data

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY --chown=node:node . .

# Run as the built-in non-root 'node' user
USER node

EXPOSE 3000

CMD ["node", "server.js"]
