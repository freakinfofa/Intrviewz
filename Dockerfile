# ── Build stage ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

# Copy source needed for the Excalidraw build
COPY build-excalidraw.js excalidraw-app.jsx ./
COPY Public ./Public

# Bundle Excalidraw into a static JS file
RUN node build-excalidraw.js

# ── Runtime stage ─────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Create data directory for SQLite volume mount – owned by non-root 'node' user
RUN mkdir -p /app/data && chown -R node:node /app/data

# Copy production dependencies only
COPY package.json ./
RUN npm install --omit=dev && rm -rf /root/.npm

# Copy application source
COPY --chown=node:node . .

# Copy the built Excalidraw bundle from builder stage
COPY --from=builder /app/Public/js/excalidraw-bundle.js ./Public/js/excalidraw-bundle.js

# Run as the built-in non-root 'node' user
USER node

EXPOSE 3000

CMD ["node", "server.js"]
