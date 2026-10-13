// Typy danych wymienianych przez REST API, SSE i MCP.

export const TAG_STATUSES = ['untagged', 'ai', 'reviewed'] as const;
export type TagStatus = (typeof TAG_STATUSES)[number];

export type GraphicDto = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  tags: string[];
  colors: string[];
  width: number;
  height: number;
  viewBox: string;
  sourceName: string | null;
  author: string | null;
  license: string | null;
  tagStatus: TagStatus;
  version: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
};

export type GraphicDetailDto = GraphicDto & {
  usedIn: { id: string; name: string }[];
};

export type GraphicMetadataPatch = Partial<
  Pick<GraphicDto, 'title' | 'description' | 'category' | 'tags' | 'sourceName' | 'author' | 'license' | 'tagStatus'>
>;

export type GraphicListQuery = {
  q?: string;
  tagStatus?: TagStatus;
  category?: string;
  tags?: string[];
  sort?: 'newest' | 'title' | 'recent-use';
  limit?: number;
  offset?: number;
};

export type GraphicListResponse = {
  items: GraphicDto[];
  total: number;
};

export type FacetsDto = {
  tagStatus: Record<TagStatus, number>;
  categories: { name: string | null; count: number }[];
  tags: { name: string; count: number }[];
  total: number;
};

export type ImportItemResult =
  | { fileName: string; status: 'added'; graphic: GraphicDto; warnings: string[] }
  | { fileName: string; status: 'duplicate'; duplicateOf: GraphicDto; warnings: string[] }
  | { fileName: string; status: 'rejected'; error: string };

export const COMPOSITION_AUTHORS = ['human', 'agent'] as const;
export type CompositionAuthor = (typeof COMPOSITION_AUTHORS)[number];
export const COMPOSITION_STATUSES = ['draft', 'reviewed'] as const;
export type CompositionStatus = (typeof COMPOSITION_STATUSES)[number];

export type CompositionDto = {
  id: string;
  slug: string;
  name: string;
  width: number;
  height: number;
  author: CompositionAuthor;
  status: CompositionStatus;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Znacznik wersji pliku (mtime w ms); zapis z nieaktualnym znacznikiem kończy się 409. */
  revision: number;
};

export type CompositionWithSvgDto = CompositionDto & { svg: string };

export type ExportMode = 'standalone' | 'linked';

export type SettingsDto = {
  configPath: string;
  workspace: string;
  libraryDir: string;
  compositionsDir: string;
  exportsDir: string;
  port: number;
  normalizeSvg: boolean;
  warnDuplicates: boolean;
};

export type SettingsPatch = Partial<
  Pick<SettingsDto, 'workspace' | 'libraryDir' | 'compositionsDir' | 'exportsDir' | 'normalizeSvg' | 'warnDuplicates'>
> & {
  /** Przy zmianie folderu biblioteki lub kompozycji: przenieść istniejące pliki do nowego miejsca. */
  moveFiles?: boolean;
};

export type ServerEvent =
  | { type: 'composition-changed'; id: string; source: 'agent' | 'ui'; clientId?: string; revision: number }
  | { type: 'composition-deleted'; id: string }
  | { type: 'library-changed'; ids: string[] }
  | { type: 'settings-changed' };
