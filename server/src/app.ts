import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppContext } from './context.js';
import { errorHandler } from './errors.js';
import { createMcpServer } from './mcp/server.js';
import { compositionRoutes } from './routes/compositions.js';
import { libraryRoutes } from './routes/library.js';
import { settingsRoutes } from './routes/settings.js';

/** Zbudowany klient (vite build). W trybie dev klienta serwuje Vite z proxy do /api i /mcp. */
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.use('/api', settingsRoutes(ctx), libraryRoutes(ctx), compositionRoutes(ctx));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Nieznany adres API' });
  });

  // MCP bez sesji: każde żądanie dostaje własny serwer i transport.
  app.post('/mcp', async (req, res, next) => {
    try {
      const server = createMcpServer(ctx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      next(e);
    }
  });
  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ error: 'Serwer MCP działa bez sesji; używaj POST' });
  });

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get(/^\/(?!api\/|mcp).*/, (_req, res) => res.sendFile(`${CLIENT_DIST}/index.html`));
  }

  app.use(errorHandler);
  return app;
}
