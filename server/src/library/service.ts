import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import { parseXml, readDimensions, type GraphicDetailDto, type GraphicDto, type GraphicMetadataPatch, type ImportItemResult } from '@moniuszko/shared';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { renderPng } from '../render.js';
import { writeFileAtomic } from '../workspace.js';
import { dominantColors } from './colors.js';
import { LibraryRepository } from './repository.js';
import { normalizeSvg, sanitizeSvg } from './sanitize.js';

const newGraphicId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

export const THUMB_SIZE = 256;

type Prepared = {
  svg: string;
  warnings: string[];
  width: number;
  height: number;
  viewBox: string;
  colors: string[];
};

export class LibraryService {
  readonly repo: LibraryRepository;

  constructor(private ctx: AppContext) {
    this.repo = new LibraryRepository(ctx.workspace.db);
  }

  private get ws() {
    return this.ctx.workspace;
  }

  /** Zgłasza w logu niezgodności między bazą a folderem biblioteki. Niczego nie naprawia. */
  checkFiles(): void {
    const ids = new Set(this.repo.allIds());
    for (const id of ids) {
      if (!fs.existsSync(this.ws.graphicPath(id))) {
        this.ctx.log.error(`Grafika ${id} jest w bazie, ale nie ma pliku ${this.ws.graphicPath(id)}`);
      }
    }
    for (const f of fs.readdirSync(this.ws.config.libraryDir)) {
      if (!f.endsWith('.svg')) continue;
      const id = f.slice(0, -4);
      if (!ids.has(id)) this.ctx.log.warn(`Plik ${path.join(this.ws.config.libraryDir, f)} nie ma wpisu w bazie i nie jest widoczny w bibliotece`);
    }
  }

  /** Sanityzacja, opcjonalna normalizacja svgo i odczyt wymiarów. Błąd oznacza odrzucenie pliku. */
  private prepare(source: string): Prepared {
    const sanitized = sanitizeSvg(source);
    const warnings = sanitized.removed.length ? [`usunięto: ${sanitized.removed.join(', ')}`] : [];
    let svg = sanitized.svg;
    if (this.ws.config.normalizeSvg) svg = normalizeSvg(svg);
    const dims = readDimensions(parseXml(svg).documentElement!);
    return { svg, warnings, ...dims, colors: dominantColors(svg) };
  }

  private writeThumbnail(id: string, svg: string): void {
    writeFileAtomic(this.ws.graphicThumbPath(id), renderPng(svg, THUMB_SIZE));
  }

  /**
   * Importuje jeden plik. Przy włączonym ostrzeganiu o duplikatach plik o tej samej treści co
   * istniejąca grafika nie jest dodawany, chyba że `force`.
   */
  importFile(fileName: string, content: Buffer, opts: { force?: boolean } = {}): ImportItemResult {
    if (!fileName.toLowerCase().endsWith('.svg')) {
      return { fileName, status: 'rejected', error: 'to nie jest plik SVG (wymagane rozszerzenie .svg)' };
    }
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    if (this.ws.config.warnDuplicates && !opts.force) {
      const dup = this.repo.findBySha(sha256);
      if (dup) return { fileName, status: 'duplicate', duplicateOf: dup, warnings: [] };
    }
    let prepared: Prepared;
    try {
      prepared = this.prepare(content.toString('utf8'));
    } catch (e) {
      return { fileName, status: 'rejected', error: (e as Error).message };
    }
    const id = newGraphicId();
    const now = new Date().toISOString();
    writeFileAtomic(this.ws.originalPath(id), content);
    writeFileAtomic(this.ws.graphicPath(id), prepared.svg);
    this.writeThumbnail(id, prepared.svg);
    this.repo.insert(
      {
        id,
        title: fileName.replace(/\.svg$/i, ''),
        description: '',
        category: null,
        colors: prepared.colors,
        width: prepared.width,
        height: prepared.height,
        viewBox: prepared.viewBox,
        sourceName: fileName,
        author: null,
        license: null,
        tagStatus: 'untagged',
        version: 1,
        sha256,
        createdAt: now,
        updatedAt: now,
      },
      [],
    );
    this.ctx.events.emit({ type: 'library-changed', ids: [id] });
    return { fileName, status: 'added', graphic: this.get(id), warnings: prepared.warnings };
  }

  /** Dodaje grafikę z treści SVG i metadanych w jednym kroku (narzędzie MCP add_graphic). */
  addFromSource(
    fileName: string,
    svg: string,
    metadata: GraphicMetadataPatch,
    opts: { force?: boolean } = {},
  ): ImportItemResult {
    const result = this.importFile(fileName, Buffer.from(svg, 'utf8'), opts);
    if (result.status === 'added' && Object.keys(metadata).length > 0) {
      return { ...result, graphic: this.updateMetadata(result.graphic.id, metadata) };
    }
    return result;
  }

  /** Podmienia plik grafiki; wersja rośnie, metadane zostają. */
  replaceFile(id: string, fileName: string, content: Buffer): { graphic: GraphicDto; warnings: string[] } {
    this.get(id);
    const prepared = this.prepare(content.toString('utf8'));
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    writeFileAtomic(this.ws.originalPath(id), content);
    writeFileAtomic(this.ws.graphicPath(id), prepared.svg);
    this.writeThumbnail(id, prepared.svg);
    const current = this.get(id);
    this.repo.update(id, {
      colors: prepared.colors,
      width: prepared.width,
      height: prepared.height,
      viewBox: prepared.viewBox,
      sha256,
      sourceName: fileName,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    this.ctx.events.emit({ type: 'library-changed', ids: [id] });
    return { graphic: this.get(id), warnings: prepared.warnings };
  }

  get(id: string): GraphicDto {
    const g = this.repo.get(id);
    if (!g) throw notFound(`grafika ${id}`);
    return g;
  }

  detail(id: string): GraphicDetailDto {
    return { ...this.get(id), usedIn: this.repo.usedIn(id) };
  }

  /** Treść pliku SVG grafiki (po sanityzacji). */
  readSvg(id: string): string {
    this.get(id);
    const file = this.ws.graphicPath(id);
    if (!fs.existsSync(file)) throw new Error(`Brak pliku grafiki ${id}: ${file}`);
    return fs.readFileSync(file, 'utf8');
  }

  readOriginal(id: string): string {
    this.get(id);
    const file = this.ws.originalPath(id);
    if (!fs.existsSync(file)) throw notFound(`oryginał grafiki ${id}`);
    return fs.readFileSync(file, 'utf8');
  }

  thumbnailPath(id: string): string {
    this.get(id);
    const file = this.ws.graphicThumbPath(id);
    if (!fs.existsSync(file)) this.writeThumbnail(id, this.readSvg(id));
    return file;
  }

  updateMetadata(id: string, patch: GraphicMetadataPatch): GraphicDto {
    this.get(id);
    const { tags, ...rest } = patch;
    const clean = tags ? normalizeTags(tags) : undefined;
    this.repo.update(
      id,
      {
        ...rest,
        ...(rest.title !== undefined ? { title: rest.title.trim() } : {}),
        ...(rest.category !== undefined ? { category: rest.category?.trim() || null } : {}),
        updatedAt: new Date().toISOString(),
      },
      clean,
    );
    this.ctx.events.emit({ type: 'library-changed', ids: [id] });
    return this.get(id);
  }

  delete(id: string): void {
    this.get(id);
    this.repo.delete(id);
    for (const file of [this.ws.graphicPath(id), this.ws.originalPath(id), this.ws.graphicThumbPath(id)]) {
      fs.rmSync(file, { force: true });
    }
    this.ctx.events.emit({ type: 'library-changed', ids: [id] });
  }
}

/** Tagi: małe litery, bez spacji na brzegach, bez powtórzeń, bez pustych. */
export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
}
