import Docker from 'dockerode';
import { randomUUID } from 'crypto';
import { ProxyRecord, CreateProxyOptions } from './types';
import { config } from './config';
import { registry } from './registry';

const docker = new Docker();

export async function createProxy(options: CreateProxyOptions = {}): Promise<ProxyRecord> {
  const id = randomUUID();
  const port = await registry.allocatePort();
  
  const country = options.country || config.defaultCountry;
  const city = options.city || config.defaultCity;

  const env: string[] = [
    'VPN_SERVICE_PROVIDER=private internet access',
    'VPN_TYPE=openvpn',
    'OPENVPN_PROTOCOL=udp',
    'HTTPPROXY=on',
    'HTTPPROXY_LISTENING_ADDRESS=:8888',
    'HTTPPROXY_STEALTH=on',
    'SHADOWSOCKS=off',
    'UPDATER_PERIOD=24h',
    'TZ=UTC',
    'LOG_LEVEL=info'
  ];

  if (config.piaUsername && config.piaPassword) {
    env.push(`OPENVPN_USER=${config.piaUsername}`);
    env.push(`OPENVPN_PASSWORD=${config.piaPassword}`);
  } else {
    throw new Error('PIA requires username and password for OpenVPN');
  }

  // PIA with Gluetun - let's not specify regions for now
  // as Gluetun seems to have issues with PIA region selection
  // It will auto-select the best server
  
  // Store region info in labels for reference only
  const regionLabel = country && city ? `${country}-${city}` : 
                      country ? country : 'auto';

  const containerInfo = await docker.createContainer({
    Image: config.vpnImage,
    name: `pf_${id}`,
    Env: env,
    ExposedPorts: {
      '8888/tcp': {}
    },
    HostConfig: {
      CapAdd: ['NET_ADMIN'],
      Devices: [{
        PathOnHost: '/dev/net/tun',
        PathInContainer: '/dev/net/tun',
        CgroupPermissions: 'rwm'
      }],
      PortBindings: {
        '8888/tcp': [{ HostPort: String(port) }]
      },
      RestartPolicy: { Name: 'unless-stopped' }
    },
    Labels: {
      'proxyfarm': 'true',
      'proxyfarm.id': id,
      'proxyfarm.port': String(port),
      'proxyfarm.region': regionLabel,
      ...(country ? { 'proxyfarm.country': country } : {}),
      ...(city ? { 'proxyfarm.city': city } : {})
    }
  });

  const container = docker.getContainer(containerInfo.id);
  await container.start();

  const proxy: ProxyRecord = {
    id,
    containerId: containerInfo.id,
    port,
    country,
    city,
    exitIp: undefined,
    healthy: false,
    restarts: 0,
    createdAt: new Date().toISOString(),
    notes: options.notes
  };

  await registry.add(proxy);

  return proxy;
}

export async function removeProxy(id: string): Promise<void> {
  const proxy = await registry.get(id);
  if (!proxy) {
    throw new Error(`Proxy ${id} not found`);
  }

  try {
    const container = docker.getContainer(proxy.containerId);
    await container.stop();
    await container.remove();
  } catch (err: any) {
    if (err.statusCode !== 404) {
      throw err;
    }
  }

  await registry.remove(id);
}

export async function rotateProxy(id: string): Promise<ProxyRecord> {
  const proxy = await registry.get(id);
  if (!proxy) {
    throw new Error(`Proxy ${id} not found`);
  }

  const container = docker.getContainer(proxy.containerId);
  
  try {
    await container.restart();
  } catch (err: any) {
    if (err.statusCode === 404) {
      return await createProxy({
        country: proxy.country,
        city: proxy.city,
        notes: proxy.notes
      });
    }
    throw err;
  }

  await registry.update(id, { 
    restarts: proxy.restarts + 1,
    exitIp: undefined,
    healthy: false
  });

  proxy.restarts++;
  proxy.exitIp = undefined;
  proxy.healthy = false;

  return proxy;
}

export async function fetchExitIp(containerId: string): Promise<string | null> {
  try {
    const sidecar = await docker.createContainer({
      Image: 'curlimages/curl:latest',
      Cmd: ['-s', '--max-time', '10', config.exitIpCheckUrl],
      HostConfig: {
        NetworkMode: `container:${containerId}`,
        AutoRemove: true
      }
    });

    const stream = await sidecar.attach({ stream: true, stdout: true, stderr: true });
    await sidecar.start();

    return new Promise((resolve) => {
      let data = '';
      let timeout: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timeout);
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
      };

      timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 15000);

      stream.on('data', (chunk: any) => {
        const text = chunk.toString('utf8');
        const cleaned = text.replace(/[\x00-\x1F\x7F]/g, '').trim();
        if (cleaned) data += cleaned;
      });

      stream.on('end', () => {
        cleanup();
        const ip = data.split('\n').find(line => 
          line.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
        );
        resolve(ip || null);
      });

      stream.on('error', () => {
        cleanup();
        resolve(null);
      });
    });
  } catch (err) {
    return null;
  }
}

export async function testHttpProxyConnection(host: string, port: number): Promise<boolean> {
  const net = require('net');
  
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function reconcileContainers(): Promise<void> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ['proxyfarm=true'] }
  });

  const registryProxies = await registry.list();
  const registryByContainerId = new Map(
    registryProxies.map(p => [p.containerId, p])
  );

  for (const container of containers) {
    const id = container.Labels['proxyfarm.id'];
    const port = parseInt(container.Labels['proxyfarm.port'], 10);
    
    if (!registryByContainerId.has(container.Id)) {
      const proxy: ProxyRecord = {
        id: id || randomUUID(),
        containerId: container.Id,
        port,
        country: container.Labels['proxyfarm.country'],
        city: container.Labels['proxyfarm.city'],
        exitIp: undefined,
        healthy: container.State === 'running',
        restarts: 0,
        createdAt: new Date(container.Created * 1000).toISOString()
      };
      
      await registry.add(proxy);
    }
  }

  for (const proxy of registryProxies) {
    const containerExists = containers.some(c => c.Id === proxy.containerId);
    if (!containerExists) {
      await registry.remove(proxy.id);
    }
  }
}