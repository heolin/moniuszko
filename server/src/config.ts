import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Zawartość pliku moniuszko.config.json. Ścieżki względne liczą się od folderu tego pliku. */
export const configFileSchema = z
  .object({
    workspace: z.string().min(1),
    libraryDir: z.string().min(1).optional(),
    compositionsDir: z.string().min(1).optional(),
    exportsDir: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).default(4400),
    normalizeSvg: z.boolean().default(true),
    warnDuplicates: z.boolean().default(true),
  })
  .strict();

export type ConfigFile = z.infer<typeof configFileSchema>;

export const DEFAULT_CONFIG: ConfigFile = {
  workspace: './workspace',
  port: 4400,
  normalizeSvg: true,
  warnDuplicates: true,
};

/** Konfiguracja z rozwiązanymi ścieżkami bezwzględnymi. */
export type ResolvedConfig = {
  configPath: string;
  file: ConfigFile;
  workspace: string;
  libraryDir: string;
  compositionsDir: string;
  exportsDir: string;
  port: number;
  normalizeSvg: boolean;
  warnDuplicates: boolean;
};

export function resolveConfig(configPath: string, file: ConfigFile): ResolvedConfig {
  const base = path.dirname(path.resolve(configPath));
  const workspace = path.resolve(base, file.workspace);
  const sub = (value: string | undefined, name: string) => (value ? path.resolve(base, value) : path.join(workspace, name));
  return {
    configPath: path.resolve(configPath),
    file,
    workspace,
    libraryDir: sub(file.libraryDir, 'library'),
    compositionsDir: sub(file.compositionsDir, 'compositions'),
    exportsDir: sub(file.exportsDir, 'exports'),
    port: file.port,
    normalizeSvg: file.normalizeSvg,
    warnDuplicates: file.warnDuplicates,
  };
}

/**
 * Wczytuje konfigurację. Gdy pliku nie ma, tworzy go z wartościami domyślnymi
 * (DEFAULT_CONFIG) i zgłasza to w logu. Niepoprawny plik kończy się błędem.
 */
export function loadConfig(configPath: string, log: (msg: string) => void = console.log): ResolvedConfig {
  const abs = path.resolve(configPath);
  if (!fs.existsSync(abs)) {
    saveConfigFile(abs, DEFAULT_CONFIG);
    log(`Nie było pliku konfiguracji; utworzono ${abs} z wartościami domyślnymi`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`Nie można odczytać konfiguracji ${abs}: ${(e as Error).message}`);
  }
  const parsed = configFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Niepoprawna konfiguracja ${abs}:\n${z.prettifyError(parsed.error)}`);
  return resolveConfig(abs, parsed.data);
}

export function saveConfigFile(configPath: string, file: ConfigFile): void {
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n');
  fs.renameSync(tmp, configPath);
}
