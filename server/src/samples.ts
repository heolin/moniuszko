import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TAG_STATUSES, applySceneOps, estimateTextMeasurer, type SceneOpInput } from '@moniuszko/shared';
import type { AppContext } from './context.js';

// Przykładowe dane z folderu samples/: grafiki z metadanymi (library.json) i jedna kompozycja
// zapisana jako lista operacji sceny (composition.json). Używane przez testy e2e i skrypt
// zrzutów ekranów do dokumentacji.

const libraryFile = z.object({
  description: z.string().optional(),
  graphics: z.record(
    z.string().regex(/\.svg$/),
    z
      .object({
        title: z.string(),
        description: z.string(),
        category: z.string(),
        tags: z.array(z.string()),
        tagStatus: z.enum(TAG_STATUSES),
      })
      .strict()
      .nullable(),
  ),
});

const compositionFile = z.object({
  description: z.string().optional(),
  name: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  ops: z.array(z.record(z.string(), z.unknown())).min(1),
});

export type LoadedSamples = {
  /** Nazwa pliku z samples/ → id grafiki w bibliotece. */
  graphics: Record<string, string>;
  compositionId: string;
};

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`Brak pliku ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Importuje przykładowe grafiki do biblioteki i tworzy przykładową kompozycję. Każdy plik .svg
 * z folderu musi być opisany w library.json (także jako null) i każdy opis musi mieć plik;
 * niezgodność kończy się błędem z nazwą pliku.
 */
export async function loadSamples(ctx: AppContext, dir: string): Promise<LoadedSamples> {
  const lib = libraryFile.parse(readJson(path.join(dir, 'library.json')));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();
  const described = Object.keys(lib.graphics);
  const undescribed = files.filter((f) => !described.includes(f));
  if (undescribed.length) throw new Error(`Pliki bez wpisu w library.json: ${undescribed.join(', ')}`);
  const missing = described.filter((f) => !files.includes(f));
  if (missing.length) throw new Error(`Wpisy w library.json bez pliku: ${missing.join(', ')}`);

  const graphics: Record<string, string> = {};
  for (const file of described) {
    const r = ctx.library.importFile(file, fs.readFileSync(path.join(dir, file)));
    if (r.status !== 'added') throw new Error(`Import przykładu ${file}: ${r.status}${r.status === 'rejected' ? ` (${r.error})` : ''}`);
    graphics[file] = r.graphic.id;
    const meta = lib.graphics[file];
    if (meta) ctx.library.updateMetadata(r.graphic.id, meta);
  }

  const comp = compositionFile.parse(readJson(path.join(dir, 'composition.json')));
  const ops = comp.ops.map((op, i) => {
    if (typeof op.graphicId !== 'string') return op;
    const id = graphics[op.graphicId];
    if (!id) throw new Error(`composition.json, operacja #${i}: nie ma przykładowej grafiki „${op.graphicId}”`);
    return { ...op, graphicId: id };
  }) as SceneOpInput[];
  const created = ctx.compositions.create({ name: comp.name, width: comp.width, height: comp.height, author: 'human' });
  await ctx.compositions.update(
    created.id,
    async (scene, meta) => {
      const r = await applySceneOps(scene, ops, {
        measurer: estimateTextMeasurer,
        loadGraphic: async (id) => {
          const g = ctx.library.get(id);
          return { svg: ctx.library.readSvg(id), version: g.version, title: g.title };
        },
      });
      return { scene: r.scene, meta };
    },
    { source: 'ui' },
  );
  return { graphics, compositionId: created.id };
}
