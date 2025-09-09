import { registry } from './registry';
import { fetchExitIp } from './docker';
import { config } from './config';
import * as http from 'http';

interface HealthCheckResult {
  proxyId: string;
  healthy: boolean;
  exitIp?: string;
  error?: string;
}

export async function checkProxyHealth(proxyId: string): Promise<HealthCheckResult> {
  const proxy = await registry.get(proxyId);
  
  if (!proxy) {
    return { proxyId, healthy: false, error: 'Proxy not found' };
  }

  try {
    // Test HTTP proxy by actually making a request through it
    const exitIp = await testProxyAndGetIp('127.0.0.1', proxy.port);
    
    if (!exitIp) {
      // Fallback to checking container's exit IP
      const containerIp = await fetchExitIp(proxy.containerId);
      if (!containerIp) {
        await registry.update(proxyId, { healthy: false });
        return { proxyId, healthy: false, error: 'Proxy not responding' };
      }
      await registry.update(proxyId, { healthy: true, exitIp: containerIp });
      return { proxyId, healthy: true, exitIp: containerIp };
    }

    await registry.update(proxyId, { 
      healthy: true, 
      exitIp 
    });

    return { proxyId, healthy: true, exitIp };
  } catch (err: any) {
    await registry.update(proxyId, { healthy: false });
    return { proxyId, healthy: false, error: err.message };
  }
}

export async function healthCheckAll(): Promise<HealthCheckResult[]> {
  const proxies = await registry.list();
  const results: HealthCheckResult[] = [];

  for (const proxy of proxies) {
    const result = await checkProxyHealth(proxy.id);
    results.push(result);
  }

  return results;
}

export async function healProxies(): Promise<void> {
  const { rotateProxy } = await import('./docker');
  const proxies = await registry.list();

  for (const proxy of proxies) {
    if (!proxy.healthy) {
      console.log(`Healing unhealthy proxy ${proxy.id}`);
      
      if (proxy.restarts >= 3) {
        console.log(`Proxy ${proxy.id} has failed ${proxy.restarts} times, skipping`);
        continue;
      }

      try {
        await rotateProxy(proxy.id);
        console.log(`Restarted proxy ${proxy.id}`);
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await checkProxyHealth(proxy.id);
      } catch (err: any) {
        console.error(`Failed to heal proxy ${proxy.id}: ${err.message}`);
      }
    }
  }
}

let healthCheckInterval: NodeJS.Timeout | null = null;

export function startHealthCheck(): void {
  if (healthCheckInterval) {
    return;
  }

  const runCheck = async () => {
    try {
      await healthCheckAll();
    } catch (err: any) {
      console.error('Health check error:', err.message);
    }
  };

  runCheck();
  
  healthCheckInterval = setInterval(runCheck, config.healthIntervalSec * 1000);
}

export function stopHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

async function testProxyAndGetIp(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const options = {
      host: host,
      port: port,
      path: config.exitIpCheckUrl,
      method: 'GET',
      headers: {
        'Host': new URL(config.exitIpCheckUrl).hostname
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const ip = data.trim().match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
        resolve(ip ? ip[0] : null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}