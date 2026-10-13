import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { createApp } from '../server/dist/app.js';
import { DEFAULT_CONFIG, loadConfig, saveConfigFile } from '../server/dist/config.js';
import { AppContext } from '../server/dist/context.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'client', 'dist');
export const SAMPLES = path.join(ROOT, 'samples');

export type Harness = { ctx: AppContext; origin: string; dir: string; close(): Promise<void> };

/**
 * Aplikacja na świeżym workspace w katalogu tymczasowym, nasłuchująca na losowym porcie
 * 127.0.0.1 tylko na czas jednego testu; close() zamyka serwer i usuwa workspace. Serwer
 * podaje też zbudowanego klienta (client/dist), więc wymaga wcześniejszego `npm run build`.
 */
export async function connect(page: Page): Promise<Harness> {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('Brak client/dist; uruchom npm run build');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moniuszko-e2e-'));
  const configPath = path.join(dir, 'moniuszko.config.json');
  saveConfigFile(configPath, { ...DEFAULT_CONFIG, normalizeSvg: false });
  const ctx = new AppContext(loadConfig(configPath, () => {}), { info() {}, warn() {}, error: (m) => console.error(m) });
  const server = http.createServer(createApp(ctx));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  page.on('pageerror', (e) => console.error('Błąd strony:', e));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('Konsola:', m.text());
  });

  return {
    ctx,
    origin,
    dir,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
