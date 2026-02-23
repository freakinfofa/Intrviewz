# ── Build stage ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# ── Runtime stage ─────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Create data directory for SQLite volume mount
RUN mkdir -p /app/data

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
