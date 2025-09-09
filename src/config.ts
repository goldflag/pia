import * as dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

export const config: Config = {
  portRangeStart: parseInt(process.env.PORT_RANGE_START || '12000', 10),
  portRangeEnd: parseInt(process.env.PORT_RANGE_END || '13999', 10),
  maxProxies: parseInt(process.env.MAX_PROXIES || '300', 10),
  piaUsername: process.env.PIA_USERNAME,
  piaPassword: process.env.PIA_PASSWORD,
  piaToken: process.env.PIA_TOKEN,
  piaWgKeysDir: process.env.PIA_WG_KEYS_DIR,
  defaultCountry: process.env.DEFAULT_COUNTRY,
  defaultCity: process.env.DEFAULT_CITY,
  exitIpCheckUrl: process.env.EXIT_IP_CHECK_URL || 'https://ifconfig.io',
  healthIntervalSec: parseInt(process.env.HEALTH_INTERVAL_SEC || '15', 10),
  socksBind: process.env.SOCKS_BIND || '0.0.0.0',
  restEnabled: process.env.REST_ENABLED === 'true',
  restPort: parseInt(process.env.REST_PORT || '8080', 10),
  vpnImage: process.env.VPN_IMAGE || 'qmcgaw/gluetun:latest',
  dbPath: process.env.DB_PATH || './data/proxies.json'
};

export function validateConfig(): void {
  if (!config.piaUsername && !config.piaToken) {
    throw new Error('Either PIA_USERNAME/PIA_PASSWORD or PIA_TOKEN must be set');
  }
  
  if (config.piaUsername && !config.piaPassword) {
    throw new Error('PIA_PASSWORD must be set when using PIA_USERNAME');
  }
  
  if (config.portRangeStart >= config.portRangeEnd) {
    throw new Error('PORT_RANGE_START must be less than PORT_RANGE_END');
  }
  
  const availablePorts = config.portRangeEnd - config.portRangeStart + 1;
  if (availablePorts < config.maxProxies) {
    throw new Error(`Port range only has ${availablePorts} ports but MAX_PROXIES is ${config.maxProxies}`);
  }
}