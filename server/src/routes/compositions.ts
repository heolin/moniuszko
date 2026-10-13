import { Router } from 'express';
import { z } from 'zod';
import { COMPOSITION_STATUSES } from '@moniuszko/shared';
import type { AppContext } from '../context.js';

const createBody = z.object({
  name: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

const saveBody = z.object({
  svg: z.string().min(1),
  revision: z.number(),
  clientId: z.string().optional(),
});

const patchBody = z
  .object({ name: z.string().min(1), status: z.enum(COMPOSITION_STATUSES) })
  .partial()
  .strict();

const exportBody = z.object({
  mode: z.enum(['standalone', 'linked']),
  dir: z.string().optional(),
  fileName: z.string().optional(),
});

export function compositionRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get('/compositions', (_req, res) => {
    res.json(ctx.compositions.list());
  });

  r.post('/compositions', (req, res) => {
    const body = createBody.parse(req.body);
    res.status(201).json(ctx.compositions.create({ ...body, author: 'human' }));
  });

  r.get('/compositions/:id', (req, res) => {
    res.json(ctx.compositions.read(req.params.id));
  });

  r.put('/compositions/:id', (req, res) => {
    const body = saveBody.parse(req.body);
    res.json(ctx.compositions.save(req.params.id, body.svg, body.revision, { source: 'ui', clientId: body.clientId }));
  });

  r.patch('/compositions/:id', (req, res) => {
    const clientId = typeof req.headers['x-client-id'] === 'string' ? req.headers['x-client-id'] : undefined;
    res.json(ctx.compositions.patchMeta(req.params.id, patchBody.parse(req.body), { source: 'ui', clientId }));
  });

  r.delete('/compositions/:id', (req, res) => {
    ctx.compositions.delete(req.params.id);
    res.status(204).end();
  });

  r.post('/compositions/:id/duplicate', (req, res) => {
    const name = z.object({ name: z.string().min(1).optional() }).parse(req.body ?? {}).name;
    res.status(201).json(ctx.compositions.duplicate(req.params.id, name));
  });

  r.get('/compositions/:id/thumbnail.png', (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(ctx.compositions.thumbnailPath(req.params.id));
  });

  r.post('/compositions/:id/export', (req, res) => {
    const body = exportBody.parse(req.body);
    const out = ctx.compositions.export(req.params.id, body.mode, { dir: body.dir, fileName: body.fileName });
    res.json({ path: out.path });
  });

  r.get('/compositions/:id/download', (req, res) => {
    const svg = ctx.compositions.exportStandalone(req.params.id);
    res
      .type('image/svg+xml')
      .set('Content-Disposition', `attachment; filename="${req.params.id}.svg"`)
      .send(svg);
  });

  return r;
}
