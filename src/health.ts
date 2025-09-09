import { registry } from './registry';
import { fetchExitIp, testSocksConnection } from './docker';
import { config } from './config';

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
    const socksOk = await testSocksConnection('127.0.0.1', proxy.port);
    
    if (!socksOk) {
      await registry.update(proxyId, { healthy: false });
      return { proxyId, healthy: false, error: 'SOCKS5 connection failed' };
    }

    const exitIp = await fetchExitIp(proxy.containerId);
    
    if (!exitIp) {
      await registry.update(proxyId, { healthy: false });
      return { proxyId, healthy: false, error: 'Could not fetch exit IP' };
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