#!/bin/bash

# Script to download PIA OpenVPN configuration files

echo "📥 Downloading PIA OpenVPN configuration files..."

# Create directory for configs
mkdir -p pia-configs

# Download PIA OpenVPN configs
cd pia-configs

# Download the PIA OpenVPN config bundle
echo "Downloading PIA OpenVPN configs..."
wget -q "https://www.privateinternetaccess.com/openvpn/openvpn.zip" -O openvpn.zip

if [ $? -ne 0 ]; then
    echo "❌ Failed to download PIA configs"
    exit 1
fi

# Extract configs
echo "Extracting configuration files..."
unzip -q -o openvpn.zip

# Clean up
rm -f openvpn.zip

# Count the configs
CONFIGS=$(ls -1 *.ovpn 2>/dev/null | wc -l)

if [ "$CONFIGS" -gt 0 ]; then
    echo "✅ Downloaded $CONFIGS PIA OpenVPN configuration files"
    echo ""
    echo "Sample configs:"
    ls -1 *.ovpn | head -10
else
    echo "❌ No configuration files found"
    exit 1
fi

cd ..

echo ""
echo "📝 Note: The docker-openvpn-socks5 container will use these configs"
echo "   Each proxy will select the appropriate .ovpn file based on country/city"