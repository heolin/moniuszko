import {
  align,
  deleteNodes,
  distribute,
  duplicate,
  findNode,
  flip,
  getNode,
  group,
  moveBy,
  pasteNodes,
  randomId,
  reorder,
  ungroup,
  type AlignMode,
  type ReorderMode,
  type Scene,
  type SceneNode,
} from '@moniuszko/shared';
import { ctx, insertContainer, redo, selectableNodes, undo, useEditor, type EditorState } from './store';

export type Action = {
  id: string;
  label: string;
  /** Skrót w zapisie do wyświetlenia, np. "Ctrl+G". */
  shortcut?: string;
  /** Dopasowanie zdarzenia klawiatury. */
  keys?: (e: KeyboardEvent) => boolean;
  enabled: (s: EditorState) => boolean;
  run: () => void | Promise<void>;
};

const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;
const hasScene = (s: EditorState) => s.scene !== null;
const hasSelection = (s: EditorState) => s.selection.length > 0;

function sel(): string[] {
  return useEditor.getState().selection;
}

function apply(fn: (scene: Scene) => Scene) {
  useEditor.getState().apply(fn);
}

/** Zaznaczone węzły mają wspólnego rodzica (warunek grupowania). */
function sameParent(s: EditorState): boolean {
  if (!s.scene || s.selection.length === 0) return false;
  const parents = new Set(s.selection.map((id) => findNode(s.scene!, id)?.parent.id));
  return parents.size === 1;
}

let clipboard: SceneNode[] = [];

function reorderAction(id: string, label: string, mode: ReorderMode, shortcut: string, keys: (e: KeyboardEvent) => boolean): Action {
  return { id, label, shortcut, keys, enabled: hasSelection, run: () => apply((sc) => reorder(sc, sel(), mode)) };
}

function alignAction(mode: AlignMode, label: string): Action {
  return { id: `align-${mode}`, label, enabled: hasSelection, run: () => apply((sc) => align(sc, sel(), mode, ctx)) };
}

function nudge(dx: number, dy: number) {
  apply((sc) => moveBy(sc, sel(), dx, dy));
}

export const ACTIONS: Action[] = [
  { id: 'undo', label: 'Cofnij', shortcut: 'Ctrl+Z', keys: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === 'z', enabled: () => useEditor.temporal.getState().pastStates.length > 0, run: undo },
  {
    id: 'redo',
    label: 'Ponów',
    shortcut: 'Ctrl+Shift+Z',
    keys: (e) => mod(e) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y'),
    enabled: () => useEditor.temporal.getState().futureStates.length > 0,
    run: redo,
  },
  { id: 'tool-select', label: 'Zaznaczanie', shortcut: 'V', keys: (e) => plain(e) && e.key.toLowerCase() === 'v', enabled: hasScene, run: () => useEditor.getState().setTool('select') },
  { id: 'tool-text', label: 'Tekst', shortcut: 'T', keys: (e) => plain(e) && e.key.toLowerCase() === 't', enabled: hasScene, run: () => useEditor.getState().setTool('text') },
  { id: 'tool-pan', label: 'Przesuwanie widoku', shortcut: 'H', keys: (e) => plain(e) && e.key.toLowerCase() === 'h', enabled: hasScene, run: () => useEditor.getState().setTool('pan') },
  {
    id: 'group',
    label: 'Grupuj',
    shortcut: 'Ctrl+G',
    keys: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === 'g',
    enabled: sameParent,
    run: () => {
      const id = randomId('n');
      apply((sc) => group(sc, sel(), id, 'Grupa', ctx));
      useEditor.getState().setSelection([id]);
    },
  },
  {
    id: 'ungroup',
    label: 'Rozgrupuj',
    shortcut: 'Ctrl+Shift+G',
    keys: (e) => mod(e) && e.shiftKey && e.key.toLowerCase() === 'g',
    enabled: (s) => !!s.scene && s.selection.some((id) => findNode(s.scene!, id)?.node.type === 'group'),
    run: () => {
      const s = useEditor.getState();
      const groups = s.selection.filter((id) => findNode(s.scene!, id)?.node.type === 'group');
      const children = groups.flatMap((g) => (getNode(s.scene!, g).node as { children: SceneNode[] }).children.map((c) => c.id));
      apply((sc) => groups.reduce((acc, g) => ungroup(acc, g), sc));
      useEditor.getState().setSelection(children);
    },
  },
  {
    id: 'delete',
    label: 'Usuń',
    shortcut: 'Delete',
    keys: (e) => plain(e) && (e.key === 'Delete' || e.key === 'Backspace'),
    enabled: hasSelection,
    run: () => {
      apply((sc) => deleteNodes(sc, sel()));
      useEditor.getState().setSelection([]);
    },
  },
  {
    id: 'duplicate',
    label: 'Duplikuj',
    shortcut: 'Ctrl+D',
    keys: (e) => mod(e) && e.key.toLowerCase() === 'd',
    enabled: hasSelection,
    run: () => {
      let ids: string[] = [];
      apply((sc) => {
        const r = duplicate(sc, sel());
        ids = r.ids;
        return r.scene;
      });
      useEditor.getState().setSelection(ids);
    },
  },
  {
    id: 'copy',
    label: 'Kopiuj',
    shortcut: 'Ctrl+C',
    keys: (e) => mod(e) && e.key.toLowerCase() === 'c',
    enabled: hasSelection,
    run: () => {
      const s = useEditor.getState();
      clipboard = s.selection.map((id) => structuredClone(getNode(s.scene!, id).node));
    },
  },
  {
    id: 'paste',
    label: 'Wklej',
    shortcut: 'Ctrl+V',
    keys: (e) => mod(e) && e.key.toLowerCase() === 'v',
    enabled: (s) => hasScene(s) && clipboard.length > 0,
    run: () => {
      const s = useEditor.getState();
      const containerId = insertContainer(s);
      let ids: string[] = [];
      apply((sc) => {
        const r = pasteNodes(sc, clipboard, containerId, { x: 20, y: 20 });
        ids = r.ids;
        return r.scene;
      });
      // Kolejne wklejenie trafi o 20 px dalej.
      clipboard = clipboard.map((n) => ({ ...n, transform: { ...n.transform, x: n.transform.x + 20, y: n.transform.y + 20 } }));
      useEditor.getState().setSelection(ids);
    },
  },
  {
    id: 'select-all',
    label: 'Zaznacz wszystko',
    shortcut: 'Ctrl+A',
    keys: (e) => mod(e) && e.key.toLowerCase() === 'a',
    enabled: hasScene,
    run: () => {
      const s = useEditor.getState();
      useEditor.getState().setSelection(selectableNodes(s).map((n) => n.id));
    },
  },
  reorderAction('front', 'Na wierzch', 'front', 'Ctrl+Shift+]', (e) => mod(e) && e.shiftKey && (e.key === ']' || e.key === '}')),
  reorderAction('forward', 'Wyżej', 'forward', 'Ctrl+]', (e) => mod(e) && !e.shiftKey && e.key === ']'),
  reorderAction('backward', 'Niżej', 'backward', 'Ctrl+[', (e) => mod(e) && !e.shiftKey && e.key === '['),
  reorderAction('back', 'Na spód', 'back', 'Ctrl+Shift+[', (e) => mod(e) && e.shiftKey && (e.key === '[' || e.key === '{')),
  alignAction('left', 'Wyrównaj do lewej'),
  alignAction('hcenter', 'Wyśrodkuj w poziomie'),
  alignAction('right', 'Wyrównaj do prawej'),
  alignAction('top', 'Wyrównaj do góry'),
  alignAction('vcenter', 'Wyśrodkuj w pionie'),
  alignAction('bottom', 'Wyrównaj do dołu'),
  {
    id: 'distribute-h',
    label: 'Rozłóż w poziomie',
    enabled: (s) => s.selection.length >= 3,
    run: () => apply((sc) => distribute(sc, sel(), 'horizontal', ctx)),
  },
  {
    id: 'distribute-v',
    label: 'Rozłóż w pionie',
    enabled: (s) => s.selection.length >= 3,
    run: () => apply((sc) => distribute(sc, sel(), 'vertical', ctx)),
  },
  { id: 'flip-h', label: 'Odbij w poziomie', enabled: hasSelection, run: () => apply((sc) => flip(sc, sel(), 'horizontal', ctx)) },
  { id: 'flip-v', label: 'Odbij w pionie', enabled: hasSelection, run: () => apply((sc) => flip(sc, sel(), 'vertical', ctx)) },
  { id: 'nudge-left', label: 'W lewo', keys: (e) => !mod(e) && e.key === 'ArrowLeft', enabled: hasSelection, run: () => nudge(-1, 0) },
  { id: 'nudge-right', label: 'W prawo', keys: (e) => !mod(e) && e.key === 'ArrowRight', enabled: hasSelection, run: () => nudge(1, 0) },
  { id: 'nudge-up', label: 'W górę', keys: (e) => !mod(e) && e.key === 'ArrowUp', enabled: hasSelection, run: () => nudge(0, -1) },
  { id: 'nudge-down', label: 'W dół', keys: (e) => !mod(e) && e.key === 'ArrowDown', enabled: hasSelection, run: () => nudge(0, 1) },
  {
    id: 'escape',
    label: 'Wyjdź z grupy / odznacz',
    shortcut: 'Esc',
    keys: (e) => e.key === 'Escape',
    enabled: hasScene,
    run: () => {
      const s = useEditor.getState();
      if (s.enteredGroup) {
        const g = s.enteredGroup;
        const parent = findNode(s.scene!, g)?.ancestors.at(-1)?.id ?? null;
        s.setEnteredGroup(parent);
        s.setSelection([g]);
      } else if (s.tool !== 'select') {
        s.setTool('select');
      } else {
        s.setSelection([]);
      }
    },
  },
];

const byId = new Map(ACTIONS.map((a) => [a.id, a]));

export function action(id: string): Action {
  const a = byId.get(id);
  if (!a) throw new Error(`Nieznana akcja: ${id}`);
  return a;
}

/** Strzałki z Shift przesuwają o 10 px; obsługa poza rejestrem, bo zmienia tylko krok. */
export function handleKeyDown(e: KeyboardEvent): boolean {
  if (e.shiftKey && !mod(e) && e.key.startsWith('Arrow')) {
    if (!hasSelection(useEditor.getState())) return false;
    const d = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
    if (!d) return false;
    nudge(d[0]!, d[1]!);
    return true;
  }
  for (const a of ACTIONS) {
    if (a.keys?.(e)) {
      if (!a.enabled(useEditor.getState())) return true; // skrót rozpoznany, ale akcja niedostępna
      void a.run();
      return true;
    }
  }
  return false;
}
