import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig } from './config.js';
import { openDatabase, type Db } from './db/index.js';

const ID_RE = /^[A-Za-z0-9_-]+$/;

/** Sprawdza identyfikator używany jako nazwa pliku; chroni przed wyjściem poza folder. */
export function assertSafeId(id: string, what = 'identyfikator'): string {
  if (!ID_RE.test(id)) throw new Error(`Niedozwolony ${what}: „${id}”`);
  return id;
}

/** Otwarty workspace: foldery na dysku i baza. Jeden na proces; zmiana ustawień tworzy nowy. */
export class Workspace {
  readonly db: Db;

  constructor(readonly config: ResolvedConfig) {
    for (const dir of [
      config.workspace,
      config.libraryDir,
      this.originalsDir,
      config.compositionsDir,
      config.exportsDir,
      this.graphicThumbsDir,
      this.compositionThumbsDir,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = openDatabase(path.join(config.workspace, 'moniuszko.db'));
  }

  get originalsDir(): string {
    return path.join(this.config.libraryDir, 'originals');
  }

  get graphicThumbsDir(): string {
    return path.join(this.config.workspace, 'thumbnails', 'graphics');
  }

  get compositionThumbsDir(): string {
    return path.join(this.config.workspace, 'thumbnails', 'compositions');
  }

  graphicPath(id: string): string {
    return path.join(this.config.libraryDir, `${assertSafeId(id)}.svg`);
  }

  originalPath(id: string): string {
    return path.join(this.originalsDir, `${assertSafeId(id)}.svg`);
  }

  graphicThumbPath(id: string): string {
    return path.join(this.graphicThumbsDir, `${assertSafeId(id)}.png`);
  }

  compositionPath(id: string): string {
    return path.join(this.config.compositionsDir, `${assertSafeId(id)}.svg`);
  }

  compositionThumbPath(id: string): string {
    return path.join(this.compositionThumbsDir, `${assertSafeId(id)}.png`);
  }

  close(): void {
    this.db.$client.close();
  }
}

/** Zapis przez plik tymczasowy i rename, żeby przerwany zapis nie zostawił uciętego pliku. */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
