import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { COMPOSITION_AUTHORS, COMPOSITION_STATUSES, TAG_STATUSES } from '@moniuszko/shared';

// Indeks pełnotekstowy graphics_fts (FTS5) nie ma odpowiednika w schemacie Drizzle;
// tworzy go migracja drizzle/0001_graphics_fts.sql, a utrzymuje library/repository.ts.

export const graphics = sqliteTable(
  'graphics',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    category: text('category'),
    colors: text('colors', { mode: 'json' }).$type<string[]>().notNull(),
    width: real('width').notNull(),
    height: real('height').notNull(),
    viewBox: text('view_box').notNull(),
    sourceName: text('source_name'),
    author: text('author'),
    license: text('license'),
    tagStatus: text('tag_status', { enum: TAG_STATUSES }).notNull().default('untagged'),
    /** Rośnie przy każdej podmianie pliku grafiki; instancje w kompozycjach pamiętają swoją wersję. */
    version: integer('version').notNull().default(1),
    sha256: text('sha256').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastUsedAt: text('last_used_at'),
  },
  (t) => [
    index('graphics_sha256_idx').on(t.sha256),
    index('graphics_tag_status_idx').on(t.tagStatus),
    index('graphics_category_idx').on(t.category),
  ],
);

export const graphicTags = sqliteTable(
  'graphic_tags',
  {
    graphicId: text('graphic_id')
      .notNull()
      .references(() => graphics.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [primaryKey({ columns: [t.graphicId, t.tag] }), index('graphic_tags_tag_idx').on(t.tag)],
);

/** Indeks kompozycji. Źródłem prawdy są pliki SVG; tabela jest odtwarzana z nich przy starcie. */
export const compositions = sqliteTable('compositions', {
  id: text('id').primaryKey(), // nazwa pliku bez rozszerzenia
  name: text('name').notNull(),
  width: real('width').notNull(),
  height: real('height').notNull(),
  author: text('author', { enum: COMPOSITION_AUTHORS }).notNull(),
  status: text('status', { enum: COMPOSITION_STATUSES }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  revision: integer('revision').notNull(),
});

export const compositionAssets = sqliteTable(
  'composition_assets',
  {
    compositionId: text('composition_id')
      .notNull()
      .references(() => compositions.id, { onDelete: 'cascade' }),
    // Bez klucza obcego: kompozycja może zawierać kopię grafiki usuniętej z biblioteki.
    graphicId: text('graphic_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.compositionId, t.graphicId] }), index('composition_assets_graphic_idx').on(t.graphicId)],
);
