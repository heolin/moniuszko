import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from '../lib/workspace.js';
import { listDesignSystems } from '../lib/designSystem.js';
import { rejectLegacyFile } from '../lib/config.js';

export function designSystemsRouter(ws: Workspace): Router {
  const router = Router();
  router.get('/design-systems', async (_req, res, next) => {
    try {
      res.json(await listDesignSystems(ws));
    } catch (err) {
      next(err);
    }
  });

  // Editor configuration (.moniuszko.json in the workspace root):
  // toolbar layout overrides etc. Missing/invalid file → {}.
  router.get('/editor-config', async (_req, res, next) => {
    try {
      rejectLegacyFile(ws.root, '.revealeditor.json', '.moniuszko.json');
    } catch (err) {
      console.error(String(err));
      next(err);
      return;
    }
    try {
      const raw = await fs.readFile(path.join(ws.root, '.moniuszko.json'), 'utf8');
      res.json(JSON.parse(raw));
    } catch {
      res.json({});
    }
  });
  return router;
}

export function themesRouter(revealDistDir: string): Router {
  const router = Router();

  router.get('/themes', async (_req, res, next) => {
    try {
      const dir = path.join(revealDistDir, 'theme');
      const files = await fs.readdir(dir);
      const themes = files
        .filter((f) => f.endsWith('.css'))
        .map((f) => f.replace(/\.css$/, ''))
        .sort();
      res.json(themes);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
