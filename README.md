# PIA OpenVPN SOCKS5 Proxy Farm

Run multiple SOCKS5 proxies via PIA OpenVPN tunnels on a single host.

## Quick Start (Docker Compose)

1. Configure PIA credentials:
```bash
cp .env.example .env
vim .env  # Add your PIA_USERNAME and PIA_PASSWORD
```

2. Start the proxy farm:
```bash
./manage.sh start
```

3. Create proxies:
```bash
# Add proxies (auto-selects best PIA server)
docker exec proxyfarm-manager pf add  # Creates 1 proxy
docker exec proxyfarm-manager pf add 10  # Creates 10 proxies

# List all proxies
docker exec proxyfarm-manager pf ls

# Note: Region selection is stored but not enforced due to Gluetun/PIA limitations
```

## Development

For local development without Docker:

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your PIA credentials
```

3. Build TypeScript:
```bash
npm run build
```

Note: The Docker setup handles TypeScript compilation automatically, so `npm run build` is only needed for local development.

## Usage

### Docker Compose Commands

```bash
# Start the proxy farm
docker-compose up -d

# Create proxies
docker exec proxyfarm-manager pf add --country US --city "New York"  # Creates 1 proxy
docker exec proxyfarm-manager pf add 10 --country US  # Creates 10 proxies

# List proxies
docker exec proxyfarm-manager pf ls

# Remove proxy
docker exec proxyfarm-manager pf rm <id>

# Rotate proxy (restart for new IP)
docker exec proxyfarm-manager pf rotate <id>

# Heal unhealthy proxies
docker exec proxyfarm-manager pf heal

# System status
docker exec proxyfarm-manager pf status

# View logs
docker-compose logs -f proxyfarm

# Stop the farm
docker-compose down
```

### CLI Commands (Direct)

When running directly on host:
```bash
pf add  # Creates 1 proxy
pf add 10  # Creates 10 proxies
pf add 5 --country US --city "New York"  # Creates 5 proxies in specific location
pf ls
pf rm <id>
pf rotate <id>
pf heal  # Cleans up registry and heals unhealthy proxies
pf status
```

### Using Proxies

Connect via SOCKS5 proxy:
```bash
# SOCKS5 proxy on assigned port
curl --socks5-hostname localhost:12000 https://ifconfig.io

# In applications, configure SOCKS5 proxy:
# Host: localhost (or your server IP)
# Port: 12000 (or assigned port)
# Type: SOCKS5
```

## Configuration

Key environment variables:
- `PIA_USERNAME` / `PIA_PASSWORD`: PIA credentials
- `PORT_RANGE_START` / `PORT_RANGE_END`: Port range for proxies
- `MAX_PROXIES`: Maximum proxy limit
- `REST_ENABLED`: Enable REST API (default: false)

## System Requirements

- Docker Engine
- Node.js 18+
- Linux host (for production)
- Sufficient RAM for containers (~128MB per proxy)

## Docker Networking

The proxy containers are created on the host network. Each proxy exposes its HTTP proxy port directly on the host.

### Port Management
- Default range: 12000-13999
- Each proxy gets a unique port from this range
- Ports are managed by the proxy farm service
- Protocol: SOCKS5 proxy

### Accessing Proxies from Other Containers

If you need to access proxies from other Docker containers:

```yaml
# In your docker-compose.yml
services:
  your-app:
    network_mode: host  # Access proxy ports directly
    # OR
    extra_hosts:
      - "host.docker.internal:host-gateway"  # Then use host.docker.internal:12000
```

## Security

- Restrict SOCKS5 proxy access via firewall
- Never expose ports publicly without authentication
- Keep PIA credentials secure
- Use Docker secrets for production deployments

## Technical Details

- **VPN Provider**: Private Internet Access (PIA)
- **VPN Protocol**: OpenVPN (UDP)
- **Proxy Type**: Shadowsocks proxy (SOCKS5-compatible via Gluetun)
- **Container Image**: qmcgaw/gluetun:latest
- **Health Checks**: Automatic connectivity and exit IP verification
- **Port Allocation**: Automatic with collision prevention
- **Data Storage**: JSON-based registry (SQLite optional)

## Troubleshooting

### Proxy shows unhealthy but works
- The health check may timeout during initial connection
- Wait 10-15 seconds after creation for VPN to stabilize
- Manually test with: `curl --socks5-hostname localhost:PORT https://ifconfig.io`

### Container keeps restarting
- Check PIA credentials in `.env` file
- Verify Docker has sufficient resources
- Check logs: `docker logs pf_CONTAINER_ID`

### Management Commands

Use the `manage.sh` script for all operations:

```bash
./manage.sh start    # Initial setup and start the proxy farm
./manage.sh update   # Update code without removing proxies
./manage.sh reset    # Remove all proxies and data, keep Docker images
./manage.sh rebuild  # Complete rebuild from scratch
./manage.sh clean    # Nuclear option - remove everything including images
./manage.sh help     # Show all available commands
```

**Examples:**
- First time setup: `./manage.sh start`
- Deploy new code changes: `./manage.sh update`
- Start fresh but keep images cached: `./manage.sh reset`
- Fix persistent issues: `./manage.sh rebuild`
- Complete cleanup: `./manage.sh clean`