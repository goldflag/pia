# PIA WireGuard Proxy Farm

Run multiple SOCKS5 proxies via PIA WireGuard tunnels on a single host.

## Setup

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

### CLI Commands

```bash
# Create single proxy
pf add --country US --city "New York"

# Bulk create
pf up --count 10 --country US

# List all proxies
pf ls

# Remove proxy
pf rm <id>

# Rotate proxy (restart for new IP)
pf rotate <id>

# Heal unhealthy proxies
pf heal

# System status
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

## Security

- Restrict SOCKS access via firewall
- Never expose ports publicly without authentication
- Keep PIA credentials secure