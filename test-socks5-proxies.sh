#!/bin/bash

# SOCKS5 proxy test script that extracts ports directly from Docker

URL="${1:-https://ifconfig.io}"

echo "🔍 Finding and testing all SOCKS5 proxy containers..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get ports directly from docker ps for proxy containers
PORTS=$(docker ps --filter "name=pf_" --format "{{.Ports}}" | \
  sed -n 's/.*0\.0\.0\.0:\([0-9]*\)->1080.*/\1/p' | sort -n)

if [ -z "$PORTS" ]; then
  echo "❌ No SOCKS5 proxy containers found"
  exit 1
fi

TOTAL=$(echo "$PORTS" | wc -l)
SUCCESS=0
FAILED=0

echo "Found $TOTAL SOCKS5 proxy containers"
echo "Testing URL: $URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for PORT in $PORTS; do
  echo -n "Port $PORT: "

  # Test SOCKS5 proxy using curl's socks5 support
  RESPONSE=$(curl --socks5-hostname localhost:$PORT \
    --max-time 5 \
    --silent \
    "$URL" 2>/dev/null)

  if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    echo "✅ $RESPONSE"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "❌ Failed"
    FAILED=$((FAILED + 1))
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Results: $SUCCESS successful, $FAILED failed out of $TOTAL proxies"

# Quick parallel test option
if [ "$2" = "--parallel" ]; then
  echo ""
  echo "🚀 Running parallel test (all at once)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  for PORT in $PORTS; do
    (
      RESPONSE=$(curl --socks5-hostname localhost:$PORT \
        --max-time 5 \
        --silent \
        "$URL" 2>/dev/null)

      if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
        echo "Port $PORT: ✅ $RESPONSE"
      else
        echo "Port $PORT: ❌ Failed"
      fi
    ) &
  done

  wait
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi