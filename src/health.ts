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
  const Docker = require('dockerode');
  const docker = new Docker();
  const { rotateProxy, removeProxy, reconcileContainers } = await import('./docker');
  
  console.log('Step 1: Reconciling with Docker containers...');
  await reconcileContainers();
  
  // Get all containers that are actually running
  const allContainers = await docker.listContainers({
    all: true,
    filters: { label: ['proxyfarm=true'] },
  });
  const runningContainerIds = new Set(allContainers.map((c: any) => c.Id));
  
  let proxies = await registry.list();
  
  // Step 2: Remove entries for containers that don't exist
  console.log('Step 2: Removing entries for missing containers...');
  let removedMissing = 0;
  for (const proxy of proxies) {
    if (!runningContainerIds.has(proxy.containerId)) {
      console.log(`  Removing entry for missing container: ${proxy.id} (port ${proxy.port})`);
      await registry.remove(proxy.id);
      removedMissing++;
    }
  }
  
  if (removedMissing > 0) {
    console.log(`  ✓ Removed ${removedMissing} entries for missing containers`);
    proxies = await registry.list();
  } else {
    console.log('  ✓ No missing containers found');
  }
  
  // Step 3: Detect and remove duplicates with port conflicts
  console.log('Step 3: Removing duplicate proxies...');
  const portMap = new Map<number, typeof proxies[0][]>();
  for (const proxy of proxies) {
    if (!portMap.has(proxy.port)) {
      portMap.set(proxy.port, []);
    }
    portMap.get(proxy.port)!.push(proxy);
  }
  
  let removedDuplicates = 0;
  for (const [port, proxyList] of portMap) {
    if (proxyList.length > 1) {
      console.log(`  Port ${port} has ${proxyList.length} entries, cleaning up...`);
      
      // Sort by creation date, keep the oldest healthy one or just the oldest
      proxyList.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const keep = proxyList.find((p) => p.healthy) || proxyList[0];
      
      for (const proxy of proxyList) {
        if (proxy.id !== keep.id) {
          console.log(`    Removing duplicate: ${proxy.id}`);
          await registry.remove(proxy.id);
          removedDuplicates++;
        }
      }
    }
  }
  
  if (removedDuplicates > 0) {
    console.log(`  ✓ Removed ${removedDuplicates} duplicate entries`);
  } else {
    console.log('  ✓ No duplicates found');
  }
  
  // Step 4: Remove orphaned containers
  console.log('Step 4: Removing orphaned containers...');
  const registeredIds = new Set(
    (await registry.list()).map((p) => p.containerId)
  );
  let orphaned = 0;
  
  for (const containerInfo of allContainers) {
    if (!registeredIds.has(containerInfo.Id)) {
      console.log(`  Found orphaned container: ${containerInfo.Names[0]}`);
      try {
        const container = docker.getContainer(containerInfo.Id);
        // Try to stop first, but ignore if already stopped
        try {
          await container.stop();
        } catch (stopErr: any) {
          // Ignore stop errors (container might already be stopped)
        }
        // Now remove the container
        await container.remove();
        orphaned++;
        console.log(`    ✓ Removed`);
      } catch (err: any) {
        console.log(`    ✗ Failed to remove: ${err.message}`);
      }
    }
  }
  
  if (orphaned > 0) {
    console.log(`  ✓ Removed ${orphaned} orphaned containers`);
  } else {
    console.log('  ✓ No orphaned containers found');
  }
  
  // Step 5: Heal remaining unhealthy proxies
  console.log('Step 5: Healing unhealthy proxies...');
  const updatedProxies = await registry.list();
  let healed = 0;
  let failed = 0;
  
  for (const proxy of updatedProxies) {
    if (!proxy.healthy) {
      console.log(`  Healing proxy ${proxy.id} (port ${proxy.port})...`);
      
      if (proxy.restarts >= 3) {
        console.log(`    Skipped: failed ${proxy.restarts} times`);
        continue;
      }

      try {
        await rotateProxy(proxy.id);
        healed++;
        console.log(`    ✓ Restarted`);
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const health = await checkProxyHealth(proxy.id);
        if (health.healthy) {
          console.log(`    ✓ Healthy - Exit IP: ${health.exitIp}`);
        } else {
          console.log(`    ✗ Still unhealthy: ${health.error}`);
        }
      } catch (err: any) {
        failed++;
        console.error(`    ✗ Failed: ${err.message}`);
      }
    }
  }
  
  if (healed > 0 || failed > 0) {
    console.log(`  ✓ Healed ${healed} proxies${failed > 0 ? `, ${failed} failed` : ''}`);
  } else {
    console.log('  ✓ All proxies are healthy');
  }
  
  console.log('\n✓ Maintenance complete');
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