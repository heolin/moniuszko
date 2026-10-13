import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest } from '../errors.js';

const patchBody = z
  .object({
    workspace: z.string().min(1),
    libraryDir: z.string().min(1),
    compositionsDir: z.string().min(1),
    exportsDir: z.string().min(1),
    normalizeSvg: z.boolean(),
    warnDuplicates: z.boolean(),
    moveFiles: z.boolean(),
  })
  .partial()
  .strict();

export function settingsRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get('/settings', (_req, res) => {
    res.json(ctx.settings());
  });

  r.put('/settings', (req, res) => {
    const body = patchBody.parse(req.body);
    for (const key of ['workspace', 'libraryDir', 'compositionsDir', 'exportsDir'] as const) {
      const v = body[key];
      if (v !== undefined && !path.isAbsolute(v)) throw badRequest(`Ścieżka ${key} musi być bezwzględna`);
    }
    res.json(ctx.reconfigure(body));
  });

  /** Podfoldery wskazanego folderu — dla okna wyboru folderu w ustawieniach i eksporcie. */
  r.get('/fs/dirs', (req, res) => {
    const dir = z.string().min(1).parse(req.query.path ?? ctx.config.workspace);
    if (!path.isAbsolute(dir)) throw badRequest('Ścieżka musi być bezwzględna');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw badRequest(`Folder nie istnieje: ${dir}`);
    const dirs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
    res.json({ path: path.resolve(dir), parent: path.dirname(path.resolve(dir)), dirs });
  });

  r.get('/events', (_req, res) => {
    ctx.events.attach(res);
  });

  return r;
}
