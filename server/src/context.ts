import fs from 'node:fs';
import path from 'node:path';
import type { SettingsDto, SettingsPatch } from '@moniuszko/shared';
import { configFileSchema, resolveConfig, saveConfigFile, type ConfigFile, type ResolvedConfig } from './config.js';
import { EventBus } from './events.js';
import { CompositionService } from './compositions/service.js';
import { LibraryService } from './library/service.js';
import { Workspace } from './workspace.js';
import { badRequest } from './errors.js';

export type Logger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(`UWAGA: ${m}`),
  error: (m) => console.error(`BŁĄD: ${m}`),
};

/**
 * Stan procesu: konfiguracja, otwarty workspace i usługi na nim zbudowane. Zmiana ustawień
 * zamyka workspace i otwiera nowy, więc kod tras zawsze sięga po usługi przez kontekst.
 */
export class AppContext {
  readonly events = new EventBus();
  workspace!: Workspace;
  library!: LibraryService;
  compositions!: CompositionService;

  constructor(
    public config: ResolvedConfig,
    readonly log: Logger = consoleLogger,
  ) {
    this.open();
  }

  private open(): void {
    this.workspace = new Workspace(this.config);
    this.library = new LibraryService(this);
    this.compositions = new CompositionService(this);
    this.library.checkFiles();
    this.compositions.reindex();
  }

  settings(): SettingsDto {
    const c = this.config;
    return {
      configPath: c.configPath,
      workspace: c.workspace,
      libraryDir: c.libraryDir,
      compositionsDir: c.compositionsDir,
      exportsDir: c.exportsDir,
      port: c.port,
      normalizeSvg: c.normalizeSvg,
      warnDuplicates: c.warnDuplicates,
    };
  }

  /**
   * Zmienia ustawienia i zapisuje je w pliku konfiguracji. Przy `moveFiles` zawartość
   * zmienionych folderów biblioteki, kompozycji i eksportu jest przenoszona do nowych
   * miejsc; zmiana samego workspace nigdy nie przenosi bazy, tylko otwiera inny workspace.
   */
  reconfigure(patch: SettingsPatch): SettingsDto {
    const { moveFiles = false, ...fields } = patch;
    const next: ConfigFile = configFileSchema.parse({ ...this.config.file, ...stripUndefined(fields) });
    // Folder równy domyślnemu podfolderowi workspace nie jest zapisywany osobno.
    const resolvedNext = resolveConfig(this.config.configPath, next);
    for (const [key, name] of [
      ['libraryDir', 'library'],
      ['compositionsDir', 'compositions'],
      ['exportsDir', 'exports'],
    ] as const) {
      if (resolvedNext[key] === path.join(resolvedNext.workspace, name)) delete next[key];
    }
    const target = resolveConfig(this.config.configPath, next);
    const previous = this.config;

    const moves: [string, string][] = [];
    if (moveFiles) {
      for (const key of ['libraryDir', 'compositionsDir', 'exportsDir'] as const) {
        if (previous[key] !== target[key]) moves.push([previous[key], target[key]]);
      }
      for (const [, to] of moves) {
        if (fs.existsSync(to) && fs.readdirSync(to).length > 0) {
          throw badRequest(`Folder docelowy ${to} nie jest pusty; nie przenoszę do niego plików`);
        }
      }
    }

    this.workspace.close();
    try {
      for (const [from, to] of moves) moveDirectory(from, to);
      saveConfigFile(previous.configPath, next);
      this.config = target;
      this.open();
    } catch (e) {
      this.log.error(`Zmiana ustawień nie powiodła się: ${(e as Error).message}; przywracam poprzedni workspace`);
      this.config = previous;
      this.open();
      throw e;
    }
    for (const [from, to] of moves) this.log.info(`Przeniesiono ${from} → ${to}`);
    this.events.emit({ type: 'settings-changed' });
    return this.settings();
  }

  close(): void {
    this.workspace.close();
  }
}

function moveDirectory(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) fs.rmdirSync(to); // pusty, sprawdzone wcześniej
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    // Inny system plików: kopiowanie i usunięcie źródła.
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true });
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
