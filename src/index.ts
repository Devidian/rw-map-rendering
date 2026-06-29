import { createServer } from 'node:http';
import { createApp } from './server.js';
import { startRendererRuntime } from './service/render-runtime.js';
import { AppConfig } from './utils/app-config.js';
import { defaultLogger } from './utils/logger.js';

const runtime = startRendererRuntime();
const app = createApp(runtime);

createServer(app).listen(AppConfig.port, AppConfig.host, () => {
  defaultLogger.info(`RW map rendering health server listening on http://${AppConfig.host}:${AppConfig.port}`);
});

process.once('SIGINT', () => runtime.stop());
process.once('SIGTERM', () => runtime.stop());
