import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applySceneOps,
  estimateTextMeasurer,
  parseScene,
  serializeScene,
  type CompositionWithSvgDto,
  type ServerEvent,
} from '@moniuszko/shared';
import { createApp } from '../app.js';
import { makeCtx, sample, type TestCtx } from '../test/helpers.js';
import { slugify } from './service.js';

let t: TestCtx;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  t = makeCtx({ normalizeSvg: false });
  app = createApp(t.ctx);
});
afterEach(() => t.cleanup());

function addGraphic(name: string): string {
  const r = t.ctx.library.importFile(name, sample(name));
  if (r.status !== 'added') throw new Error(`import ${name}: ${r.status}`);
  return r.graphic.id;
}

async function withGraphics(id: string, graphicIds: string[]): Promise<CompositionWithSvgDto> {
  const comp = (await request(app).get(`/api/compositions/${id}`).expect(200)).body as CompositionWithSvgDto;
  const { scene, meta } = parseScene(comp.svg);
  const r = await applySceneOps(
    scene,
    graphicIds.map((g, i) => ({ op: 'insert_graphic' as const, graphicId: g, layer: 'Obiekty', x: 100 + i * 200, y: 100 })),
    {
      measurer: estimateTextMeasurer,
      loadGraphic: async (gid) => ({ svg: t.ctx.library.readSvg(gid), version: 1, title: gid }),
    },
  );
  const saved = await request(app)
    .put(`/api/compositions/${id}`)
    .send({ svg: serializeScene(r.scene, meta), revision: comp.revision })
    .expect(200);
  return { ...saved.body, svg: serializeScene(r.scene, meta) };
}

describe('kompozycje', () => {
  it('tworzy plik z warstwami domyślnymi i unikalną nazwą', async () => {
    const a = (await request(app).post('/api/compositions').send({ name: 'Wieś latem', width: 1600, height: 900 }).expect(201)).body;
    const b = (await request(app).post('/api/compositions').send({ name: 'Wieś latem', width: 800, height: 600 }).expect(201)).body;
    expect(a.id).toBe('wies-latem');
    expect(b.id).toBe('wies-latem-2');
    const file = t.ctx.workspace.compositionPath('wies-latem');
    const { scene, meta } = parseScene(fs.readFileSync(file, 'utf8'));
    expect(scene.layers.map((l) => l.name)).toEqual(['Tło', 'Obiekty', 'Teksty']);
    expect(meta).toEqual({ name: 'Wieś latem', author: 'human', status: 'reviewed' });
    expect(fs.existsSync(t.ctx.workspace.compositionThumbPath('wies-latem'))).toBe(true);
  });

  it('zapis z nieaktualną rewizją kończy się 409', async () => {
    const c = (await request(app).post('/api/compositions').send({ name: 'A', width: 100, height: 100 }).expect(201)).body;
    const { svg, revision } = (await request(app).get(`/api/compositions/${c.id}`)).body;
    await request(app).put(`/api/compositions/${c.id}`).send({ svg, revision }).expect(200);
    const changed = svg.replace('<title>A</title>', '<title>B</title>');
    await request(app).put(`/api/compositions/${c.id}`).send({ svg: changed, revision: revision + 1 }).expect(409);
  });

  it('odrzuca zapis treści, której edytor nie odczyta', async () => {
    const c = (await request(app).post('/api/compositions').send({ name: 'A', width: 100, height: 100 }).expect(201)).body;
    const { revision } = (await request(app).get(`/api/compositions/${c.id}`)).body;
    await request(app).put(`/api/compositions/${c.id}`).send({ svg: '<svg/>', revision }).expect(400);
  });

  it('indeksuje użyte grafiki i pokazuje je w „Użyta w”', async () => {
    const tree = addGraphic('drzewo.svg');
    const c = (await request(app).post('/api/compositions').send({ name: 'Park', width: 1000, height: 600 }).expect(201)).body;
    const saved = await withGraphics(c.id, [tree, tree]);
    expect(saved.assetIds).toEqual([tree]);
    const g = (await request(app).get(`/api/graphics/${tree}`)).body;
    expect(g.usedIn).toEqual([{ id: 'park', name: 'Park' }]);
  });

  it('zmiana nazwy i statusu zapisuje się w pliku', async () => {
    const c = (await request(app).post('/api/compositions').send({ name: 'A', width: 100, height: 100 }).expect(201)).body;
    await request(app).patch(`/api/compositions/${c.id}`).send({ name: 'Nowa nazwa', status: 'draft' }).expect(200);
    const { meta } = parseScene(fs.readFileSync(t.ctx.workspace.compositionPath(c.id), 'utf8'));
    expect(meta).toMatchObject({ name: 'Nowa nazwa', status: 'draft' });
  });

  it('emituje zdarzenie zmiany z identyfikatorem klienta', async () => {
    const events: ServerEvent[] = [];
    t.ctx.events.subscribe((e) => events.push(e));
    const c = (await request(app).post('/api/compositions').send({ name: 'A', width: 100, height: 100 }).expect(201)).body;
    const { svg, revision } = (await request(app).get(`/api/compositions/${c.id}`)).body;
    await request(app).put(`/api/compositions/${c.id}`).send({ svg, revision, clientId: 'karta-1' }).expect(200);
    expect(events.at(-1)).toMatchObject({ type: 'composition-changed', id: c.id, source: 'ui', clientId: 'karta-1' });
  });

  it('indeks odtwarza się z plików, a nieczytelne pliki są zgłaszane', async () => {
    await request(app).post('/api/compositions').send({ name: 'A', width: 100, height: 100 }).expect(201);
    fs.writeFileSync(path.join(t.ctx.config.compositionsDir, 'zepsuta.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.copyFileSync(t.ctx.workspace.compositionPath('a'), path.join(t.ctx.config.compositionsDir, 'skopiowana.svg'));
    t.ctx.compositions.reindex();
    const list = (await request(app).get('/api/compositions').expect(200)).body;
    expect(list.items.map((c: { id: string }) => c.id).sort()).toEqual(['a', 'skopiowana']);
    expect(list.broken).toHaveLength(1);
    expect(list.broken[0].file).toMatch(/zepsuta\.svg$/);
    expect(t.logs.some((l) => l.startsWith('error:') && l.includes('zepsuta.svg'))).toBe(true);
  });

  it('usuwa plik, miniaturę i wpis', async () => {
    const c = (await request(app).post('/api/compositions').send({ name: 'A', width: 100, height: 100 }).expect(201)).body;
    await request(app).delete(`/api/compositions/${c.id}`).expect(204);
    expect(fs.existsSync(t.ctx.workspace.compositionPath(c.id))).toBe(false);
    await request(app).get(`/api/compositions/${c.id}`).expect(404);
  });
});

describe('eksport', () => {
  async function prepared() {
    const tree = addGraphic('drzewo.svg');
    const cloud = addGraphic('chmura.svg');
    const c = (await request(app).post('/api/compositions').send({ name: 'Eksport', width: 800, height: 400 }).expect(201)).body;
    await withGraphics(c.id, [tree, cloud]);
    return { id: c.id as string, tree, cloud };
  }

  it('plik samodzielny ma wklejone grafiki i nie ma atrybutów edytora', async () => {
    const { id } = await prepared();
    const out = (await request(app).post(`/api/compositions/${id}/export`).send({ mode: 'standalone' }).expect(200)).body;
    expect(out.path).toBe(path.join(t.ctx.config.exportsDir, `${id}.svg`));
    const svg = fs.readFileSync(out.path, 'utf8');
    expect(svg).not.toContain('data-mz-');
    expect(svg).toContain('<circle');
    expect(svg).toMatch(/url\(#n[a-z0-9]+-niebo\)/);
  });

  it('plik z referencjami wskazuje pliki biblioteki ścieżką względną', async () => {
    const { id, tree, cloud } = await prepared();
    const dir = path.join(t.dir, 'gdzies', 'indziej');
    const out = (await request(app).post(`/api/compositions/${id}/export`).send({ mode: 'linked', dir, fileName: 'x.svg' }).expect(200)).body;
    const svg = fs.readFileSync(out.path, 'utf8');
    const rel = path.relative(dir, t.ctx.config.libraryDir).split(path.sep).join('/');
    expect(svg).toContain(`href="${rel}/${tree}.svg"`);
    expect(svg).toContain(`href="${rel}/${cloud}.svg"`);
    expect(svg).not.toContain('<circle');
  });

  it('tryb z referencjami zgłasza grafiki usunięte z biblioteki', async () => {
    const { id, tree } = await prepared();
    t.ctx.library.delete(tree);
    const res = await request(app).post(`/api/compositions/${id}/export`).send({ mode: 'linked' }).expect(400);
    expect(res.body.error).toContain(tree);
  });

  it('pomija ukryte warstwy', async () => {
    const { id } = await prepared();
    const { scene, meta, revision } = t.ctx.compositions.load(id);
    scene.layers.find((l) => l.name === 'Obiekty')!.hidden = true;
    t.ctx.compositions.save(id, serializeScene(scene, meta), revision, { source: 'ui' });
    const svg = t.ctx.compositions.exportStandalone(id);
    expect(svg).not.toContain('<circle');
  });
});

describe('slugify', () => {
  it.each([
    ['Wieś latem', 'wies-latem'],
    ['Żółć, łódź!', 'zolc-lodz'],
    ['   ', 'kompozycja'],
  ])('%s → %s', (a, b) => expect(slugify(a)).toBe(b));
});
