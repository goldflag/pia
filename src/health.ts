import { registry } from "./registry";
import { fetchExitIp } from "./docker";
import { config } from "./config";
import { SocksClient } from 'socks';

export interface HealthCheckResult {
  proxyId: string;
  healthy: boolean;
  exitIp?: string;
  error?: string;
}

export async function checkProxyHealth(
  proxyId: string
): Promise<HealthCheckResult> {
  const proxy = await registry.get(proxyId);

  if (!proxy) {
    return { proxyId, healthy: false, error: "Proxy not found" };
  }

  try {
    // Test SOCKS5 proxy by actually making a request through it
    const exitIp = await testProxyAndGetIp("127.0.0.1", proxy.port);

    if (!exitIp) {
      // Fallback to checking container's exit IP
      const containerIp = await fetchExitIp(proxy.containerId);
      if (!containerIp) {
        await registry.update(proxyId, { healthy: false });
        return { proxyId, healthy: false, error: "Proxy not responding" };
      }
      await registry.update(proxyId, { healthy: true, exitIp: containerIp });
      return { proxyId, healthy: true, exitIp: containerIp };
    }

    await registry.update(proxyId, {
      healthy: true,
      exitIp,
    });

    return { proxyId, healthy: true, exitIp };
  } catch (err: any) {
    await registry.update(proxyId, { healthy: false });
    return { proxyId, healthy: false, error: err.message };
  }
}

export async function healthCheckAll(): Promise<HealthCheckResult[]> {
  const proxies = await registry.list();

  // Check all proxies in parallel
  const results = await Promise.all(
    proxies.map((proxy) =>
      checkProxyHealth(proxy.id).catch((err) => ({
        proxyId: proxy.id,
        healthy: false,
        error: err.message,
      }))
    )
  );

  return results;
}

export async function bulkHealthCheck(
  proxyIds: string[]
): Promise<Map<string, HealthCheckResult>> {
  // Check all proxies in parallel
  const results = await Promise.all(
    proxyIds.map((id) =>
      checkProxyHealth(id).catch((err) => ({
        proxyId: id,
        healthy: false,
        error: err.message,
      }))
    )
  );

  // Return as a map for easy lookup
  const resultMap = new Map<string, HealthCheckResult>();
  for (const result of results) {
    resultMap.set(result.proxyId, result);
  }

  return resultMap;
}

export async function healProxies(): Promise<void> {
  const Docker = require("dockerode");
  const docker = new Docker();
  const { rotateProxy, reconcileContainers } = await import("./docker");

  console.log("Step 1: Reconciling with Docker containers...");
  await reconcileContainers();

  // Get all containers that are actually running
  const allContainers = await docker.listContainers({
    all: true,
    filters: { label: ["proxyfarm=true"] },
  });
  const runningContainerIds = new Set(allContainers.map((c: any) => c.Id));

  let proxies = await registry.list();

  // Step 2: Remove entries for containers that don't exist
  console.log("Step 2: Removing entries for missing containers...");
  let removedMissing = 0;
  for (const proxy of proxies) {
    if (!runningContainerIds.has(proxy.containerId)) {
      console.log(
        `  Removing entry for missing container: ${proxy.id} (port ${proxy.port})`
      );
      await registry.remove(proxy.id);
      removedMissing++;
    }
  }

  if (removedMissing > 0) {
    console.log(`  ✓ Removed ${removedMissing} entries for missing containers`);
    proxies = await registry.list();
  } else {
    console.log("  ✓ No missing containers found");
  }

  // Step 3: Detect and remove duplicates with port conflicts
  console.log("Step 3: Removing duplicate proxies...");
  const portMap = new Map<number, (typeof proxies)[0][]>();
  for (const proxy of proxies) {
    if (!portMap.has(proxy.port)) {
      portMap.set(proxy.port, []);
    }
    portMap.get(proxy.port)!.push(proxy);
  }

  let removedDuplicates = 0;
  for (const [port, proxyList] of portMap) {
    if (proxyList.length > 1) {
      console.log(
        `  Port ${port} has ${proxyList.length} entries, cleaning up...`
      );

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
    console.log("  ✓ No duplicates found");
  }

  // Step 4: Remove orphaned containers
  console.log("Step 4: Removing orphaned containers...");
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
    console.log("  ✓ No orphaned containers found");
  }

  // Step 5: Check current health and heal unhealthy proxies
  console.log("Step 5: Checking health and healing unhealthy proxies...");
  const updatedProxies = await registry.list();
  let healed = 0;
  let failed = 0;

  // Do a fresh health check on all proxies in parallel
  console.log("  Running fresh health checks on all proxies...");
  const healthResults = await bulkHealthCheck(updatedProxies.map((p) => p.id));

  // Find unhealthy proxies
  const unhealthyProxies = updatedProxies.filter((proxy) => {
    const health = healthResults.get(proxy.id);
    return health && !health.healthy;
  });

  const unhealthyCount = unhealthyProxies.length;

  if (unhealthyCount > 0) {
    console.log(`  Found ${unhealthyCount} unhealthy proxies`);

    for (const proxy of unhealthyProxies) {
      const health = healthResults.get(proxy.id)!;
      console.log(
        `  Unhealthy proxy: ${proxy.id} (port ${proxy.port}) - ${health.error}`
      );

      if (proxy.restarts >= 3) {
        console.log(`    Skipped: failed ${proxy.restarts} times`);
        continue;
      }

      try {
        console.log(`    Restarting proxy...`);
        await rotateProxy(proxy.id);
        healed++;
        console.log(`    ✓ Restarted`);

        await new Promise((resolve) => setTimeout(resolve, 5000));

        const newHealth = await checkProxyHealth(proxy.id);
        if (newHealth.healthy) {
          console.log(`    ✓ Now healthy - Exit IP: ${newHealth.exitIp}`);
        } else {
          console.log(`    ✗ Still unhealthy: ${newHealth.error}`);
        }
      } catch (err: any) {
        failed++;
        console.error(`    ✗ Failed to restart: ${err.message}`);
      }
    }
  }

  if (unhealthyCount === 0) {
    console.log("  ✓ All proxies are healthy");
  } else if (healed > 0 || failed > 0) {
    console.log(
      `  ✓ Found ${unhealthyCount} unhealthy, healed ${healed} proxies${
        failed > 0 ? `, ${failed} failed` : ""
      }`
    );
  } else {
    console.log(
      `  Found ${unhealthyCount} unhealthy proxies but none were healed (may have exceeded restart limit)`
    );
  }

  console.log("\n✓ Maintenance complete");
}

async function autoHealUnhealthyProxy(proxyId: string): Promise<boolean> {
  const proxy = await registry.get(proxyId);

  if (!proxy || proxy.healthy) {
    return false; // Nothing to heal
  }

  // Skip if already tried too many times
  if (proxy.restarts >= 3) {
    console.log(
      `[AutoHeal] Skipping ${proxyId} (port ${proxy.port}) - exceeded restart limit (${proxy.restarts} attempts)`
    );
    return false;
  }

  try {
    console.log(
      `[AutoHeal] Healing unhealthy proxy ${proxyId} (port ${proxy.port})`
    );
    const { rotateProxy } = await import("./docker");
    await rotateProxy(proxyId);

    // Wait a bit for the container to stabilize
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Re-check health
    const health = await checkProxyHealth(proxyId);
    if (health.healthy) {
      console.log(
        `[AutoHeal] ✓ Proxy ${proxyId} is now healthy - Exit IP: ${health.exitIp}`
      );
      return true;
    } else {
      console.log(
        `[AutoHeal] ✗ Proxy ${proxyId} still unhealthy after restart: ${health.error}`
      );
      return false;
    }
  } catch (err: any) {
    console.error(`[AutoHeal] Failed to heal proxy ${proxyId}: ${err.message}`);
    return false;
  }
}

let healthCheckInterval: NodeJS.Timeout | null = null;

export function startHealthCheck(): void {
  if (healthCheckInterval) {
    return;
  }

  const runCheck = async () => {
    try {
      const results = await healthCheckAll();
      console.log(
        `[HealthCheck] Unhealthy proxies: ${results
          .filter((r) => !r.healthy)
          .map((r) => `${r.proxyId} - ${r.exitIp}`)
          .join(", ")}`
      );

      // Auto-heal unhealthy proxies if enabled
      if (config.autoHealEnabled) {
        const unhealthyProxies = results.filter((r) => !r.healthy);

        if (unhealthyProxies.length > 0) {
          console.log(
            `[AutoHeal] Found ${unhealthyProxies.length} unhealthy proxies, attempting auto-heal...`
          );

          // Heal proxies in parallel (but limit concurrency to avoid overwhelming the system)
          const MAX_CONCURRENT_HEALS = 5;
          for (
            let i = 0;
            i < unhealthyProxies.length;
            i += MAX_CONCURRENT_HEALS
          ) {
            const batch = unhealthyProxies.slice(i, i + MAX_CONCURRENT_HEALS);
            await Promise.all(
              batch.map((r) => autoHealUnhealthyProxy(r.proxyId))
            );
          }
        }
      }
    } catch (err: any) {
      console.error("Health check error:", err.message);
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

async function testProxyAndGetIp(
  host: string,
  port: number
): Promise<string | null> {
  try {
    const url = new URL(config.exitIpCheckUrl);
    const https = url.protocol === 'https:' ? require('https') : require('http');

    // Create a SOCKS5 connection
    const info = await SocksClient.createConnection({
      proxy: {
        host: host,
        port: port,
        type: 5, // SOCKS5
      },
      command: 'connect',
      destination: {
        host: url.hostname,
        port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80')),
      },
      timeout: 5000,
    });

    return new Promise((resolve) => {
      const options = {
        socket: info.socket,
        host: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Host': url.hostname,
        },
      };

      const req = https.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => (data += chunk));
        res.on('end', () => {
          info.socket.end();
          const ip = data.trim().match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
          resolve(ip ? ip[0] : null);
        });
      });

      req.on('error', () => {
        info.socket.end();
        resolve(null);
      });

      req.end();
    });
  } catch (err) {
    return null;
  }
}
