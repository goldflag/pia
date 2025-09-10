import { ProxyRecord } from './types';
import { config } from './config';
import * as fs from 'fs';
import * as path from 'path';

class Registry {
  private dataPath: string;
  private data: Map<string, ProxyRecord>;

  constructor() {
    this.dataPath = config.dbPath.replace('.db', '.json');
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.data = new Map();
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.dataPath)) {
      try {
        const content = fs.readFileSync(this.dataPath, 'utf8');
        const records = JSON.parse(content) as ProxyRecord[];
        records.forEach(record => this.data.set(record.id, record));
      } catch (err) {
        console.error('Failed to load registry:', err);
      }
    }
  }

  private save(): void {
    const records = Array.from(this.data.values());
    fs.writeFileSync(this.dataPath, JSON.stringify(records, null, 2));
  }

  async add(proxy: ProxyRecord): Promise<void> {
    this.data.set(proxy.id, proxy);
    this.save();
  }

  async get(id: string): Promise<ProxyRecord | null> {
    return this.data.get(id) || null;
  }

  async getByPort(port: number): Promise<ProxyRecord | null> {
    for (const proxy of this.data.values()) {
      if (proxy.port === port) return proxy;
    }
    return null;
  }

  async list(): Promise<ProxyRecord[]> {
    return Array.from(this.data.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async update(id: string, updates: Partial<ProxyRecord>): Promise<void> {
    const proxy = this.data.get(id);
    if (!proxy) return;
    
    Object.assign(proxy, updates);
    this.save();
  }

  async remove(id: string): Promise<void> {
    this.data.delete(id);
    this.save();
  }

  async getUsedPorts(): Promise<Set<number>> {
    // Get ports from registry
    const registryPorts = new Set(Array.from(this.data.values()).map(p => p.port));
    
    // Also check actual Docker containers to avoid conflicts
    try {
      const Docker = require('dockerode');
      const docker = new Docker();
      const containers = await docker.listContainers({
        all: true,
        filters: { label: ['proxyfarm=true'] }
      });
      
      // Add ports from actual containers
      for (const container of containers) {
        const portLabel = container.Labels['proxyfarm.port'];
        if (portLabel) {
          registryPorts.add(parseInt(portLabel, 10));
        }
      }
    } catch (err) {
      // If we can't check Docker, just use registry ports
      console.warn('Could not check Docker containers for ports:', err);
    }
    
    return registryPorts;
  }

  async allocatePort(exclude?: Set<number>): Promise<number> {
    const usedPorts = await this.getUsedPorts();
    
    for (let port = config.portRangeStart; port <= config.portRangeEnd; port++) {
      if (!usedPorts.has(port) && (!exclude || !exclude.has(port))) {
        return port;
      }
    }
    
    throw new Error('No free ports available in configured range');
  }

  close(): void {
    this.save();
  }
}

// Singleton instance
export const registry = new Registry();