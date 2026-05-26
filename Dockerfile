# ClaudeCab Dockerfile
# Multi-stage build for optimized production image

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Remove devDependencies
RUN npm prune --production

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Add labels
LABEL maintainer="ClaudeCab Team"
LABEL description="Discord conversation workbench powered by Claude Agent SDK"
LABEL version="1.2.0"

# Create non-root user for security
RUN addgroup -g 1001 -S claudecab && \
    adduser -S -u 1001 -G claudecab claudecab

# Install runtime dependencies only
RUN apk add --no-cache tini

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create agents directory
RUN mkdir -p /app/agents && chown -R claudecab:claudecab /app

# Switch to non-root user
USER claudecab

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start application
CMD ["node", "dist/index.js"]

# =============================================================================
# Stage 3: Development (optional)
# =============================================================================
FROM node:20-alpine AS development

WORKDIR /app

# Install development tools
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy source
COPY . .

# Development command
CMD ["npm", "run", "dev"]
