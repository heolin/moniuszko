import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TAG_STATUSES, applySceneOps, estimateTextMeasurer, sceneOpSchema, type GraphicDto } from '@moniuszko/shared';
import type { AppContext } from '../context.js';
import { errorMessage } from '../errors.js';
import { renderPng } from '../render.js';
import { describeScene } from './describe.js';

const INSTRUCTIONS = `Moniuszko: biblioteka grafik SVG i edytor kompozycji (pojedynczych plików SVG).

Tagowanie biblioteki:
1. list_untagged zwraca grafiki bez metadanych razem z podglądami PNG.
2. Obejrzyj podgląd i zapisz opis przez update_graphic_metadata: krótki tytuł, zdanie lub dwa
   opisu (co przedstawia grafika, styl, kolory), kategorię i tagi. Przed tagowaniem sprawdź
   get_library_overview, żeby używać istniejących kategorii i tagów zamiast tworzyć synonimy.

Tworzenie kompozycji:
1. search_graphics znajduje grafiki po tytule, opisie i tagach.
2. create_composition tworzy pustą kompozycję z warstwami "Tło", "Obiekty", "Teksty".
3. apply_scene_ops wstawia grafiki i teksty oraz je przesuwa, skaluje, obraca, grupuje.
   Układ współrzędnych: piksele płótna, początek w lewym górnym rogu, oś y w dół. Warstwy
   i obiekty są wymienione od spodu do wierzchu. Operacje wykonują się w całości albo wcale.
4. Wynik apply_scene_ops zawiera render PNG; sprawdź go i popraw układ kolejnymi operacjami.
Kompozycje utworzone przez agenta mają status "draft"; człowiek przegląda je w edytorze.`;

type ToolFn<A> = (args: A) => Promise<CallToolResult> | CallToolResult;

/** Błędy narzędzia wracają do agenta jako wynik z isError, z treścią błędu. */
function safe<A>(fn: ToolFn<A>): ToolFn<A> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: errorMessage(e) }] };
    }
  };
}

const json = (value: unknown) => ({ type: 'text' as const, text: JSON.stringify(value, null, 2) });
const png = (buf: Buffer) => ({ type: 'image' as const, data: buf.toString('base64'), mimeType: 'image/png' });

function graphicSummary(g: GraphicDto) {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    category: g.category,
    tags: g.tags,
    tagStatus: g.tagStatus,
    width: g.width,
    height: g.height,
    colors: g.colors,
  };
}

const PREVIEW_SIZE = 512;
const COMPOSITION_PREVIEW_SIZE = 1024;

export function createMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: 'moniuszko', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  // ------------------------------------------------------------ biblioteka

  server.registerTool(
    'search_graphics',
    {
      title: 'Szukaj grafik',
      description:
        'Wyszukuje grafiki w bibliotece po tekście (tytuł, opis, tagi, kategoria), statusie metadanych, kategorii i tagach. Zwraca listę bez podglądów; podgląd daje get_graphic.',
      inputSchema: {
        query: z.string().optional().describe('Słowa do wyszukania; wszystkie muszą wystąpić'),
        tagStatus: z.enum(TAG_STATUSES).optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Grafika musi mieć wszystkie podane tagi'),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    safe(({ query, tagStatus, category, tags, limit, offset }) => {
      const r = ctx.library.repo.list({ q: query, tagStatus, category, tags, limit, offset });
      return { content: [json({ total: r.total, items: r.items.map(graphicSummary) })] };
    }),
  );

  server.registerTool(
    'get_graphic',
    {
      title: 'Pokaż grafikę',
      description: 'Metadane grafiki, podgląd PNG i opcjonalnie treść SVG.',
      inputSchema: {
        id: z.string(),
        includeSvg: z.boolean().default(false).describe('Dołącz treść pliku SVG'),
      },
    },
    safe(({ id, includeSvg }) => {
      const g = ctx.library.detail(id);
      const svg = ctx.library.readSvg(id);
      const content: CallToolResult['content'] = [json({ ...graphicSummary(g), usedIn: g.usedIn }), png(renderPng(svg, PREVIEW_SIZE))];
      if (includeSvg) content.push({ type: 'text', text: svg });
      return { content };
    }),
  );

  server.registerTool(
    'add_graphic',
    {
      title: 'Dodaj grafikę',
      description:
        'Dodaje grafikę SVG do biblioteki. Treść jest oczyszczana ze skryptów i odwołań zewnętrznych. Plik o treści identycznej z istniejącą grafiką nie jest dodawany, chyba że force=true.',
      inputSchema: {
        fileName: z.string().regex(/\.svg$/i).describe('Nazwa pliku, np. "drzewo.svg"'),
        svg: z.string().min(1).describe('Treść pliku SVG'),
        title: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        force: z.boolean().default(false),
      },
    },
    safe(({ fileName, svg, force, ...meta }) => {
      const hasMeta = Object.values(meta).some((v) => v !== undefined);
      const r = ctx.library.addFromSource(
        fileName,
        svg,
        hasMeta ? { ...stripUndefined(meta), tagStatus: 'ai' } : {},
        { force },
      );
      if (r.status === 'rejected') return { isError: true, content: [json(r)] };
      if (r.status === 'duplicate') return { content: [json({ status: 'duplicate', duplicateOf: graphicSummary(r.duplicateOf) })] };
      return { content: [json({ status: 'added', graphic: graphicSummary(r.graphic), warnings: r.warnings })] };
    }),
  );

  server.registerTool(
    'update_graphic_metadata',
    {
      title: 'Zmień metadane grafiki',
      description:
        'Zapisuje tytuł, opis, kategorię i tagi grafiki. Ustawia status "ai" (otagowana przez agenta), chyba że podasz inny. `tags` zastępuje listę tagów; `addTags` i `removeTags` ją zmieniają.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        category: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        addTags: z.array(z.string()).optional(),
        removeTags: z.array(z.string()).optional(),
        author: z.string().nullable().optional(),
        license: z.string().nullable().optional(),
        tagStatus: z.enum(TAG_STATUSES).default('ai'),
      },
    },
    safe(({ id, tags, addTags, removeTags, ...rest }) => {
      if (tags && (addTags || removeTags)) throw new Error('Podaj albo `tags`, albo `addTags`/`removeTags`');
      let nextTags = tags;
      if (addTags || removeTags) {
        const remove = new Set((removeTags ?? []).map((t) => t.trim().toLowerCase()));
        nextTags = [...ctx.library.get(id).tags, ...(addTags ?? [])].filter((t) => !remove.has(t.trim().toLowerCase()));
      }
      const g = ctx.library.updateMetadata(id, { ...stripUndefined(rest), ...(nextTags ? { tags: nextTags } : {}) });
      return { content: [json(graphicSummary(g))] };
    }),
  );

  server.registerTool(
    'list_untagged',
    {
      title: 'Grafiki bez metadanych',
      description: 'Grafiki ze statusem "untagged", od najstarszych, każda z podglądem PNG.',
      inputSchema: { limit: z.number().int().min(1).max(20).default(5) },
    },
    safe(({ limit }) => {
      const r = ctx.library.repo.list({ tagStatus: 'untagged', limit: 100_000 });
      const items = r.items.reverse().slice(0, limit);
      const content: CallToolResult['content'] = [json({ total: r.total, returned: items.length })];
      for (const g of items) {
        content.push(json({ id: g.id, fileName: g.sourceName, width: g.width, height: g.height, colors: g.colors }));
        content.push(png(renderPng(ctx.library.readSvg(g.id), PREVIEW_SIZE)));
      }
      return { content };
    }),
  );

  server.registerTool(
    'get_library_overview',
    {
      title: 'Przegląd biblioteki',
      description: 'Liczba grafik według statusu, istniejące kategorie i najczęstsze tagi.',
      inputSchema: {},
    },
    safe(() => ({ content: [json(ctx.library.repo.facets())] })),
  );

  // ------------------------------------------------------------ kompozycje

  server.registerTool(
    'list_compositions',
    {
      title: 'Lista kompozycji',
      description: 'Kompozycje z nazwą, rozmiarem płótna, autorem i statusem.',
      inputSchema: {},
    },
    safe(() => {
      const r = ctx.compositions.list();
      return {
        content: [
          json({
            items: r.items.map(({ id, name, width, height, author, status, updatedAt }) => ({
              id,
              name,
              width,
              height,
              author,
              status,
              updatedAt,
            })),
            unreadableFiles: r.broken,
          }),
        ],
      };
    }),
  );

  server.registerTool(
    'get_composition',
    {
      title: 'Pokaż kompozycję',
      description: 'Struktura kompozycji (warstwy i obiekty z położeniem) oraz render PNG.',
      inputSchema: { id: z.string(), preview: z.boolean().default(true) },
    },
    safe(({ id, preview }) => {
      const { scene, meta } = ctx.compositions.load(id);
      const content: CallToolResult['content'] = [json(describeScene(id, scene, meta))];
      if (preview) content.push(png(ctx.compositions.renderPng(id, COMPOSITION_PREVIEW_SIZE)));
      return { content };
    }),
  );

  server.registerTool(
    'create_composition',
    {
      title: 'Nowa kompozycja',
      description: 'Tworzy pustą kompozycję z warstwami "Tło", "Obiekty", "Teksty" i statusem "draft".',
      inputSchema: {
        name: z.string().min(1),
        width: z.number().positive().default(1600),
        height: z.number().positive().default(900),
        background: z.string().nullable().default(null).describe('Kolor tła albo null dla przezroczystego'),
      },
    },
    safe(async ({ name, width, height, background }) => {
      const created = ctx.compositions.create({ name, width, height, author: 'agent' });
      if (background !== null) {
        await ctx.compositions.update(created.id, async (scene, meta) => ({ scene: { ...scene, background }, meta }), {
          source: 'agent',
        });
      }
      const { scene, meta } = ctx.compositions.load(created.id);
      return { content: [json(describeScene(created.id, scene, meta))] };
    }),
  );

  server.registerTool(
    'apply_scene_ops',
    {
      title: 'Zmień kompozycję',
      description: `Wykonuje listę operacji na kompozycji, w całości albo wcale. Operacje:
insert_graphic, add_text, update, move_by, delete, duplicate, group, ungroup, reorder, move_to_layer,
align, distribute, flip, add_layer, update_layer, delete_layer, set_canvas.
Pole "as" nadaje utworzonemu obiektowi alias; kolejne operacje odwołują się do niego jako "$alias".
Warstwę można wskazać id, aliasem albo dokładną nazwą. Zwraca aliasy, strukturę i render PNG.`,
      inputSchema: {
        compositionId: z.string(),
        ops: z.array(sceneOpSchema).min(1),
        preview: z.boolean().default(true),
      },
    },
    safe(async ({ compositionId, ops, preview }) => {
      let created: Record<string, string> = {};
      await ctx.compositions.update(
        compositionId,
        async (scene, meta) => {
          const r = await applySceneOps(scene, ops, {
            measurer: estimateTextMeasurer,
            loadGraphic: async (graphicId) => {
              const g = ctx.library.get(graphicId);
              return { svg: ctx.library.readSvg(graphicId), version: g.version, title: g.title };
            },
          });
          created = r.created;
          return { scene: r.scene, meta };
        },
        { source: 'agent' },
      );
      const { scene, meta } = ctx.compositions.load(compositionId);
      const content: CallToolResult['content'] = [json({ created, composition: describeScene(compositionId, scene, meta) })];
      if (preview) content.push(png(ctx.compositions.renderPng(compositionId, COMPOSITION_PREVIEW_SIZE)));
      return { content };
    }),
  );

  return server;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
