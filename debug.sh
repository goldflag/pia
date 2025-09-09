#!/bin/bash

# Debug script to check container configuration

echo "🔍 Debugging Proxy Containers..."
echo ""

# Check proxyfarm-manager build
echo "Checking proxyfarm-manager code..."
docker exec proxyfarm-manager cat /app/dist/docker.js | grep -A 5 "VPN_TYPE"
echo ""

# List all proxy containers
echo "Proxy containers:"
docker ps -a --filter "name=pf_" --format "table {{.Names}}\t{{.Status}}"
echo ""

# Get the latest proxy container
LATEST_CONTAINER=$(docker ps -a --filter "name=pf_" -q | head -1)

if [ -n "$LATEST_CONTAINER" ]; then
    echo "Inspecting latest container: $LATEST_CONTAINER"
    echo ""
    echo "Environment variables:"
    docker inspect $LATEST_CONTAINER | jq '.[0].Config.Env[]' | grep -E "(VPN_|OPENVPN_|SERVER_)"
    echo ""
    echo "Port bindings:"
    docker inspect $LATEST_CONTAINER | jq '.[0].HostConfig.PortBindings'
    echo ""
    echo "Container logs (last 20 lines):"
    docker logs --tail 20 $LATEST_CONTAINER 2>&1
else
    echo "No proxy containers found"
fi