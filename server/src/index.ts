#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { AppContext } from './context.js';

const { values } = parseArgs({
  options: {
    config: { type: 'string', default: 'moniuszko.config.json' },
    port: { type: 'string' },
  },
});

const config = loadConfig(values.config!);
const ctx = new AppContext(config);
const app = createApp(ctx);
const port = values.port ? Number(values.port) : config.port;

const server = app.listen(port, () => {
  console.log(`Moniuszko: http://localhost:${port}`);
  console.log(`MCP:       http://localhost:${port}/mcp`);
  console.log(`Workspace: ${config.workspace}`);
});

function shutdown() {
  server.close();
  ctx.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
