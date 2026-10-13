import fs from 'node:fs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphicDto, ImportItemResult } from '@moniuszko/shared';
import { createApp } from '../app.js';
import { makeCtx, sample, type TestCtx } from '../test/helpers.js';

const EVIL = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 10">
  <script>alert(1)</script>
  <rect width="10" height="10" fill="#ff0000" onclick="steal()" onmouseover="x()"/>
  <use xlink:href="http://example.com/a.svg#x"/>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
</svg>`;

let t: TestCtx;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  t = makeCtx({ normalizeSvg: false });
  app = createApp(t.ctx);
});
afterEach(() => t.cleanup());

async function importFiles(files: [string, Buffer][], force = false): Promise<ImportItemResult[]> {
  let req = request(app).post('/api/graphics');
  for (const [name, buf] of files) req = req.attach('files', buf, name);
  if (force) req = req.field('force', '1');
  const res = await req.expect(200);
  return res.body as ImportItemResult[];
}

describe('import grafik', () => {
  it('dodaje kilka plików, odrzuca nie-SVG i oczyszcza skrypty', async () => {
    const results = await importFiles([
      ['drzewo.svg', sample('drzewo.svg')],
      ['zły.svg', Buffer.from(EVIL)],
      ['obraz.png', Buffer.from('PNG')],
      ['zepsuty.svg', Buffer.from('<svg><rect></svg>')],
    ]);
    expect(results.map((r) => r.status)).toEqual(['added', 'added', 'rejected', 'rejected']);
    const evil = results[1]!;
    expect(evil.status === 'added' && evil.warnings.join(' ')).toMatch(/<script>.*atrybut onclick.*atrybut xlink:href z zewnętrznym adresem/);
    const id = evil.status === 'added' ? evil.graphic.id : '';
    const res = await request(app).get(`/api/graphics/${id}/svg`).expect(200).expect('Content-Type', /image\/svg\+xml/);
    const svg = (res.body as Buffer).toString('utf8');
    expect(svg).toContain('<rect');
    expect(svg).not.toMatch(/script|onclick|onmouseover|foreignObject|example\.com/);
    expect(fs.existsSync(t.ctx.workspace.graphicThumbPath(id))).toBe(true);
    // oryginał zostaje bez zmian
    expect(t.ctx.library.readOriginal(id)).toContain('<script>');
  });

  it('wykrywa duplikat, a z force dodaje mimo to', async () => {
    await importFiles([['drzewo.svg', sample('drzewo.svg')]]);
    const [dup] = await importFiles([['kopia.svg', sample('drzewo.svg')]]);
    expect(dup!.status).toBe('duplicate');
    const [forced] = await importFiles([['kopia.svg', sample('drzewo.svg')]], true);
    expect(forced!.status).toBe('added');
  });

  it('zapisuje polskie nazwy plików, wymiary i kolory', async () => {
    const [r] = await importFiles([['słońce.svg', sample('slonce.svg')]]);
    const g = (r as { graphic: GraphicDto }).graphic;
    expect(g.title).toBe('słońce');
    expect(g.sourceName).toBe('słońce.svg');
    expect([g.width, g.height, g.viewBox]).toEqual([100, 100, '0 0 100 100']);
    expect(g.colors).toContain('#e9a72b');
    expect(g.tagStatus).toBe('untagged');
  });
});

describe('metadane i wyszukiwanie', () => {
  async function addTagged() {
    const results = await importFiles([
      ['drzewo.svg', sample('drzewo.svg')],
      ['dom.svg', sample('dom.svg')],
      ['kwiat.svg', sample('kwiat.svg')],
    ]);
    const [tree, house, flower] = results.map((r) => (r as { graphic: GraphicDto }).graphic.id);
    await request(app)
      .patch(`/api/graphics/${tree}`)
      .send({ title: 'Drzewo liściaste', description: 'Zielona korona', category: 'Rośliny', tags: ['Drzewo', ' lato ', 'drzewo'], tagStatus: 'ai' })
      .expect(200);
    await request(app)
      .patch(`/api/graphics/${house}`)
      .send({ title: 'Dom wiejski', description: 'Żółty dom z czerwonym dachem', category: 'Budynki', tags: ['wieś'], tagStatus: 'reviewed' })
      .expect(200);
    return { tree: tree!, house: house!, flower: flower! };
  }

  it('normalizuje tagi i zwraca je posortowane', async () => {
    const { tree } = await addTagged();
    const g = (await request(app).get(`/api/graphics/${tree}`).expect(200)).body;
    expect(g.tags).toEqual(['drzewo', 'lato']);
    expect(g.tagStatus).toBe('ai');
  });

  it('szuka pełnotekstowo, także bez polskich znaków i po początku słowa', async () => {
    const { tree, house } = await addTagged();
    const ids = async (q: string) =>
      ((await request(app).get('/api/graphics').query({ q }).expect(200)).body.items as GraphicDto[]).map((g) => g.id);
    expect(await ids('liściaste')).toEqual([tree]);
    expect(await ids('zolty')).toEqual([house]);
    expect(await ids('drze')).toEqual([tree]);
    expect(await ids('wies')).toEqual([house]);
    expect(await ids('drzewo dom')).toEqual([]);
  });

  it('filtruje po statusie, kategorii i tagach oraz liczy fasety', async () => {
    const { tree, flower } = await addTagged();
    const list = async (query: Record<string, string>) =>
      ((await request(app).get('/api/graphics').query(query).expect(200)).body.items as GraphicDto[]).map((g) => g.id);
    expect(await list({ tagStatus: 'untagged' })).toEqual([flower]);
    expect(await list({ category: 'Rośliny' })).toEqual([tree]);
    expect(await list({ category: '__none__' })).toEqual([flower]);
    expect(await list({ tags: 'lato' })).toEqual([tree]);
    const f = (await request(app).get('/api/graphics/facets').expect(200)).body;
    expect(f.total).toBe(3);
    expect(f.tagStatus).toEqual({ untagged: 1, ai: 1, reviewed: 1 });
    expect(f.tags).toContainEqual({ name: 'drzewo', count: 1 });
  });

  it('podmiana pliku podnosi wersję i zachowuje metadane', async () => {
    const { tree } = await addTagged();
    const res = await request(app).post(`/api/graphics/${tree}/file`).attach('file', sample('kwiat.svg'), 'kwiat.svg').expect(200);
    expect(res.body.graphic.version).toBe(2);
    expect(res.body.graphic.title).toBe('Drzewo liściaste');
    expect(res.body.graphic.colors).toContain('#d9637a');
  });

  it('usuwa grafikę razem z plikami i wpisem w indeksie', async () => {
    const { tree } = await addTagged();
    await request(app).delete(`/api/graphics/${tree}`).expect(204);
    await request(app).get(`/api/graphics/${tree}`).expect(404);
    expect(fs.existsSync(t.ctx.workspace.graphicPath(tree))).toBe(false);
    const items = (await request(app).get('/api/graphics').query({ q: 'liściaste' }).expect(200)).body.items;
    expect(items).toEqual([]);
  });

  it('odrzuca nieznane pola metadanych', async () => {
    const { tree } = await addTagged();
    await request(app).patch(`/api/graphics/${tree}`).send({ colour: 'red' }).expect(400);
  });
});

describe('normalizacja svgo', () => {
  it('zachowuje viewBox', async () => {
    const n = makeCtx({ normalizeSvg: true });
    try {
      const r = n.ctx.library.importFile('dom.svg', sample('dom.svg'));
      expect(r.status).toBe('added');
      const id = r.status === 'added' ? r.graphic.id : '';
      expect(n.ctx.library.readSvg(id)).toContain('viewBox="0 0 100 100"');
    } finally {
      n.cleanup();
    }
  });
});
