import express from 'express';
import type { RendererRuntime } from './service/render-runtime.js';

export function createApp(runtime?: Pick<RendererRuntime, 'status'>): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'rw-map-rendering', runtime: runtime?.status() });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}
