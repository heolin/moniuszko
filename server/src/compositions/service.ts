import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import {
  createScene,
  parseScene,
  serializeScene,
  usedAssetIds,
  type CompositionDto,
  type CompositionMeta,
  type CompositionWithSvgDto,
  type ExportMode,
  type Scene,
} from '@moniuszko/shared';
import type { AppContext } from '../context.js';
import { compositionAssets, compositions } from '../db/schema.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { renderPng } from '../render.js';
import { writeFileAtomic } from '../workspace.js';
import { exportComposition } from './export.js';

export const COMPOSITION_THUMB_SIZE = 480;

export type BrokenFile = { file: string; error: string };

export type SaveSource = { source: 'agent' | 'ui'; clientId?: string };

/**
 * Znacznik wersji pliku liczony z treści (48 bitów SHA-1). Nie zależy od dokładności mtime,
 * więc dwa zapisy w tej samej milisekundzie dostają różne znaczniki.
 */
export function revisionOf(svg: string): number {
  return parseInt(crypto.createHash('sha1').update(svg).digest('hex').slice(0, 12), 16);
}

const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => PL[c]!)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'kompozycja';
}

export class CompositionService {
  /** Pliki w folderze kompozycji, których nie udało się odczytać przy ostatnim indeksowaniu. */
  broken: BrokenFile[] = [];

  constructor(private ctx: AppContext) {}

  private get ws() {
    return this.ctx.workspace;
  }

  private get db() {
    return this.ctx.workspace.db;
  }

  /** Odtwarza indeks z plików w folderze kompozycji. */
  reindex(): void {
    const dir = this.ws.config.compositionsDir;
    const seen = new Set<string>();
    this.broken = [];
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.svg')) continue;
      const id = f.slice(0, -4);
      const file = path.join(dir, f);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        this.broken.push({ file, error: 'nazwa pliku zawiera niedozwolone znaki (dozwolone: litery, cyfry, - i _)' });
        continue;
      }
      try {
        const svg = fs.readFileSync(file, 'utf8');
        const { scene, meta } = parseScene(svg);
        const stat = fs.statSync(file);
        this.writeIndex(id, scene, meta, svg, stat.birthtime.toISOString(), stat.mtime.toISOString());
        seen.add(id);
      } catch (e) {
        this.broken.push({ file, error: (e as Error).message });
      }
    }
    for (const b of this.broken) this.ctx.log.error(`Nie można odczytać kompozycji ${b.file}: ${b.error}`);
    const stale = this.db
      .select({ id: compositions.id })
      .from(compositions)
      .all()
      .map((r) => r.id)
      .filter((id) => !seen.has(id));
    if (stale.length) {
      this.db.delete(compositions).where(inArray(compositions.id, stale)).run();
      this.ctx.log.warn(`Usunięto z indeksu kompozycje bez plików: ${stale.join(', ')}`);
    }
  }

  private writeIndex(id: string, scene: Scene, meta: CompositionMeta, svg: string, createdAt: string, updatedAt: string): void {
    const assetIds = usedAssetIds(scene);
    const existing = this.db.select().from(compositions).where(eq(compositions.id, id)).get();
    const row = {
      id,
      name: meta.name,
      width: scene.width,
      height: scene.height,
      author: meta.author,
      status: meta.status,
      createdAt: existing?.createdAt ?? createdAt,
      updatedAt,
      revision: revisionOf(svg),
    };
    this.db.transaction((tx) => {
      tx.insert(compositions).values(row).onConflictDoUpdate({ target: compositions.id, set: row }).run();
      tx.delete(compositionAssets).where(eq(compositionAssets.compositionId, id)).run();
      if (assetIds.length) tx.insert(compositionAssets).values(assetIds.map((graphicId) => ({ compositionId: id, graphicId }))).run();
    });
  }

  private toDto(row: typeof compositions.$inferSelect): CompositionDto {
    const assetIds = this.db
      .select({ g: compositionAssets.graphicId })
      .from(compositionAssets)
      .where(eq(compositionAssets.compositionId, row.id))
      .all()
      .map((r) => r.g);
    return { ...row, slug: row.id, assetIds };
  }

  list(): { items: CompositionDto[]; broken: BrokenFile[] } {
    const rows = this.db.select().from(compositions).all();
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { items: rows.map((r) => this.toDto(r)), broken: this.broken };
  }

  get(id: string): CompositionDto {
    const row = this.db.select().from(compositions).where(eq(compositions.id, id)).get();
    if (!row) throw notFound(`kompozycja ${id}`);
    return this.toDto(row);
  }

  readSvg(id: string): string {
    this.get(id);
    const file = this.ws.compositionPath(id);
    if (!fs.existsSync(file)) throw new Error(`Kompozycja ${id} jest w indeksie, ale nie ma pliku ${file}`);
    return fs.readFileSync(file, 'utf8');
  }

  read(id: string): CompositionWithSvgDto {
    return { ...this.get(id), svg: this.readSvg(id) };
  }

  load(id: string): { scene: Scene; meta: CompositionMeta; revision: number } {
    const svg = this.readSvg(id);
    return { ...parseScene(svg), revision: revisionOf(svg) };
  }

  private uniqueId(name: string): string {
    const base = slugify(name);
    let id = base;
    for (let i = 2; fs.existsSync(this.ws.compositionPath(id)); i++) id = `${base}-${i}`;
    return id;
  }

  create(input: { name: string; width: number; height: number; author: 'human' | 'agent'; scene?: Scene }): CompositionDto {
    const name = input.name.trim();
    if (!name) throw badRequest('Nazwa kompozycji nie może być pusta');
    const scene = input.scene ?? createScene(input.width, input.height);
    const meta: CompositionMeta = { name, author: input.author, status: input.author === 'agent' ? 'draft' : 'reviewed' };
    const id = this.uniqueId(name);
    this.write(id, serializeScene(scene, meta), { source: input.author === 'agent' ? 'agent' : 'ui' });
    return this.get(id);
  }

  /**
   * Zapisuje nową treść pliku. `expectedRevision` musi odpowiadać bieżącej treści pliku;
   * inaczej ktoś (agent albo inna karta) zapisał go w międzyczasie i zapis kończy się 409.
   */
  save(id: string, svg: string, expectedRevision: number, src: SaveSource): CompositionDto {
    const current = revisionOf(this.readSvg(id));
    if (current !== expectedRevision) {
      throw new HttpError(409, 'Kompozycja została zmieniona w międzyczasie; wczytaj ją ponownie');
    }
    parseScene(svg); // odrzuca treść, której edytor nie odczyta
    this.write(id, svg, src);
    return this.get(id);
  }

  /** Zmiana sceny przez funkcję (MCP). Odczyt i zapis są synchroniczne względem siebie. */
  async update(
    id: string,
    fn: (scene: Scene, meta: CompositionMeta) => Promise<{ scene: Scene; meta: CompositionMeta }>,
    src: SaveSource,
  ): Promise<CompositionDto> {
    const before = this.load(id);
    const after = await fn(before.scene, before.meta);
    // Zapis między odczytem a końcem `fn` (np. z edytora) nie może zostać nadpisany po cichu.
    if (revisionOf(this.readSvg(id)) !== before.revision) {
      throw new HttpError(409, 'Kompozycja została zmieniona w trakcie operacji; ponów ją');
    }
    this.write(id, serializeScene(after.scene, after.meta), src);
    return this.get(id);
  }

  patchMeta(id: string, patch: Partial<Pick<CompositionMeta, 'name' | 'status'>>, src: SaveSource): CompositionDto {
    const { scene, meta } = this.load(id);
    if (patch.name !== undefined && !patch.name.trim()) throw badRequest('Nazwa kompozycji nie może być pusta');
    const next = { ...meta, ...patch, ...(patch.name ? { name: patch.name.trim() } : {}) };
    this.write(id, serializeScene(scene, next), src);
    return this.get(id);
  }

  duplicate(id: string, name?: string): CompositionDto {
    const { scene, meta } = this.load(id);
    return this.create({
      name: name ?? `${meta.name} (kopia)`,
      width: scene.width,
      height: scene.height,
      author: 'human',
      scene,
    });
  }

  delete(id: string): void {
    this.get(id);
    fs.rmSync(this.ws.compositionPath(id), { force: true });
    fs.rmSync(this.ws.compositionThumbPath(id), { force: true });
    this.db.delete(compositions).where(eq(compositions.id, id)).run();
    this.ctx.events.emit({ type: 'composition-deleted', id });
  }

  thumbnailPath(id: string): string {
    this.get(id);
    const file = this.ws.compositionThumbPath(id);
    if (!fs.existsSync(file)) this.writeThumbnail(id, this.readSvg(id));
    return file;
  }

  /** PNG kompozycji o dłuższym boku `size`. */
  renderPng(id: string, size: number): Buffer {
    return renderPng(this.readSvg(id), size);
  }

  export(id: string, mode: ExportMode, opts: { dir?: string; fileName?: string } = {}): { path: string; svg: string } {
    const { scene, meta } = this.load(id);
    const dir = opts.dir ?? this.ws.config.exportsDir;
    if (!path.isAbsolute(dir)) throw badRequest('Folder eksportu musi być ścieżką bezwzględną');
    const fileName = opts.fileName ?? `${id}.svg`;
    if (!/^[^/\\]+\.svg$/i.test(fileName)) throw badRequest('Nazwa pliku eksportu musi kończyć się na .svg i nie może zawierać ścieżki');
    const target = path.join(dir, fileName);
    const svg = exportComposition(scene, meta, mode, {
      graphicHref: (graphicId) => {
        const file = this.ws.graphicPath(graphicId);
        if (!fs.existsSync(file)) return null;
        return path.relative(dir, file).split(path.sep).join('/');
      },
    });
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(target, svg);
    return { path: target, svg };
  }

  /**
   * Plik samodzielny do pobrania w przeglądarce. Tryb z referencjami wymaga znanego folderu
   * docelowego (ścieżki są względne), więc jest dostępny tylko przez `export`.
   */
  exportStandalone(id: string): string {
    const { scene, meta } = this.load(id);
    return exportComposition(scene, meta, 'standalone', {
      graphicHref: () => {
        throw new Error('Tryb samodzielny nie używa odwołań do biblioteki');
      },
    });
  }

  private writeThumbnail(id: string, svg: string): void {
    try {
      writeFileAtomic(this.ws.compositionThumbPath(id), renderPng(svg, COMPOSITION_THUMB_SIZE, '#ffffff'));
    } catch (e) {
      // Plik kompozycji jest już zapisany; brak miniatury zgłaszamy, ale nie cofamy zapisu.
      this.ctx.log.error(`Nie udało się wygenerować miniatury kompozycji ${id}: ${(e as Error).message}`);
      fs.rmSync(this.ws.compositionThumbPath(id), { force: true });
    }
  }

  private write(id: string, svg: string, src: SaveSource): void {
    const file = this.ws.compositionPath(id);
    const existed = fs.existsSync(file);
    writeFileAtomic(file, svg);
    const now = new Date().toISOString();
    const { scene, meta } = parseScene(svg);
    this.writeIndex(id, scene, meta, svg, now, now);
    this.writeThumbnail(id, svg);
    this.ctx.library.repo.markUsed(usedAssetIds(scene), now);
    this.ctx.events.emit({
      type: 'composition-changed',
      id,
      source: src.source,
      clientId: src.clientId,
      revision: revisionOf(svg),
    });
    if (!existed) this.ctx.log.info(`Utworzono kompozycję ${file}`);
  }
}
