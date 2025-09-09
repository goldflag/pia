# PIA OpenVPN Proxy Farm

Run multiple HTTP proxies via PIA OpenVPN tunnels on a single host.

## Quick Start (Docker Compose)

1. Configure PIA credentials:
```bash
cp .env.example .env
vim .env  # Add your PIA_USERNAME and PIA_PASSWORD
```

2. Start the proxy farm:
```bash
./start.sh
```

3. Create proxies:
```bash
# Add a single proxy
docker exec proxyfarm-manager pf add --country US

# Add multiple proxies
docker exec proxyfarm-manager pf up --count 10 --country US

# List all proxies
docker exec proxyfarm-manager pf ls
```

## Manual Setup (Development)

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your PIA credentials
```

3. Build:
```bash
npm run build
```

## Usage

### Docker Compose Commands

```bash
# Start the proxy farm
docker-compose up -d

# Create proxies
docker exec proxyfarm-manager pf add --country US --city "New York"
docker exec proxyfarm-manager pf up --count 10 --country US

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
pf add --country US --city "New York"
pf up --count 10 --country US
pf ls
pf rm <id>
pf rotate <id>
pf heal
pf status
```

### Using Proxies

Connect via SOCKS5:
```bash
curl --proxy socks5h://localhost:12000 https://ifconfig.io
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

The proxy containers are created on the host network. Each proxy exposes its SOCKS5 port directly on the host.

### Port Management
- Default range: 12000-13999
- Each proxy gets a unique port from this range
- Ports are managed by the proxy farm service

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

- Restrict SOCKS access via firewall
- Never expose ports publicly without authentication
- Keep PIA credentials secure
- Use Docker secrets for production deployments