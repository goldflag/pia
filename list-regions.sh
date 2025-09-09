#!/bin/bash

# List available PIA regions

echo "Testing PIA regions with Gluetun..."
echo ""

# Create a test container to list servers
docker run --rm \
  -e VPN_SERVICE_PROVIDER="private internet access" \
  -e VPN_TYPE=openvpn \
  -e OPENVPN_USER="${PIA_USERNAME:-test}" \
  -e OPENVPN_PASSWORD="${PIA_PASSWORD:-test}" \
  qmcgaw/gluetun:latest \
  sh -c "cat /gluetun/servers.json | grep -o '\"country\":\"[^\"]*\"' | sort -u | head -20"

echo ""
echo "Common PIA regions to try:"
echo "  - Netherlands"
echo "  - Switzerland"  
echo "  - United States"
echo "  - Canada"
echo "  - Germany"
echo "  - United Kingdom"
echo ""
echo "Cities for United States:"
echo "  - Atlanta"
echo "  - Chicago"
echo "  - Dallas"
echo "  - Denver"
echo "  - Los Angeles"
echo "  - Miami"
echo "  - New York City"
echo "  - Seattle"
echo "  - Washington DC"