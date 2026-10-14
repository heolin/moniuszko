import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { makeCtx, sample, type TestCtx } from '../test/helpers.js';
import { createMcpServer } from './server.js';

let t: TestCtx;
let client: Client;

beforeEach(async () => {
  t = makeCtx({ normalizeSvg: false });
  const server = createMcpServer(t.ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  t.cleanup();
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function jsonOf(r: CallToolResult, i = 0): any {
  const c = r.content[i];
  if (!c || c.type !== 'text') throw new Error(`element ${i} wyniku nie jest tekstem: ${JSON.stringify(r)}`);
  return JSON.parse(c.text);
}

function images(r: CallToolResult) {
  return r.content.filter((c) => c.type === 'image');
}

describe('MCP', () => {
  it('udostępnia narzędzia z planu', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual(
      [
        'add_graphic',
        'apply_scene_ops',
        'create_composition',
        'get_composition',
        'get_graphic',
        'get_library_overview',
        'list_compositions',
        'list_untagged',
        'search_graphics',
        'update_graphic_metadata',
      ].sort(),
    );
  });

  it('przepływ tagowania: list_untagged → update_graphic_metadata → search_graphics', async () => {
    t.ctx.library.importFile('drzewo.svg', sample('drzewo.svg'));
    t.ctx.library.importFile('dom.svg', sample('dom.svg'));
    const untagged = await call('list_untagged', { limit: 5 });
    expect(untagged.isError).toBeFalsy();
    expect(jsonOf(untagged).total).toBe(2);
    expect(images(untagged)).toHaveLength(2);
    const first = jsonOf(untagged, 1);
    expect(first.fileName).toBe('drzewo.svg');

    const upd = await call('update_graphic_metadata', {
      id: first.id,
      title: 'Drzewo liściaste',
      description: 'Drzewo z okrągłą koroną',
      category: 'Rośliny',
      tags: ['drzewo', 'lato'],
    });
    expect(jsonOf(upd).tagStatus).toBe('ai');
    const added = await call('update_graphic_metadata', { id: first.id, addTags: ['park'], removeTags: ['lato'] });
    expect(jsonOf(added).tags).toEqual(['drzewo', 'park']);

    const found = jsonOf(await call('search_graphics', { query: 'korona' }));
    expect(found.items.map((g: { id: string }) => g.id)).toEqual([first.id]);
    expect(jsonOf(await call('list_untagged')).total).toBe(1);
  });

  it('add_graphic dodaje grafikę z metadanymi i wykrywa duplikat', async () => {
    const svg = sample('kwiat.svg').toString();
    const r = jsonOf(await call('add_graphic', { fileName: 'kwiat.svg', svg, title: 'Kwiat', tags: ['kwiat'] }));
    expect(r.status).toBe('added');
    expect(r.graphic).toMatchObject({ title: 'Kwiat', tags: ['kwiat'], tagStatus: 'ai' });
    expect(jsonOf(await call('add_graphic', { fileName: 'kwiat.svg', svg })).status).toBe('duplicate');
    const bad = await call('add_graphic', { fileName: 'x.svg', svg: '<html/>' });
    expect(bad.isError).toBe(true);
  });

  it('agent tworzy kompozycję i układa ją operacjami', async () => {
    const tree = t.ctx.library.importFile('drzewo.svg', sample('drzewo.svg'));
    const house = t.ctx.library.importFile('dom.svg', sample('dom.svg'));
    if (tree.status !== 'added' || house.status !== 'added') throw new Error('import');

    const created = jsonOf(await call('create_composition', { name: 'Zagroda', width: 1200, height: 800, background: '#cfe6f3' }));
    expect(created.canvas).toEqual({ width: 1200, height: 800, background: '#cfe6f3' });
    expect(created.status).toBe('draft');

    const r = await call('apply_scene_ops', {
      compositionId: created.id,
      ops: [
        { op: 'insert_graphic', graphicId: house.graphic.id, layer: 'Obiekty', x: 200, y: 300, width: 400, as: 'dom' },
        { op: 'insert_graphic', graphicId: tree.graphic.id, layer: 'Obiekty', x: 700, y: 250, width: 300, rotation: -5, as: 'drzewo' },
        { op: 'add_text', text: 'Zagroda', layer: 'Teksty', x: 600, y: 60, fontSize: 80, anchor: 'middle', as: 'tytul' },
        { op: 'group', nodes: ['$dom', '$drzewo'], name: 'Zabudowa', as: 'zabudowa' },
      ],
    });
    expect(r.isError).toBeFalsy();
    const body = jsonOf(r);
    expect(Object.keys(body.created).sort()).toEqual(['dom', 'drzewo', 'tytul', 'zabudowa']);
    const objects = body.composition.layers.find((l: { name: string }) => l.name === 'Obiekty');
    expect(objects.nodes).toHaveLength(1);
    expect(objects.nodes[0]).toMatchObject({ type: 'group', name: 'Zabudowa', x: 200 });
    expect(objects.nodes[0].children[0].bounds).toEqual({ x: 200, y: 300, width: 400, height: 400 });
    expect(images(r)).toHaveLength(1);

    const got = await call('get_composition', { id: created.id });
    expect(jsonOf(got).layers.find((l: { name: string }) => l.name === 'Teksty').nodes[0].text).toBe('Zagroda');
    expect(images(got)).toHaveLength(1);

    const list = jsonOf(await call('list_compositions'));
    expect(list.items).toEqual([expect.objectContaining({ id: created.id, author: 'agent', status: 'draft' })]);
  });

  it('błędna operacja zwraca błąd i nie zmienia pliku', async () => {
    const created = jsonOf(await call('create_composition', { name: 'Pusta' }));
    const before = t.ctx.compositions.readSvg(created.id);
    const r = await call('apply_scene_ops', {
      compositionId: created.id,
      ops: [
        { op: 'add_text', text: 'A', layer: 'Teksty', x: 0, y: 0 },
        { op: 'insert_graphic', graphicId: 'nie-ma', layer: 'Obiekty', x: 0, y: 0 },
      ],
    });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/Operacja #1 \(insert_graphic\).*nie-ma/);
    expect(t.ctx.compositions.readSvg(created.id)).toBe(before);
  });
});

describe('prompt tag_untagged', () => {
  it('jest na liście i podaje liczbę grafik bez opisu, limit i uwagi', async () => {
    t.ctx.library.importFile('drzewo.svg', sample('drzewo.svg'));
    t.ctx.library.importFile('dom.svg', sample('dom.svg'));
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['tag_untagged']);
    const r = await client.getPrompt({ name: 'tag_untagged', arguments: { limit: '1', uwagi: 'tagi po angielsku' } });
    const msg = r.messages[0]!.content;
    expect(msg.type).toBe('text');
    const text = (msg as { text: string }).text;
    expect(text).toContain('jest 2 grafik bez metadanych');
    expect(text).toContain('najwyżej 1 z nich');
    expect(text).toContain('Dodatkowe wskazówki: tagi po angielsku');
  });

  it('odrzuca limit, który nie jest liczbą', async () => {
    await expect(client.getPrompt({ name: 'tag_untagged', arguments: { limit: 'dużo' } })).rejects.toThrow(/limit/);
  });
});

describe('MCP przez HTTP', () => {
  it('odpowiada na initialize pod /mcp', async () => {
    const app = createApp(t.ctx);
    const res = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      })
      .expect(200);
    expect(res.text).toContain('"serverInfo"');
    expect(res.text).toContain('moniuszko');
  });
});
