import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfigFile, DEFAULT_CONFIG } from '../config.js';
import { AppContext, type Logger } from '../context.js';

export const SAMPLES = fileURLToPath(new URL('../../../samples', import.meta.url));

export function sample(name: string): Buffer {
  return fs.readFileSync(path.join(SAMPLES, name));
}

export type TestCtx = { ctx: AppContext; dir: string; logs: string[]; cleanup(): void };

/** Kontekst aplikacji na świeżym workspace w katalogu tymczasowym. */
export function makeCtx(overrides: Partial<typeof DEFAULT_CONFIG> = {}): TestCtx {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moniuszko-test-'));
  const configPath = path.join(dir, 'moniuszko.config.json');
  saveConfigFile(configPath, { ...DEFAULT_CONFIG, ...overrides });
  const logs: string[] = [];
  const log: Logger = {
    info: (m) => logs.push(`info: ${m}`),
    warn: (m) => logs.push(`warn: ${m}`),
    error: (m) => logs.push(`error: ${m}`),
  };
  const ctx = new AppContext(loadConfig(configPath, () => {}), log);
  return {
    ctx,
    dir,
    logs,
    cleanup() {
      ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
