import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  findNode,
  getNode,
  parseScene,
  serializeScene,
  type CommandCtx,
  type CompositionMeta,
  type GroupNode,
  type Layer,
  type Scene,
  type SceneNode,
} from '@moniuszko/shared';
import { domTextMeasurer } from './measure';

export const ctx: CommandCtx = { measurer: domTextMeasurer };

export type Tool = 'select' | 'text' | 'pan';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export type Notice =
  | { kind: 'remote-change'; source: 'agent' | 'ui'; at: string; changed: string[] }
  | { kind: 'conflict'; source: 'agent' | 'ui' };

type Doc = { scene: Scene; meta: CompositionMeta };

export type EditorState = {
  id: string | null;
  scene: Scene | null;
  meta: CompositionMeta | null;
  /** Rewizja pliku na serwerze, od której zaczyna się bieżąca wersja w edytorze. */
  revision: number;
  /** Treść ostatnio zapisana lub wczytana; porównanie z bieżącą serializacją daje stan „zmieniona”. */
  savedSvg: string | null;
  saveState: SaveState;
  saveError: string | null;
  selection: string[];
  /** Grupa, do której „wszedł” użytkownik dwuklikiem; zaznaczanie działa wtedy na jej dzieciach. */
  enteredGroup: string | null;
  activeLayerId: string | null;
  tool: Tool;
  zoom: number;
  keepAspect: boolean;
  editingTextId: string | null;
  /** Węzły wyróżnione po zmianie z zewnątrz („Pokaż zmiany”). */
  highlight: string[];
  notice: Notice | null;
  gesture: Doc | null;
};

export type EditorActions = {
  load(id: string, svg: string, revision: number): void;
  reset(): void;
  /** Zmiana dokumentu przez komendę; tworzy wpis w historii. */
  apply(fn: (scene: Scene) => Scene): void;
  setMeta(patch: Partial<CompositionMeta>): void;
  /** Gest (przeciąganie, obrót, skalowanie): jeden wpis w historii na cały gest. */
  beginGesture(): void;
  updateGesture(fn: (start: Scene) => Scene): void;
  endGesture(): void;
  cancelGesture(): void;
  setSelection(ids: string[]): void;
  setEnteredGroup(id: string | null): void;
  setActiveLayer(id: string): void;
  setTool(tool: Tool): void;
  setZoom(zoom: number): void;
  setKeepAspect(v: boolean): void;
  setEditingText(id: string | null): void;
  setHighlight(ids: string[]): void;
  setNotice(n: Notice | null): void;
  markSaving(): void;
  markSaved(svg: string, revision: number): void;
  markSaveError(message: string, conflict: boolean): void;
  /** Zmiana z serwera: nowa treść staje się kolejnym krokiem historii (cofnięcie przywraca poprzednią). */
  applyRemote(svg: string, revision: number, source: 'agent' | 'ui'): void;
};

export type EditorStore = EditorState & EditorActions;

const initial: EditorState = {
  id: null,
  scene: null,
  meta: null,
  revision: 0,
  savedSvg: null,
  saveState: 'saved',
  saveError: null,
  selection: [],
  enteredGroup: null,
  activeLayerId: null,
  tool: 'select',
  zoom: 1,
  keepAspect: true,
  editingTextId: null,
  highlight: [],
  notice: null,
  gesture: null,
};

function serialize(s: { scene: Scene | null; meta: CompositionMeta | null }): string | null {
  return s.scene && s.meta ? serializeScene(s.scene, s.meta) : null;
}

/** Zaznaczenie bez węzłów, których już nie ma (po cofnięciu, zmianie z serwera itp.). */
function pruneSelection(scene: Scene, ids: string[]): string[] {
  return ids.filter((id) => findNode(scene, id) !== null);
}

function defaultActiveLayer(scene: Scene): string | null {
  const unlocked = scene.layers.filter((l) => !l.locked && !l.hidden);
  return (unlocked.at(-1) ?? scene.layers.at(-1))?.id ?? null;
}

/** Węzły różniące się między dwiema wersjami sceny (nowe lub zmienione). */
export function changedNodeIds(before: Scene, after: Scene): string[] {
  const prev = new Map<string, string>();
  const collect = (nodes: SceneNode[], into: Map<string, string>) => {
    for (const n of nodes) {
      into.set(n.id, JSON.stringify(n.type === 'group' ? { ...n, children: n.children.map((c) => c.id) } : n));
      if (n.type === 'group') collect(n.children, into);
    }
  };
  for (const l of before.layers) collect(l.children, prev);
  const next = new Map<string, string>();
  for (const l of after.layers) collect(l.children, next);
  return [...next].filter(([id, json]) => prev.get(id) !== json).map(([id]) => id);
}

export const useEditor = create<EditorStore>()(
  temporal(
    (set, get) => ({
      ...initial,

      load(id, svg, revision) {
        const { scene, meta } = parseScene(svg);
        set({
          ...initial,
          zoom: get().zoom,
          keepAspect: get().keepAspect,
          id,
          scene,
          meta,
          revision,
          savedSvg: serializeScene(scene, meta),
          activeLayerId: defaultActiveLayer(scene),
        });
        useEditor.temporal.getState().clear();
      },

      reset() {
        set({ ...initial, zoom: get().zoom, keepAspect: get().keepAspect });
        useEditor.temporal.getState().clear();
      },

      apply(fn) {
        const s = get();
        if (!s.scene) throw new Error('Edytor nie ma wczytanej kompozycji');
        const scene = fn(s.scene);
        set({ scene, selection: pruneSelection(scene, s.selection), saveState: 'dirty' });
      },

      setMeta(patch) {
        const s = get();
        if (!s.meta) throw new Error('Edytor nie ma wczytanej kompozycji');
        set({ meta: { ...s.meta, ...patch }, saveState: 'dirty' });
      },

      beginGesture() {
        const s = get();
        if (!s.scene || !s.meta) throw new Error('Edytor nie ma wczytanej kompozycji');
        useEditor.temporal.getState().pause();
        set({ gesture: { scene: s.scene, meta: s.meta } });
      },

      updateGesture(fn) {
        const g = get().gesture;
        if (!g) return;
        set({ scene: fn(g.scene) });
      },

      endGesture() {
        const s = get();
        const g = s.gesture;
        if (!g) return;
        const final = s.scene;
        // Przywrócenie stanu sprzed gestu przy wstrzymanej historii, potem jeden zapis stanu końcowego.
        set({ scene: g.scene, gesture: null });
        useEditor.temporal.getState().resume();
        if (final !== g.scene) set({ scene: final, saveState: 'dirty' });
      },

      cancelGesture() {
        const g = get().gesture;
        if (!g) return;
        set({ scene: g.scene, gesture: null });
        useEditor.temporal.getState().resume();
      },

      setSelection(ids) {
        const s = get();
        if (!s.scene) return;
        const selection = pruneSelection(s.scene, ids);
        const patch: Partial<EditorState> = { selection };
        const first = selection[0];
        if (first) {
          const layer = getNode(s.scene, first).layer;
          if (!layer.locked) patch.activeLayerId = layer.id;
        }
        set(patch);
      },

      setEnteredGroup(id) {
        set({ enteredGroup: id });
      },
      setActiveLayer(id) {
        set({ activeLayerId: id });
      },
      setTool(tool) {
        set({ tool });
      },
      setZoom(zoom) {
        set({ zoom: Math.min(16, Math.max(0.05, zoom)) });
      },
      setKeepAspect(v) {
        set({ keepAspect: v });
      },
      setEditingText(id) {
        set({ editingTextId: id });
      },
      setHighlight(ids) {
        set({ highlight: ids });
      },
      setNotice(n) {
        set({ notice: n });
      },
      markSaving() {
        set({ saveState: 'saving', saveError: null });
      },
      markSaved(svg, revision) {
        const current = serialize(get());
        // Zmiany zrobione w trakcie zapisu zostają oznaczone jako niezapisane.
        set({ savedSvg: svg, revision, saveState: current === svg ? 'saved' : 'dirty', saveError: null });
      },
      markSaveError(message, conflict) {
        set({ saveState: conflict ? 'conflict' : 'error', saveError: message });
      },

      applyRemote(svg, revision, source) {
        const s = get();
        const { scene, meta } = parseScene(svg);
        const changed = s.scene ? changedNodeIds(s.scene, scene) : [];
        set({
          scene,
          meta,
          revision,
          savedSvg: serializeScene(scene, meta),
          saveState: 'saved',
          saveError: null,
          selection: pruneSelection(scene, s.selection),
          enteredGroup: s.enteredGroup && findNode(scene, s.enteredGroup) ? s.enteredGroup : null,
          activeLayerId: scene.layers.some((l) => l.id === s.activeLayerId) ? s.activeLayerId : defaultActiveLayer(scene),
          notice: { kind: 'remote-change', source, at: new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }), changed },
        });
      },
    }),
    {
      partialize: (s): Doc => ({ scene: s.scene!, meta: s.meta! }),
      equality: (a, b) => a.scene === b.scene && a.meta === b.meta,
      limit: 200,
    },
  ),
);

/** Bieżąca serializacja dokumentu, albo null przed wczytaniem. */
export function currentSvg(): string | null {
  return serialize(useEditor.getState());
}

export function undo() {
  const s = useEditor.getState();
  if (s.gesture) return;
  useEditor.temporal.getState().undo();
  afterHistoryJump();
}

export function redo() {
  const s = useEditor.getState();
  if (s.gesture) return;
  useEditor.temporal.getState().redo();
  afterHistoryJump();
}

function afterHistoryJump() {
  const s = useEditor.getState();
  if (!s.scene) return;
  const svg = currentSvg();
  useEditor.setState({
    selection: pruneSelection(s.scene, s.selection),
    enteredGroup: s.enteredGroup && findNode(s.scene, s.enteredGroup) ? s.enteredGroup : null,
    saveState: svg === s.savedSvg ? 'saved' : 'dirty',
  });
}

/** Kontener, do którego trafiają nowe obiekty: grupa, w którą wszedł użytkownik, albo aktywna warstwa. */
export function insertContainer(s: EditorState): string {
  if (!s.scene) throw new Error('Edytor nie ma wczytanej kompozycji');
  if (s.enteredGroup) return s.enteredGroup;
  if (!s.activeLayerId) throw new Error('Brak aktywnej warstwy');
  const layer = s.scene.layers.find((l) => l.id === s.activeLayerId);
  if (!layer) throw new Error(`Nie ma warstwy ${s.activeLayerId}`);
  if (layer.locked) throw new Error(`Warstwa „${layer.name}” jest zablokowana`);
  return layer.id;
}

/** Węzły, które można zaznaczać na płótnie na bieżącym poziomie (warstwy albo wnętrze grupy). */
export function selectableNodes(s: EditorState): SceneNode[] {
  if (!s.scene) return [];
  if (s.enteredGroup) {
    const loc = findNode(s.scene, s.enteredGroup);
    if (!loc || loc.node.type !== 'group') return [];
    if (loc.layer.locked || loc.layer.hidden) return [];
    return (loc.node as GroupNode).children.filter((n) => !n.hidden && !n.locked);
  }
  return s.scene.layers
    .filter((l: Layer) => !l.hidden && !l.locked)
    .flatMap((l) => l.children.filter((n) => !n.hidden && !n.locked));
}
