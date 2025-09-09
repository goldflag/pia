#!/bin/bash

# Complete rebuild script - ensures fresh build

set -e

echo "🔨 Complete Rebuild of Proxy Farm..."

# 1. Stop everything
echo "Stopping all services..."
docker compose down -v

# 2. Remove all proxy containers
echo "Removing proxy containers..."
docker ps -aq --filter "label=proxyfarm=true" | xargs -r docker rm -f 2>/dev/null || true
docker ps -aq --filter "name=pf_" | xargs -r docker rm -f 2>/dev/null || true

# 3. Remove the old image completely
echo "Removing old images..."
docker rmi pia-proxyfarm 2>/dev/null || true
docker rmi $(docker images -q --filter "reference=pia*") 2>/dev/null || true

# 4. Clear ALL Docker build cache
echo "Clearing Docker build cache..."
docker builder prune -af

# 5. Clean data
echo "Cleaning data directory..."
rm -rf data/*
mkdir -p data

# 6. Rebuild TypeScript (ensure latest code)
echo "Rebuilding TypeScript..."
npm run build

# 7. Verify the build has the latest code
echo "Verifying build..."
if grep -q "PIA with Gluetun" dist/docker.js; then
    echo "✓ Build contains latest code"
else
    echo "❌ Build missing latest code - checking source..."
    if grep -q "PIA with Gluetun" src/docker.ts; then
        echo "Source is correct, but build failed. Rebuilding..."
        rm -rf dist/
        npm run build
    else
        echo "❌ Source code is outdated! Update src/docker.ts first"
        exit 1
    fi
fi

# 8. Build with completely fresh context
echo "Building Docker image from scratch..."
DOCKER_BUILDKIT=0 docker compose build --no-cache --pull --force-rm

# 9. Start services
echo "Starting services..."
docker compose up -d

# 10. Wait and verify
echo "Waiting for services to start..."
sleep 5

# 11. Verify the container has the new code
echo "Verifying container code..."
if docker exec proxyfarm-manager cat /app/dist/docker.js | grep -q "PIA with Gluetun"; then
    echo "✅ Container has latest code!"
else
    echo "❌ Container still has old code - manual intervention needed"
    echo "Try: docker exec proxyfarm-manager cat /app/dist/docker.js | head -50"
fi

echo ""
echo "✅ Rebuild complete!"
echo ""
echo "Test with:"
echo "  docker exec proxyfarm-manager pf add"