FROM node:18-alpine

WORKDIR /app

# Install docker CLI for container management
RUN apk add --no-cache docker-cli curl

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev) for building
RUN npm ci

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript code
RUN npm run build

# Verify build output exists
RUN ls -la /app/dist/ && test -f /app/dist/cli.js

# Remove dev dependencies after build
RUN npm prune --production

# Verify dist still exists after prune
RUN ls -la /app/dist/ && test -f /app/dist/cli.js

# Copy CLI binary
COPY bin ./bin
RUN chmod +x bin/pf

# Debug: Check the file structure
RUN echo "=== Checking /app structure ===" && ls -la /app/ && echo "=== Checking bin/pf ===" && cat /app/bin/pf

# Create data directory
RUN mkdir -p /app/data

# Add pf to PATH
ENV PATH="/app/bin:${PATH}"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD pf status || exit 1

# Default command - run the service
CMD ["node", "dist/index.js"]