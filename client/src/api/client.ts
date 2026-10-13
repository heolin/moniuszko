import { nanoid } from 'nanoid';
import type {
  CompositionDto,
  CompositionWithSvgDto,
  ExportMode,
  FacetsDto,
  GraphicDetailDto,
  GraphicDto,
  GraphicListQuery,
  GraphicListResponse,
  GraphicMetadataPatch,
  ImportItemResult,
  SettingsDto,
  SettingsPatch,
} from '@moniuszko/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Identyfikator tej karty przeglądarki; serwer odsyła go w zdarzeniach o zapisie. nanoid, a nie
 * crypto.randomUUID, bo ten drugi nie działa poza bezpiecznym kontekstem (HTTP na serwerze).
 */
export const CLIENT_ID = nanoid();

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { 'X-Client-Id': CLIENT_ID } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${method} ${url}: HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Odpowiedź bez JSON (np. błąd proxy) — zostaje komunikat z kodem HTTP.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function text(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, `GET ${url}: HTTP ${res.status}`);
  return res.text();
}

function query(params: Record<string, string | number | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  settings: () => call<SettingsDto>('GET', '/api/settings'),
  updateSettings: (patch: SettingsPatch) => call<SettingsDto>('PUT', '/api/settings', patch),
  listDirs: (path?: string) => call<{ path: string; parent: string; dirs: string[] }>('GET', `/api/fs/dirs${query({ path })}`),

  graphics: (q: GraphicListQuery) =>
    call<GraphicListResponse>(
      'GET',
      `/api/graphics${query({ q: q.q, tagStatus: q.tagStatus, category: q.category, tags: q.tags, sort: q.sort, limit: q.limit, offset: q.offset })}`,
    ),
  facets: () => call<FacetsDto>('GET', '/api/graphics/facets'),
  graphic: (id: string) => call<GraphicDetailDto>('GET', `/api/graphics/${id}`),
  graphicSvg: (id: string) => text(`/api/graphics/${id}/svg`),
  graphicOriginal: (id: string) => text(`/api/graphics/${id}/original`),
  updateGraphic: (id: string, patch: GraphicMetadataPatch) => call<GraphicDto>('PATCH', `/api/graphics/${id}`, patch),
  deleteGraphic: (id: string) => call<void>('DELETE', `/api/graphics/${id}`),
  importGraphics: (files: File[], force = false) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    if (force) fd.append('force', '1');
    return call<ImportItemResult[]>('POST', '/api/graphics', fd);
  },
  replaceGraphicFile: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return call<{ graphic: GraphicDto; warnings: string[] }>('POST', `/api/graphics/${id}/file`, fd);
  },
  thumbnailUrl: (g: Pick<GraphicDto, 'id' | 'version' | 'updatedAt'>) =>
    `/api/graphics/${g.id}/thumbnail.png?v=${g.version}-${encodeURIComponent(g.updatedAt)}`,
  svgUrl: (g: Pick<GraphicDto, 'id' | 'version'>) => `/api/graphics/${g.id}/svg?v=${g.version}`,

  compositions: () => call<{ items: CompositionDto[]; broken: { file: string; error: string }[] }>('GET', '/api/compositions'),
  composition: (id: string) => call<CompositionWithSvgDto>('GET', `/api/compositions/${id}`),
  createComposition: (body: { name: string; width: number; height: number }) =>
    call<CompositionDto>('POST', '/api/compositions', body),
  saveComposition: (id: string, svg: string, revision: number) =>
    call<CompositionDto>('PUT', `/api/compositions/${id}`, { svg, revision, clientId: CLIENT_ID }),
  patchComposition: (id: string, patch: { name?: string; status?: 'draft' | 'reviewed' }) =>
    call<CompositionDto>('PATCH', `/api/compositions/${id}`, patch),
  duplicateComposition: (id: string) => call<CompositionDto>('POST', `/api/compositions/${id}/duplicate`, {}),
  deleteComposition: (id: string) => call<void>('DELETE', `/api/compositions/${id}`),
  exportComposition: (id: string, body: { mode: ExportMode; dir?: string; fileName?: string }) =>
    call<{ path: string }>('POST', `/api/compositions/${id}/export`, body),
  compositionThumbUrl: (c: Pick<CompositionDto, 'id' | 'revision'>) => `/api/compositions/${c.id}/thumbnail.png?v=${c.revision}`,
};
