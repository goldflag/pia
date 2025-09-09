#!/bin/bash

# Test all proxies by visiting a webpage

# Default URL to test (shows IP address)
URL="${1:-https://ifconfig.io}"

echo "🔍 Testing all proxies with URL: $URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get all proxy ports from the registry
PROXY_PORTS=$(docker exec proxyfarm-manager pf ls --no-check --json 2>/dev/null | \
  grep -o '"port":[0-9]*' | cut -d: -f2 | sort -n)

if [ -z "$PROXY_PORTS" ]; then
  echo "❌ No proxies found. Create some with: docker exec proxyfarm-manager pf up --count 5"
  exit 1
fi

# Count total proxies
TOTAL=$(echo "$PROXY_PORTS" | wc -l)
CURRENT=0
SUCCESS=0
FAILED=0

# Test each proxy
for PORT in $PROXY_PORTS; do
  CURRENT=$((CURRENT + 1))
  echo -n "[$CURRENT/$TOTAL] Testing port $PORT... "
  
  # Make request through proxy with timeout
  RESPONSE=$(curl --proxy http://localhost:$PORT \
    --max-time 5 \
    --silent \
    --show-error \
    "$URL" 2>&1)
  
  if [ $? -eq 0 ]; then
    # Success - show response (truncate if too long)
    if [ ${#RESPONSE} -gt 50 ]; then
      echo "✅ ${RESPONSE:0:50}..."
    else
      echo "✅ $RESPONSE"
    fi
    SUCCESS=$((SUCCESS + 1))
  else
    # Failed
    echo "❌ Failed"
    FAILED=$((FAILED + 1))
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Results: $SUCCESS successful, $FAILED failed out of $TOTAL proxies"

# Optional: Test all proxies in parallel (faster but messier output)
if [ "$2" = "--parallel" ]; then
  echo ""
  echo "🚀 Running parallel test..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  for PORT in $PROXY_PORTS; do
    (
      RESPONSE=$(curl --proxy http://localhost:$PORT \
        --max-time 5 \
        --silent \
        "$URL" 2>/dev/null)
      
      if [ $? -eq 0 ]; then
        echo "Port $PORT: ✅ $RESPONSE"
      else
        echo "Port $PORT: ❌ Failed"
      fi
    ) &
  done
  
  # Wait for all background jobs
  wait
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi