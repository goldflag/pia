#!/bin/bash

# Reset Script - Removes all proxy containers and data

set -e

echo "🧹 Resetting Proxy Farm..."

# Stop the manager
echo "Stopping proxy farm manager..."
docker compose down 2>/dev/null || true

# Remove all proxy containers
echo "Removing all proxy containers..."
docker ps -a --filter "label=proxyfarm=true" -q | xargs -r docker rm -f 2>/dev/null || true

# Clean up any orphaned containers with pf_ prefix
docker ps -a --filter "name=pf_" -q | xargs -r docker rm -f 2>/dev/null || true

# Clear the data directory
echo "Clearing data..."
rm -f data/proxies.json
rm -f data/*.db
mkdir -p data

# Remove docker images if requested
if [ "$1" == "--clean-images" ]; then
    echo "Removing Docker images..."
    docker rmi proxyfarm-manager 2>/dev/null || true
    docker rmi qmcgaw/gluetun:latest 2>/dev/null || true
    docker rmi curlimages/curl:latest 2>/dev/null || true
fi

# Show status
echo "✅ Reset complete!"
echo ""
echo "Removed:"
echo "  - All proxy containers"
echo "  - Registry data"
if [ "$1" == "--clean-images" ]; then
    echo "  - Docker images"
fi
echo ""
echo "To start fresh:"
echo "  1. Edit .env with your PIA credentials"
echo "  2. Run: ./start.sh"
echo "  3. Create new proxies: docker exec proxyfarm-manager pf add --country US"