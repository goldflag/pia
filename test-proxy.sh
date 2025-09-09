#!/bin/bash

# Test proxy connectivity

if [ -z "$1" ]; then
    echo "Usage: ./test-proxy.sh <port>"
    echo "Example: ./test-proxy.sh 12000"
    exit 1
fi

PORT=$1

echo "Testing proxy on port $PORT..."
echo ""

# Test SOCKS5 connectivity
echo "1. Testing SOCKS5 connection..."
timeout 5 nc -zv localhost $PORT 2>&1 || echo "Connection failed"
echo ""

# Test with curl through SOCKS5
echo "2. Testing with curl through SOCKS5..."
curl --proxy socks5h://localhost:$PORT --max-time 10 https://ifconfig.io 2>&1 || echo "Curl failed"
echo ""

# Try HTTP proxy as fallback (Gluetun also provides HTTP proxy)
echo "3. Testing HTTP proxy (fallback)..."
curl --proxy http://localhost:$PORT --max-time 10 https://ifconfig.io 2>&1 || echo "HTTP proxy failed"
echo ""

# Check container status
CONTAINER=$(docker ps -a --filter "publish=$PORT" --format "{{.Names}}" | head -1)
if [ -n "$CONTAINER" ]; then
    echo "4. Container status for $CONTAINER:"
    docker ps --filter "name=$CONTAINER" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
fi