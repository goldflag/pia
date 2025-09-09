#!/bin/bash

# Proxy Farm Startup Script

set -e

echo "🚀 Starting PIA Proxy Farm..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure your PIA credentials:"
    echo "  cp .env.example .env"
    echo "  vim .env  # Add your PIA_USERNAME and PIA_PASSWORD"
    exit 1
fi

# Check if PIA credentials are configured
source .env
if [[ -z "$PIA_USERNAME" || "$PIA_USERNAME" == "your_username_here" ]]; then
    echo "❌ Error: PIA credentials not configured!"
    echo "Please edit .env and add your PIA_USERNAME and PIA_PASSWORD"
    exit 1
fi

# Create necessary directories
mkdir -p data keys

# Pull required images
echo "📦 Pulling Docker images..."
docker pull qmcgaw/gluetun:latest
docker pull curlimages/curl:latest

# Start the proxy farm
echo "🔧 Starting services..."
docker-compose up -d

# Wait for service to be ready
echo "⏳ Waiting for service to initialize..."
sleep 5

# Show status
echo "✅ Proxy Farm is running!"
echo ""
echo "Available commands:"
echo "  docker exec proxyfarm-manager pf add --country US        # Add a proxy"
echo "  docker exec proxyfarm-manager pf up --count 5            # Add 5 proxies"
echo "  docker exec proxyfarm-manager pf ls                      # List proxies"
echo "  docker exec proxyfarm-manager pf status                  # System status"
echo ""
echo "View logs:"
echo "  docker-compose logs -f proxyfarm"
echo ""
echo "Stop the farm:"
echo "  docker-compose down"