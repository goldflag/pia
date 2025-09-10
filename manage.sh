#!/bin/bash

# Consolidated management script for the proxy farm

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_color() {
    echo -e "${2}${1}${NC}"
}

# Help function
show_help() {
    echo "Proxy Farm Management Script"
    echo ""
    echo "Usage: ./manage.sh [command]"
    echo ""
    echo "Commands:"
    echo "  update      - Update code and restart manager (keeps proxies running)"
    echo "  reset       - Remove all proxies and data, keep images"
    echo "  rebuild     - Complete rebuild: remove everything and start fresh"
    echo "  clean       - Same as rebuild but also removes Docker images"
    echo ""
    echo "Examples:"
    echo "  ./manage.sh update    # Deploy new code without losing proxies"
    echo "  ./manage.sh reset     # Clear all proxies but keep Docker images"
    echo "  ./manage.sh rebuild   # Full rebuild from scratch"
    echo "  ./manage.sh clean     # Nuclear option - remove everything"
    exit 0
}

# Update code without removing proxies
update_code() {
    print_color "🔄 Updating proxy farm code (keeping proxies)..." "$YELLOW"
    
    # Save current proxy data
    print_color "Backing up proxy data..." "$YELLOW"
    if [ -f data/proxies.json ]; then
        cp data/proxies.json data/proxies.backup.json
    fi
    
    # Stop only the manager
    print_color "Stopping manager container..." "$YELLOW"
    docker compose stop proxyfarm 2>/dev/null || true
    docker compose rm -f proxyfarm 2>/dev/null || true
    
    # Rebuild manager image only (Docker will build TypeScript inside)
    print_color "Rebuilding manager Docker image..." "$YELLOW"
    docker compose build --no-cache proxyfarm
    
    # Start the manager
    print_color "Starting updated manager..." "$YELLOW"
    docker compose up -d proxyfarm
    
    # Wait for startup
    sleep 3
    
    # Verify the update
    print_color "Verifying update..." "$YELLOW"
    docker exec proxyfarm-manager pf status
    
    print_color "✅ Update complete! Proxies remain running." "$GREEN"
    print_color "Active proxies:" "$YELLOW"
    docker ps --filter "name=pf_" --format "table {{.Names}}\t{{.Status}}" | head -10
}

# Reset: Remove proxies and data but keep images
reset_proxies() {
    print_color "🧹 Resetting Proxy Farm (removing proxies, keeping images)..." "$YELLOW"
    
    # Stop the manager
    print_color "Stopping proxy farm manager..." "$YELLOW"
    docker compose down 2>/dev/null || true
    
    # Remove all proxy containers
    print_color "Removing all proxy containers..." "$YELLOW"
    docker ps -a --filter "label=proxyfarm=true" -q | xargs -r docker rm -f 2>/dev/null || true
    docker ps -a --filter "name=pf_" -q | xargs -r docker rm -f 2>/dev/null || true
    
    # Clear the data directory
    print_color "Clearing data..." "$YELLOW"
    rm -f data/proxies.json data/*.backup.json data/*.db
    mkdir -p data
    
    print_color "✅ Reset complete!" "$GREEN"
    echo ""
    echo "Removed:"
    echo "  - All proxy containers"
    echo "  - Registry data"
    echo ""
    echo "To start fresh:"
    echo "  1. Run: ./start.sh"
    echo "  2. Create proxies: docker exec proxyfarm-manager pf up --count 5"
}

# Rebuild: Complete rebuild but keep Docker images
rebuild_all() {
    print_color "🔨 Complete Rebuild of Proxy Farm..." "$YELLOW"
    
    # Stop everything
    print_color "Stopping all services..." "$YELLOW"
    docker compose down -v
    
    # Remove all proxy containers
    print_color "Removing proxy containers..." "$YELLOW"
    docker ps -aq --filter "label=proxyfarm=true" | xargs -r docker rm -f 2>/dev/null || true
    docker ps -aq --filter "name=pf_" | xargs -r docker rm -f 2>/dev/null || true
    
    # Remove the manager image to force rebuild
    print_color "Removing manager image..." "$YELLOW"
    docker rmi pia-proxyfarm 2>/dev/null || true
    
    # Clean data
    print_color "Cleaning data directory..." "$YELLOW"
    rm -rf data/*
    mkdir -p data
    
    # Build Docker image from scratch (Docker will build TypeScript inside)
    print_color "Building Docker image from scratch..." "$YELLOW"
    DOCKER_BUILDKIT=0 docker compose build --no-cache --pull --force-rm
    
    # Start services
    print_color "Starting services..." "$YELLOW"
    docker compose up -d
    
    # Wait and verify
    print_color "Waiting for services to start..." "$YELLOW"
    sleep 5
    
    # Test
    docker exec proxyfarm-manager pf status || true
    
    print_color "✅ Rebuild complete!" "$GREEN"
    echo ""
    echo "Test with:"
    echo "  docker exec proxyfarm-manager pf add"
}

# Clean: Nuclear option - remove everything including images
clean_everything() {
    print_color "☢️  Complete cleanup (removing everything)..." "$RED"
    
    # Do a full rebuild first
    rebuild_all
    
    # Additionally remove all Docker images
    print_color "Removing Docker images..." "$YELLOW"
    docker rmi pia-proxyfarm 2>/dev/null || true
    docker rmi $(docker images -q --filter "reference=pia*") 2>/dev/null || true
    docker rmi qmcgaw/gluetun:latest 2>/dev/null || true
    docker rmi curlimages/curl:latest 2>/dev/null || true
    
    # Clear build cache
    print_color "Clearing Docker build cache..." "$YELLOW"
    docker builder prune -af 2>/dev/null || true
    
    print_color "✅ Complete cleanup done!" "$GREEN"
    echo "Everything has been removed. Start from scratch with ./start.sh"
}

# Main script logic
case "${1}" in
    update)
        update_code
        ;;
    reset)
        read -p "This will remove all proxies. Continue? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            reset_proxies
        else
            print_color "Cancelled." "$YELLOW"
        fi
        ;;
    rebuild)
        read -p "This will rebuild everything. Continue? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            rebuild_all
        else
            print_color "Cancelled." "$YELLOW"
        fi
        ;;
    clean)
        read -p "This will remove EVERYTHING including Docker images. Continue? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            clean_everything
        else
            print_color "Cancelled." "$YELLOW"
        fi
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        print_color "Unknown command: $1" "$RED"
        echo ""
        show_help
        ;;
esac