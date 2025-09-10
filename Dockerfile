FROM node:24-alpine

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

# Remove dev dependencies after build
RUN npm prune --production

# Copy CLI binary
COPY bin ./bin
RUN chmod +x bin/pf

# Create data directory
RUN mkdir -p /app/data

# Add pf to PATH
ENV PATH="/app/bin:${PATH}"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD pf status || exit 1

# Default command - run the service
CMD ["node", "dist/index.js"]