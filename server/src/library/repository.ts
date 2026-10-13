import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { FacetsDto, GraphicDto, GraphicListQuery, GraphicListResponse, TagStatus } from '@moniuszko/shared';
import { TAG_STATUSES } from '@moniuszko/shared';
import type { Db } from '../db/index.js';
import { compositionAssets, compositions, graphicTags, graphics } from '../db/schema.js';

type GraphicRow = typeof graphics.$inferSelect;
export type NewGraphic = typeof graphics.$inferInsert;

/** Wartość parametru `category` oznaczająca grafiki bez kategorii. */
export const NO_CATEGORY = '__none__';

export class LibraryRepository {
  constructor(private db: Db) {}

  insert(row: NewGraphic, tags: string[]): void {
    this.db.transaction((tx) => {
      tx.insert(graphics).values(row).run();
      if (tags.length) tx.insert(graphicTags).values(tags.map((tag) => ({ graphicId: row.id, tag }))).run();
    });
    this.reindex(row.id);
  }

  update(id: string, patch: Partial<NewGraphic>, tags?: string[]): void {
    this.db.transaction((tx) => {
      tx.update(graphics).set(patch).where(eq(graphics.id, id)).run();
      if (tags) {
        tx.delete(graphicTags).where(eq(graphicTags.graphicId, id)).run();
        if (tags.length) tx.insert(graphicTags).values(tags.map((tag) => ({ graphicId: id, tag }))).run();
      }
    });
    this.reindex(id);
  }

  delete(id: string): void {
    this.db.delete(graphics).where(eq(graphics.id, id)).run();
    this.db.run(sql`DELETE FROM graphics_fts WHERE graphic_id = ${id}`);
  }

  get(id: string): GraphicDto | null {
    const row = this.db.select().from(graphics).where(eq(graphics.id, id)).get();
    return row ? this.toDto([row])[0]! : null;
  }

  getMany(ids: string[]): GraphicDto[] {
    if (ids.length === 0) return [];
    return this.toDto(this.db.select().from(graphics).where(inArray(graphics.id, ids)).all());
  }

  findBySha(sha256: string): GraphicDto | null {
    const row = this.db.select().from(graphics).where(eq(graphics.sha256, sha256)).get();
    return row ? this.toDto([row])[0]! : null;
  }

  allIds(): string[] {
    return this.db.select({ id: graphics.id }).from(graphics).all().map((r) => r.id);
  }

  list(query: GraphicListQuery): GraphicListResponse {
    const where: SQL[] = [];
    const fts = query.q ? toFtsQuery(query.q) : null;
    // Wyszukiwanie pełnotekstowe przez FTS5 (MATCH, bm25) — ORM nie ma na to konstrukcji.
    if (fts) where.push(sql`${graphics.id} IN (SELECT graphic_id FROM graphics_fts WHERE graphics_fts MATCH ${fts})`);
    if (query.tagStatus) where.push(eq(graphics.tagStatus, query.tagStatus));
    if (query.category === NO_CATEGORY) where.push(isNull(graphics.category));
    else if (query.category) where.push(eq(graphics.category, query.category));
    for (const tag of query.tags ?? []) {
      where.push(sql`${graphics.id} IN (SELECT ${graphicTags.graphicId} FROM ${graphicTags} WHERE ${graphicTags.tag} = ${tag})`);
    }
    const cond = where.length ? and(...where) : undefined;
    const sort = query.sort ?? (fts ? 'relevance' : 'newest');
    const order: SQL[] =
      sort === 'title'
        ? [sql`${graphics.title} COLLATE NOCASE ASC`, asc(graphics.id)]
        : sort === 'recent-use'
          ? [sql`${graphics.lastUsedAt} IS NULL`, desc(graphics.lastUsedAt), desc(graphics.createdAt)]
          : sort === 'relevance' && fts
            ? [
                sql`(SELECT bm25(graphics_fts) FROM graphics_fts WHERE graphics_fts MATCH ${fts} AND graphic_id = ${graphics.id})`,
                desc(graphics.createdAt),
              ]
            : [desc(graphics.createdAt), asc(graphics.id)];
    const rows = this.db
      .select()
      .from(graphics)
      .where(cond)
      .orderBy(...order)
      .limit(query.limit ?? 200)
      .offset(query.offset ?? 0)
      .all();
    const total = this.db.select({ n: count() }).from(graphics).where(cond).get()!.n;
    return { items: this.toDto(rows), total };
  }

  facets(): FacetsDto {
    const statusRows = this.db
      .select({ s: graphics.tagStatus, n: count() })
      .from(graphics)
      .groupBy(graphics.tagStatus)
      .all();
    const tagStatus = Object.fromEntries(TAG_STATUSES.map((s) => [s, 0])) as Record<TagStatus, number>;
    for (const r of statusRows) tagStatus[r.s] = r.n;
    const categories = this.db
      .select({ name: graphics.category, count: count() })
      .from(graphics)
      .groupBy(graphics.category)
      .orderBy(sql`${graphics.category} IS NULL`, graphics.category)
      .all();
    const tags = this.db
      .select({ name: graphicTags.tag, count: count() })
      .from(graphicTags)
      .groupBy(graphicTags.tag)
      .orderBy(desc(count()), graphicTags.tag)
      .limit(100)
      .all();
    const total = this.db.select({ n: count() }).from(graphics).get()!.n;
    return { tagStatus, categories, tags, total };
  }

  usedIn(id: string): { id: string; name: string }[] {
    return this.db
      .select({ id: compositions.id, name: compositions.name })
      .from(compositionAssets)
      .innerJoin(compositions, eq(compositions.id, compositionAssets.compositionId))
      .where(eq(compositionAssets.graphicId, id))
      .orderBy(compositions.name)
      .all();
  }

  markUsed(ids: string[], at: string): void {
    if (ids.length === 0) return;
    this.db.update(graphics).set({ lastUsedAt: at }).where(inArray(graphics.id, ids)).run();
  }

  private tagsFor(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (ids.length === 0) return map;
    const rows = this.db
      .select()
      .from(graphicTags)
      .where(inArray(graphicTags.graphicId, ids))
      .orderBy(graphicTags.tag)
      .all();
    for (const r of rows) {
      if (!map.has(r.graphicId)) map.set(r.graphicId, []);
      map.get(r.graphicId)!.push(r.tag);
    }
    return map;
  }

  private toDto(rows: GraphicRow[]): GraphicDto[] {
    const tags = this.tagsFor(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      tags: tags.get(r.id) ?? [], // grafika bez wierszy w graphic_tags nie ma tagów
      colors: r.colors,
      width: r.width,
      height: r.height,
      viewBox: r.viewBox,
      sourceName: r.sourceName,
      author: r.author,
      license: r.license,
      tagStatus: r.tagStatus,
      version: r.version,
      sha256: r.sha256,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /** Odtwarza wiersz indeksu FTS dla grafiki z bieżących metadanych. */
  private reindex(id: string): void {
    const g = this.get(id);
    this.db.run(sql`DELETE FROM graphics_fts WHERE graphic_id = ${id}`);
    if (!g) return;
    this.db.run(
      sql`INSERT INTO graphics_fts (graphic_id, title, description, tags, category)
          VALUES (${id}, ${foldText(g.title)}, ${foldText(g.description)}, ${foldText(g.tags.join(' '))}, ${foldText(g.category ?? '')})`,
    );
  }
}

/**
 * Litery, których tokenizer FTS5 (remove_diacritics) nie sprowadza do liter podstawowych, bo
 * w Unicode nie są literą ze znakiem łączonym. Pozostałe polskie znaki obsługuje tokenizer.
 */
export function foldText(s: string): string {
  return s.replace(/ł/g, 'l').replace(/Ł/g, 'L');
}

/**
 * Zamienia tekst wyszukiwania na zapytanie FTS5: każde słowo musi wystąpić, a ostatnie może
 * być początkiem słowa. Znaki specjalne składni FTS są usuwane.
 */
export function toFtsQuery(q: string): string | null {
  const words = foldText(q)
    .split(/\s+/)
    .map((w) => w.replace(/["*^:(){}[\]+\-]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}
