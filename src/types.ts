export interface ProxyRecord {
  id: string;
  containerId: string;
  port: number;
  country?: string;
  city?: string;
  exitIp?: string;
  healthy: boolean;
  restarts: number;
  createdAt: string;
  notes?: string;
}

export interface Config {
  portRangeStart: number;
  portRangeEnd: number;
  maxProxies: number;
  piaUsername?: string;
  piaPassword?: string;
  piaToken?: string;
  piaWgKeysDir?: string;
  defaultCountry?: string;
  defaultCity?: string;
  exitIpCheckUrl: string;
  healthIntervalSec: number;
  autoHealEnabled: boolean;
  socksBind: string;
  restEnabled: boolean;
  restPort: number;
  vpnImage: string;
  dbPath: string;
}

export interface CreateProxyOptions {
  country?: string;
  city?: string;
  notes?: string;
  port?: number; // Optional pre-allocated port
}