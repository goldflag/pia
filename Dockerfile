FROM node:18-alpine

WORKDIR /app

# Install docker CLI for container management
RUN apk add --no-cache docker-cli curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Install TypeScript and build
RUN npm install -g typescript && \
    npm run build && \
    npm uninstall -g typescript

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