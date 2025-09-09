#!/bin/bash

# Advanced proxy testing script with more options

# Configuration
URL="${1:-https://httpbin.org/ip}"
TIMEOUT="${TIMEOUT:-5}"
VERBOSE="${VERBOSE:-0}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
  echo "Usage: $0 [URL] [OPTIONS]"
  echo ""
  echo "Test all proxies by fetching a URL through each one."
  echo ""
  echo "URLs (defaults to https://httpbin.org/ip):"
  echo "  https://ifconfig.io          - Returns IP address only"
  echo "  https://httpbin.org/ip        - Returns JSON with IP"
  echo "  https://ipinfo.io/json        - Returns detailed location info"
  echo "  https://api.ipify.org         - Returns IP address only"
  echo ""
  echo "Options:"
  echo "  --parallel      Run tests in parallel"
  echo "  --verbose       Show full responses"
  echo "  --csv           Output in CSV format"
  echo "  --timeout N     Set timeout in seconds (default: 5)"
  echo ""
  echo "Examples:"
  echo "  $0                                    # Test with default URL"
  echo "  $0 https://google.com                 # Test specific URL"
  echo "  $0 https://ifconfig.io --parallel     # Test in parallel"
  echo "  TIMEOUT=10 $0 --verbose               # 10 second timeout, verbose"
  exit 0
}

# Parse arguments
for arg in "$@"; do
  case $arg in
    --help|-h)
      usage
      ;;
    --parallel)
      PARALLEL=1
      ;;
    --verbose)
      VERBOSE=1
      ;;
    --csv)
      CSV=1
      ;;
    --timeout)
      shift
      TIMEOUT=$1
      ;;
  esac
done

# Get proxy list
echo -e "${YELLOW}Fetching proxy list...${NC}"
PROXY_DATA=$(docker exec proxyfarm-manager pf ls --no-check --json 2>/dev/null)

if [ -z "$PROXY_DATA" ]; then
  echo -e "${RED}No proxies found!${NC}"
  echo "Create proxies with: docker exec proxyfarm-manager pf up --count 5"
  exit 1
fi

# Parse ports and IDs
PROXIES=$(echo "$PROXY_DATA" | jq -r '.[] | "\(.port):\(.id):\(.exitIp // "unknown")"')
TOTAL=$(echo "$PROXIES" | wc -l)

echo -e "${GREEN}Found $TOTAL proxies${NC}"
echo "Testing URL: $URL"
echo "Timeout: ${TIMEOUT}s"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# CSV header
if [ "$CSV" = "1" ]; then
  echo "Port,ProxyID,RegisteredIP,ActualIP,ResponseTime,Status"
fi

test_proxy() {
  local PORT=$1
  local ID=$2
  local EXIT_IP=$3
  local START=$(date +%s%3N)
  
  # Test the proxy
  RESPONSE=$(curl --proxy http://localhost:$PORT \
    --max-time $TIMEOUT \
    --silent \
    --show-error \
    --write-out '\nHTTP_CODE:%{http_code}\nTIME:%{time_total}' \
    "$URL" 2>&1)
  
  local END=$(date +%s%3N)
  local DURATION=$((END - START))
  
  if [ $? -eq 0 ]; then
    HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
    TIME=$(echo "$RESPONSE" | grep "TIME:" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:\|TIME:")
    
    # Extract IP from response if possible
    ACTUAL_IP=$(echo "$BODY" | grep -oE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' | head -1)
    
    if [ "$CSV" = "1" ]; then
      echo "$PORT,${ID:0:8},$EXIT_IP,$ACTUAL_IP,${TIME}s,success"
    elif [ "$VERBOSE" = "1" ]; then
      echo -e "${GREEN}✅ Port $PORT${NC} (${ID:0:8})"
      echo "   Registered IP: $EXIT_IP"
      echo "   Actual IP: $ACTUAL_IP"
      echo "   Response Time: ${TIME}s"
      echo "   HTTP Code: $HTTP_CODE"
      echo "   Body: ${BODY:0:100}"
    else
      echo -e "${GREEN}✅ Port $PORT${NC}: $ACTUAL_IP (${TIME}s)"
    fi
    return 0
  else
    if [ "$CSV" = "1" ]; then
      echo "$PORT,${ID:0:8},$EXIT_IP,,${DURATION}ms,failed"
    else
      echo -e "${RED}❌ Port $PORT${NC}: Failed"
    fi
    return 1
  fi
}

# Sequential testing
if [ "$PARALLEL" != "1" ]; then
  SUCCESS=0
  FAILED=0
  CURRENT=0
  
  while IFS=: read -r PORT ID EXIT_IP; do
    CURRENT=$((CURRENT + 1))
    if [ "$CSV" != "1" ]; then
      echo -n "[$CURRENT/$TOTAL] "
    fi
    
    if test_proxy "$PORT" "$ID" "$EXIT_IP"; then
      SUCCESS=$((SUCCESS + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  done <<< "$PROXIES"
  
  if [ "$CSV" != "1" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "📊 Results: ${GREEN}$SUCCESS successful${NC}, ${RED}$FAILED failed${NC} out of $TOTAL proxies"
  fi
else
  # Parallel testing
  echo "Running parallel tests..."
  
  while IFS=: read -r PORT ID EXIT_IP; do
    test_proxy "$PORT" "$ID" "$EXIT_IP" &
  done <<< "$PROXIES"
  
  wait
  
  if [ "$CSV" != "1" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Parallel testing complete!"
  fi
fi

# Performance test option
if [ "$2" = "--perf" ]; then
  echo ""
  echo "🏃 Running performance test..."
  echo "Testing 10 requests through each proxy..."
  
  for PORT in $(echo "$PROXIES" | cut -d: -f1); do
    TOTAL_TIME=0
    echo -n "Port $PORT: "
    
    for i in {1..10}; do
      TIME=$(curl --proxy http://localhost:$PORT \
        --max-time 3 \
        --silent \
        --write-out '%{time_total}' \
        --output /dev/null \
        "$URL" 2>/dev/null)
      
      if [ $? -eq 0 ]; then
        TOTAL_TIME=$(echo "$TOTAL_TIME + $TIME" | bc)
      fi
    done
    
    AVG=$(echo "scale=3; $TOTAL_TIME / 10" | bc)
    echo "Avg response time: ${AVG}s"
  done
fi