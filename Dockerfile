# syntax=docker/dockerfile:1
# Agent Brain Hub — shared brain-inspired memory for AI agents.
#   docker build -t agent-brain-hub .
#   docker run -p 4317:4317 -v brain-data:/app/data agent-brain-hub

# ---- deps: install production dependencies (better-sqlite3 is a native module)
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# Build tools are only needed if no prebuilt better-sqlite3 binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=4317 \
    HOST=0.0.0.0 \
    BRAIN_DB=/app/data/brain.db \
    BRAIN_SETTINGS=/app/data/settings.json
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY sdk ./sdk
COPY mcp ./mcp
COPY examples ./examples
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4317)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
