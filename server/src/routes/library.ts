import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { TAG_STATUSES } from '@moniuszko/shared';
import type { AppContext } from '../context.js';
import { badRequest } from '../errors.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 500 } });

const listQuery = z.object({
  q: z.string().optional(),
  tagStatus: z.enum(TAG_STATUSES).optional(),
  category: z.string().optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  sort: z.enum(['newest', 'title', 'recent-use', 'relevance']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const metadataPatch = z
  .object({
    title: z.string(),
    description: z.string(),
    category: z.string().nullable(),
    tags: z.array(z.string()),
    sourceName: z.string().nullable(),
    author: z.string().nullable(),
    license: z.string().nullable(),
    tagStatus: z.enum(TAG_STATUSES),
  })
  .partial()
  .strict();

/** multer dekoduje nazwy plików jako latin1; przywracamy UTF-8 (polskie znaki). */
function fileName(f: Express.Multer.File): string {
  return Buffer.from(f.originalname, 'latin1').toString('utf8');
}

export function libraryRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get('/graphics', (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(ctx.library.repo.list(q));
  });

  r.get('/graphics/facets', (_req, res) => {
    res.json(ctx.library.repo.facets());
  });

  r.post('/graphics', upload.array('files'), (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw badRequest('Nie przesłano plików (pole "files")');
    const force = req.body?.force === '1' || req.body?.force === 'true';
    res.json(files.map((f) => ctx.library.importFile(fileName(f), f.buffer, { force })));
  });

  r.get('/graphics/:id', (req, res) => {
    res.json(ctx.library.detail(req.params.id));
  });

  r.patch('/graphics/:id', (req, res) => {
    res.json(ctx.library.updateMetadata(req.params.id, metadataPatch.parse(req.body)));
  });

  r.delete('/graphics/:id', (req, res) => {
    ctx.library.delete(req.params.id);
    res.status(204).end();
  });

  r.post('/graphics/:id/file', upload.single('file'), (req, res) => {
    if (!req.file) throw badRequest('Nie przesłano pliku (pole "file")');
    res.json(ctx.library.replaceFile(String(req.params.id), fileName(req.file), req.file.buffer));
  });

  r.get('/graphics/:id/svg', (req, res) => {
    res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(ctx.library.readSvg(req.params.id));
  });

  r.get('/graphics/:id/download', (req, res) => {
    const g = ctx.library.get(req.params.id);
    const name = (g.sourceName ?? `${g.id}.svg`).replace(/["\\]/g, '');
    res
      .type('image/svg+xml')
      .set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(ctx.library.readSvg(req.params.id));
  });

  r.get('/graphics/:id/original', (req, res) => {
    // Oryginał nie przeszedł sanityzacji, więc nie może być renderowany jako obraz w aplikacji.
    res.type('text/plain; charset=utf-8').send(ctx.library.readOriginal(req.params.id));
  });

  r.get('/graphics/:id/thumbnail.png', (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(ctx.library.thumbnailPath(req.params.id));
  });

  return r;
}
