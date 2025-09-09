import express from 'express';
import { createProxy, removeProxy, rotateProxy } from './docker';
import { registry } from './registry';
import { checkProxyHealth } from './health';
import { config } from './config';

const app = express();

app.use(express.json());

app.get('/proxies', async (_req, res) => {
  try {
    const proxies = await registry.list();
    res.json(proxies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/proxies', async (req, res) => {
  try {
    const { country, city, notes } = req.body;
    const proxy = await createProxy({ country, city, notes });
    
    setTimeout(async () => {
      await checkProxyHealth(proxy.id);
    }, 5000);
    
    res.status(201).json(proxy);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/proxies/:id', async (req, res) => {
  try {
    await removeProxy(req.params.id);
    res.status(204).send();
  } catch (err: any) {
    if (err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.post('/proxies/:id/rotate', async (req, res) => {
  try {
    const proxy = await rotateProxy(req.params.id);
    res.json(proxy);
  } catch (err: any) {
    if (err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.get('/proxies/:id/health', async (req, res) => {
  try {
    const result = await checkProxyHealth(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export function startApi(): void {
  if (!config.restEnabled) {
    return;
  }
  
  app.listen(config.restPort, '127.0.0.1', () => {
    console.log(`REST API listening on http://127.0.0.1:${config.restPort}`);
  });
}