// Komendy sceny. Każda zmiana kompozycji — z edytora i z MCP — przechodzi przez te funkcje.
// Są czyste: dostają scenę i zwracają nową, nie zmieniając wejścia.

import { reprefixAssetSvg } from '../svg/assetSvg.js';
import { localBounds, nodeBounds, type TextMeasurer } from './bounds.js';
import {
  applyToPoint,
  fromMatrix,
  invert,
  multiply,
  rotateMatrix,
  scaleMatrix,
  toMatrix,
  transformRect,
  translateMatrix,
  unionRects,
  type Matrix,
} from './matrix.js';
import { findNode, getContainer, getLayer, getNode, parentMatrix, randomId, walkNodes, worldMatrix } from './tree.js';
import type { AssetNode, GroupNode, Layer, Rect, Scene, SceneNode, TextNode, Transform } from './types.js';

export class CommandError extends Error {}

export type CommandCtx = { measurer: TextMeasurer };

export type Point = { x: number; y: number };

function clone(scene: Scene): Scene {
  return structuredClone(scene);
}

function fail(msg: string): never {
  throw new CommandError(msg);
}

/** Usuwa z listy węzły, których przodek też jest na liście (operacja na grupie obejmuje dzieci). */
export function topLevelIds(scene: Scene, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !getNode(scene, id).ancestors.some((g) => set.has(g.id)));
}

// ---------------------------------------------------------------- granice

/** Prostokąt otaczający węzeł w układzie płótna. */
export function sceneBounds(scene: Scene, id: string, ctx: CommandCtx): Rect | null {
  const loc = getNode(scene, id);
  const local = localBounds(loc.node, ctx.measurer);
  return local ? transformRect(worldMatrix(loc), local) : null;
}

export function selectionBounds(scene: Scene, ids: string[], ctx: CommandCtx): Rect | null {
  return unionRects(ids.map((id) => sceneBounds(scene, id, ctx)).filter((r): r is Rect => r !== null));
}

function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Środek węzła w układzie płótna (środek jego lokalnego prostokąta po transformacji). */
export function nodeCenter(scene: Scene, id: string, ctx: CommandCtx): Point {
  const loc = getNode(scene, id);
  const local = localBounds(loc.node, ctx.measurer);
  if (!local) fail(`Węzeł „${id}” jest pustą grupą i nie ma środka`);
  return applyToPoint(worldMatrix(loc), local.x + local.width / 2, local.y + local.height / 2);
}

// ---------------------------------------------------------------- transformacje

/**
 * Składa przekształcenie wyrażone w układzie płótna z transformacją węzła:
 * M' = P⁻¹ · S · P · M, gdzie P to macierz rodzica.
 */
function applySceneMatrix(scene: Scene, id: string, s: Matrix, flipX?: boolean): void {
  const loc = getNode(scene, id);
  const p = parentMatrix(loc);
  const m = multiply(multiply(multiply(invert(p), s), p), toMatrix(loc.node.transform));
  loc.node.transform = fromMatrix(m, flipX ?? loc.node.transform.scaleX < 0);
}

function aroundPoint(pt: Point, m: Matrix): Matrix {
  return multiply(multiply(translateMatrix(pt.x, pt.y), m), translateMatrix(-pt.x, -pt.y));
}

/** Przesuwa węzły o wektor w układzie płótna. */
export function moveBy(scene: Scene, ids: string[], dx: number, dy: number): Scene {
  const s = clone(scene);
  for (const id of topLevelIds(s, ids)) applySceneMatrix(s, id, translateMatrix(dx, dy));
  return s;
}

/**
 * Obraca węzły o `delta` stopni wokół `pivot` (układ płótna). Bez `pivot` pojedynczy węzeł
 * obraca się wokół własnego środka, a kilka węzłów wokół środka zaznaczenia.
 */
export function rotateBy(scene: Scene, ids: string[], delta: number, ctx: CommandCtx, pivot?: Point): Scene {
  const s = clone(scene);
  const top = topLevelIds(s, ids);
  if (top.length === 0) return s;
  const pv = pivot ?? (top.length === 1 ? nodeCenter(s, top[0]!, ctx) : selectionPivot(s, top, ctx));
  for (const id of top) applySceneMatrix(s, id, aroundPoint(pv, rotateMatrix(delta)));
  return s;
}

function selectionPivot(scene: Scene, ids: string[], ctx: CommandCtx): Point {
  const r = selectionBounds(scene, ids, ctx);
  if (!r) fail('Zaznaczenie nie ma wymiarów');
  return center(r);
}

/** Ustawia obrót węzła (stopnie, względem rodzica), obracając go wokół jego środka. */
export function setRotation(scene: Scene, id: string, degrees: number, ctx: CommandCtx): Scene {
  const current = getNode(scene, id).node.transform.rotation;
  return rotateBy(scene, [id], degrees - current, ctx);
}

/** Skaluje węzły względem punktu `origin` w układzie płótna. */
export function scaleBy(scene: Scene, ids: string[], sx: number, sy: number, origin: Point): Scene {
  if (sx === 0 || sy === 0) fail('Skala nie może być zerowa');
  const s = clone(scene);
  for (const id of topLevelIds(s, ids)) applySceneMatrix(s, id, aroundPoint(origin, scaleMatrix(sx, sy)));
  return s;
}

/**
 * Skaluje jeden węzeł w jego własnych osiach (tak działają uchwyty narożne obróconego
 * obiektu). Punkt `anchor` w lokalnym układzie węzła zostaje w miejscu.
 */
export function scaleNode(scene: Scene, id: string, fx: number, fy: number, anchor: Point): Scene {
  if (fx === 0 || fy === 0) fail('Skala nie może być zerowa');
  const s = clone(scene);
  const node = getNode(s, id).node;
  const t = node.transform;
  const fixed = applyToPoint(toMatrix(t), anchor.x, anchor.y);
  const next: Transform = { ...t, scaleX: t.scaleX * fx, scaleY: t.scaleY * fy };
  const moved = applyToPoint(toMatrix({ ...next, x: 0, y: 0 }), anchor.x, anchor.y);
  node.transform = { ...next, x: fixed.x - moved.x, y: fixed.y - moved.y };
  return s;
}

/** Odbicie lustrzane węzłów względem środka zaznaczenia. */
export function flip(scene: Scene, ids: string[], axis: 'horizontal' | 'vertical', ctx: CommandCtx): Scene {
  const s = clone(scene);
  const top = topLevelIds(s, ids);
  if (top.length === 0) return s;
  const pv = top.length === 1 ? nodeCenter(s, top[0]!, ctx) : selectionPivot(s, top, ctx);
  const m = aroundPoint(pv, axis === 'horizontal' ? scaleMatrix(-1, 1) : scaleMatrix(1, -1));
  for (const id of top) {
    const wasFlippedX = getNode(s, id).node.transform.scaleX < 0;
    applySceneMatrix(s, id, m, axis === 'horizontal' ? !wasFlippedX : wasFlippedX);
  }
  return s;
}

/** Ustawia wybrane parametry transformacji bezpośrednio, bez przeliczeń. */
export function setTransform(scene: Scene, id: string, patch: Partial<Transform>): Scene {
  const s = clone(scene);
  const node = getNode(s, id).node;
  const next = { ...node.transform, ...patch };
  if (next.scaleX === 0 || next.scaleY === 0) fail('Skala nie może być zerowa');
  for (const [k, v] of Object.entries(next)) {
    if (!Number.isFinite(v)) fail(`Parametr transformacji ${k} nie jest liczbą`);
  }
  node.transform = next;
  return s;
}

/**
 * Ustawia rozmiar węzła po skalowaniu (w układzie rodzica, przed obrotem). Lewy górny róg
 * lokalnego prostokąta zostaje na miejscu.
 */
export function resize(
  scene: Scene,
  id: string,
  size: { width?: number; height?: number; keepAspect?: boolean },
  ctx: CommandCtx,
): Scene {
  const s = clone(scene);
  const loc = getNode(s, id);
  const local = localBounds(loc.node, ctx.measurer);
  if (!local || local.width === 0 || local.height === 0) fail(`Węzeł „${id}” nie ma wymiarów`);
  const t = loc.node.transform;
  let sx = Math.abs(t.scaleX);
  let sy = Math.abs(t.scaleY);
  if (size.width !== undefined) {
    if (!(size.width > 0)) fail('Szerokość musi być dodatnia');
    const k = size.width / local.width / sx;
    sx *= k;
    if (size.keepAspect && size.height === undefined) sy *= k;
  }
  if (size.height !== undefined) {
    if (!(size.height > 0)) fail('Wysokość musi być dodatnia');
    const k = size.height / local.height / sy;
    sy *= k;
    if (size.keepAspect && size.width === undefined) sx *= k;
  }
  const corner = applyToPoint(toMatrix(t), local.x, local.y);
  const next: Transform = { ...t, scaleX: Math.sign(t.scaleX) * sx, scaleY: Math.sign(t.scaleY) * sy };
  const moved = applyToPoint(toMatrix({ ...next, x: 0, y: 0 }), local.x, local.y);
  next.x = corner.x - moved.x;
  next.y = corner.y - moved.y;
  loc.node.transform = fromMatrix(toMatrix(next), next.scaleX < 0);
  return s;
}

// ---------------------------------------------------------------- wyrównanie

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Wyrównuje węzły do krawędzi lub środka. Jeden węzeł wyrównuje się do płótna, kilka — do
 * prostokąta zaznaczenia, chyba że `toCanvas` mówi inaczej.
 */
export function align(scene: Scene, ids: string[], mode: AlignMode, ctx: CommandCtx, toCanvas = false): Scene {
  const top = topLevelIds(scene, ids);
  if (top.length === 0) return clone(scene);
  const ref: Rect =
    toCanvas || top.length === 1
      ? { x: 0, y: 0, width: scene.width, height: scene.height }
      : (selectionBounds(scene, top, ctx) ?? fail('Zaznaczenie nie ma wymiarów'));
  let s = scene;
  for (const id of top) {
    const b = sceneBounds(s, id, ctx);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left': dx = ref.x - b.x; break;
      case 'hcenter': dx = ref.x + ref.width / 2 - (b.x + b.width / 2); break;
      case 'right': dx = ref.x + ref.width - (b.x + b.width); break;
      case 'top': dy = ref.y - b.y; break;
      case 'vcenter': dy = ref.y + ref.height / 2 - (b.y + b.height / 2); break;
      case 'bottom': dy = ref.y + ref.height - (b.y + b.height); break;
      default: fail(`Nieznany tryb wyrównania: ${String(mode)}`);
    }
    s = moveBy(s, [id], dx, dy);
  }
  return s === scene ? clone(scene) : s;
}

/** Rozkłada co najmniej trzy węzły tak, żeby odstępy między nimi były równe. */
export function distribute(scene: Scene, ids: string[], axis: 'horizontal' | 'vertical', ctx: CommandCtx): Scene {
  const top = topLevelIds(scene, ids);
  if (top.length < 3) fail('Rozłożenie wymaga co najmniej trzech obiektów');
  const items = top
    .map((id) => ({ id, b: sceneBounds(scene, id, ctx) }))
    .filter((i): i is { id: string; b: Rect } => i.b !== null);
  const pos = (r: Rect) => (axis === 'horizontal' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'horizontal' ? r.width : r.height);
  items.sort((a, b) => pos(a.b) - pos(b.b));
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const span = pos(last.b) + size(last.b) - pos(first.b);
  const total = items.reduce((acc, i) => acc + size(i.b), 0);
  const gap = (span - total) / (items.length - 1);
  let s = scene;
  let cursor = pos(first.b);
  for (const item of items) {
    const d = cursor - pos(item.b);
    s = moveBy(s, [item.id], axis === 'horizontal' ? d : 0, axis === 'vertical' ? d : 0);
    cursor += size(item.b) + gap;
  }
  return s;
}

// ---------------------------------------------------------------- struktura

export type InsertTarget = { containerId: string; index?: number };

export function insertNode(scene: Scene, node: SceneNode, target: InsertTarget): Scene {
  const s = clone(scene);
  if (findNode(s, node.id) || s.layers.some((l) => l.id === node.id)) fail(`Identyfikator „${node.id}” jest już zajęty`);
  const container = getContainer(s, target.containerId);
  const index = target.index ?? container.children.length;
  if (index < 0 || index > container.children.length) fail(`Indeks ${index} poza zakresem`);
  container.children.splice(index, 0, node);
  return s;
}

export function deleteNodes(scene: Scene, ids: string[]): Scene {
  const s = clone(scene);
  for (const id of topLevelIds(s, ids)) {
    const loc = getNode(s, id);
    loc.parent.children.splice(loc.index, 1);
  }
  return s;
}

/** Kopiuje węzły (z nowymi identyfikatorami) tuż nad oryginałami, przesunięte o `offset`. */
export function duplicate(
  scene: Scene,
  ids: string[],
  offset: Point = { x: 20, y: 20 },
  newId: () => string = () => randomId('n'),
): { scene: Scene; ids: string[] } {
  let s = clone(scene);
  const created: string[] = [];
  for (const id of topLevelIds(s, ids)) {
    const loc = getNode(s, id);
    const copy = reidentify(structuredClone(loc.node), newId);
    loc.parent.children.splice(loc.index + 1, 0, copy);
    created.push(copy.id);
  }
  if (offset.x !== 0 || offset.y !== 0) s = moveBy(s, created, offset.x, offset.y);
  return { scene: s, ids: created };
}

/**
 * Wkleja kopie węzłów (z nowymi identyfikatorami) na wierzch kontenera. Węzły zachowują swoje
 * transformacje, więc wklejone do innego kontenera trafiają w to samo miejsce jego układu.
 */
export function pasteNodes(
  scene: Scene,
  nodes: SceneNode[],
  containerId: string,
  offset: Point = { x: 0, y: 0 },
  newId: () => string = () => randomId('n'),
): { scene: Scene; ids: string[] } {
  const s = clone(scene);
  const container = getContainer(s, containerId);
  const ids: string[] = [];
  for (const n of nodes) {
    const copy = reidentify(structuredClone(n), newId);
    copy.transform = { ...copy.transform, x: copy.transform.x + offset.x, y: copy.transform.y + offset.y };
    container.children.push(copy);
    ids.push(copy.id);
  }
  return { scene: s, ids };
}

function reidentify(node: SceneNode, newId: () => string): SceneNode {
  const oldId = node.id;
  node.id = newId();
  if (node.type === 'asset') node.svg = reprefixAssetSvg(node.svg, oldId, node.id);
  if (node.type === 'group') node.children = node.children.map((c) => reidentify(c, newId));
  return node;
}

/**
 * Łączy węzły o wspólnym rodzicu w grupę. Grupa ma przesunięcie równe lewemu górnemu
 * rogowi zaznaczenia, a dzieci są w jej układzie, więc x/y grupy opisują jej położenie.
 */
export function group(scene: Scene, ids: string[], groupId: string, name: string, ctx: CommandCtx): Scene {
  const s = clone(scene);
  const top = topLevelIds(s, ids);
  if (top.length === 0) fail('Nie podano węzłów do zgrupowania');
  const locs = top.map((id) => getNode(s, id));
  const parent = locs[0]!.parent;
  if (locs.some((l) => l.parent !== parent)) fail('Grupować można tylko węzły o wspólnym rodzicu (ta sama warstwa lub grupa)');
  locs.sort((a, b) => a.index - b.index);
  const box = unionRects(locs.map((l) => nodeBounds(l.node, ctx.measurer)).filter((r): r is Rect => r !== null)) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const insertAt = locs[locs.length - 1]!.index - (locs.length - 1);
  for (const l of [...locs].reverse()) parent.children.splice(l.index, 1);
  const children = locs.map((l) => {
    l.node.transform = { ...l.node.transform, x: l.node.transform.x - box.x, y: l.node.transform.y - box.y };
    return l.node;
  });
  const g: GroupNode = {
    id: groupId,
    name,
    type: 'group',
    transform: { x: box.x, y: box.y, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
    opacity: 1,
    hidden: false,
    locked: false,
    children,
  };
  parent.children.splice(insertAt, 0, g);
  return s;
}

/** Rozwiązuje grupę; dzieci przejmują jej transformację i zajmują jej miejsce. */
export function ungroup(scene: Scene, groupId: string): Scene {
  const s = clone(scene);
  const loc = getNode(s, groupId);
  if (loc.node.type !== 'group') fail(`Węzeł „${groupId}” nie jest grupą`);
  const g = loc.node;
  const gm = toMatrix(g.transform);
  const children = g.children.map((c) => {
    c.transform = fromMatrix(multiply(gm, toMatrix(c.transform)), c.transform.scaleX < 0);
    if (g.opacity !== 1) c.opacity = Math.round(c.opacity * g.opacity * 1e6) / 1e6;
    return c;
  });
  loc.parent.children.splice(loc.index, 1, ...children);
  return s;
}

export type ReorderMode = 'front' | 'back' | 'forward' | 'backward';

/** Zmienia kolejność węzłów w obrębie ich rodziców. */
export function reorder(scene: Scene, ids: string[], mode: ReorderMode): Scene {
  const s = clone(scene);
  const top = topLevelIds(s, ids);
  const byParent = new Map<Layer | GroupNode, Set<string>>();
  for (const id of top) {
    const loc = getNode(s, id);
    if (!byParent.has(loc.parent)) byParent.set(loc.parent, new Set());
    byParent.get(loc.parent)!.add(id);
  }
  for (const [parent, set] of byParent) {
    const list = parent.children;
    const isSel = (n: SceneNode) => set.has(n.id);
    switch (mode) {
      case 'front':
        parent.children = [...list.filter((n) => !isSel(n)), ...list.filter(isSel)];
        break;
      case 'back':
        parent.children = [...list.filter(isSel), ...list.filter((n) => !isSel(n))];
        break;
      case 'forward':
        for (let i = list.length - 2; i >= 0; i--) {
          if (isSel(list[i]!) && !isSel(list[i + 1]!)) [list[i], list[i + 1]] = [list[i + 1]!, list[i]!];
        }
        break;
      case 'backward':
        for (let i = 1; i < list.length; i++) {
          if (isSel(list[i]!) && !isSel(list[i - 1]!)) [list[i], list[i - 1]] = [list[i - 1]!, list[i]!];
        }
        break;
      default:
        fail(`Nieznany tryb zmiany kolejności: ${String(mode)}`);
    }
  }
  return s;
}

/**
 * Przenosi węzły do innego kontenera (warstwy lub grupy), zachowując ich położenie na
 * płótnie. Trafiają na wierzch kontenera, w dotychczasowej kolejności.
 */
export function moveToContainer(scene: Scene, ids: string[], containerId: string): Scene {
  const s = clone(scene);
  const top = topLevelIds(s, ids);
  if (top.includes(containerId)) fail('Nie można przenieść grupy do niej samej');
  const target = getContainer(s, containerId);
  const targetIsLayer = s.layers.some((l) => l.id === containerId);
  const targetMatrix = targetIsLayer ? null : worldMatrix(getNode(s, containerId));
  const moved: SceneNode[] = [];
  for (const id of top) {
    const loc = getNode(s, id);
    if (!targetIsLayer && findNode(s, containerId)!.ancestors.some((g) => g.id === id)) {
      fail('Nie można przenieść grupy do jej własnego potomka');
    }
    const world = worldMatrix(loc);
    const local = targetMatrix ? multiply(invert(targetMatrix), world) : world;
    loc.node.transform = fromMatrix(local, loc.node.transform.scaleX < 0);
    loc.parent.children.splice(loc.index, 1);
    moved.push(loc.node);
  }
  target.children.push(...moved);
  return s;
}

// ---------------------------------------------------------------- właściwości

export type NodePropsPatch = Partial<Pick<SceneNode, 'name' | 'opacity' | 'hidden' | 'locked'>>;

export function updateNode(scene: Scene, id: string, patch: NodePropsPatch): Scene {
  const s = clone(scene);
  const node = getNode(s, id).node;
  if (patch.opacity !== undefined && !(patch.opacity >= 0 && patch.opacity <= 1)) fail('Krycie musi być w zakresie 0–1');
  Object.assign(node, patch);
  return s;
}

export type TextPatch = Partial<
  Pick<TextNode, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'fill' | 'anchor' | 'lineHeight'>
>;

export function updateText(scene: Scene, id: string, patch: TextPatch): Scene {
  const s = clone(scene);
  const node = getNode(s, id).node;
  if (node.type !== 'text') fail(`Węzeł „${id}” nie jest tekstem`);
  if (patch.fontSize !== undefined && !(patch.fontSize > 0)) fail('Rozmiar fontu musi być dodatni');
  if (patch.lineHeight !== undefined && !(patch.lineHeight > 0)) fail('Interlinia musi być dodatnia');
  Object.assign(node, patch);
  return s;
}

/**
 * Podmienia treść instancji: na nowszą wersję tej samej grafiki albo (z `assetId`) na inną
 * grafikę z biblioteki. Położenie i obrót zostają; skala jest dobrana tak, żeby nowa treść
 * zajęła prostokąt o tej samej szerokości co poprzednia.
 */
export function replaceAssetContent(
  scene: Scene,
  id: string,
  content: { svg: string; width: number; height: number; version: number; assetId?: string },
): Scene {
  const s = clone(scene);
  const node = getNode(s, id).node;
  if (node.type !== 'asset') fail(`Węzeł „${id}” nie jest grafiką z biblioteki`);
  const asset: AssetNode = node;
  const k = asset.width / content.width;
  if (k !== 1) {
    asset.transform = { ...asset.transform, scaleX: asset.transform.scaleX * k, scaleY: asset.transform.scaleY * k };
  }
  asset.svg = content.svg;
  asset.width = content.width;
  asset.height = content.height;
  asset.assetVersion = content.version;
  if (content.assetId) asset.assetId = content.assetId;
  return s;
}

// ---------------------------------------------------------------- warstwy i płótno

export function addLayer(scene: Scene, layer: { id: string; name: string; index?: number }): Scene {
  const s = clone(scene);
  if (s.layers.some((l) => l.id === layer.id) || findNode(s, layer.id)) fail(`Identyfikator „${layer.id}” jest już zajęty`);
  const index = layer.index ?? s.layers.length;
  if (index < 0 || index > s.layers.length) fail(`Indeks ${index} poza zakresem`);
  s.layers.splice(index, 0, { id: layer.id, name: layer.name, hidden: false, locked: false, children: [] });
  return s;
}

export function updateLayer(scene: Scene, id: string, patch: Partial<Pick<Layer, 'name' | 'hidden' | 'locked'>>): Scene {
  const s = clone(scene);
  Object.assign(getLayer(s, id), patch);
  return s;
}

export function deleteLayer(scene: Scene, id: string): Scene {
  const s = clone(scene);
  getLayer(s, id);
  if (s.layers.length === 1) fail('Kompozycja musi mieć co najmniej jedną warstwę');
  s.layers = s.layers.filter((l) => l.id !== id);
  return s;
}

export function moveLayer(scene: Scene, id: string, index: number): Scene {
  const s = clone(scene);
  const from = s.layers.findIndex((l) => l.id === id);
  if (from < 0) fail(`Nie ma warstwy o id „${id}”`);
  if (index < 0 || index >= s.layers.length) fail(`Indeks ${index} poza zakresem`);
  const [layer] = s.layers.splice(from, 1);
  s.layers.splice(index, 0, layer!);
  return s;
}

export function setCanvas(scene: Scene, patch: { width?: number; height?: number; background?: string | null }): Scene {
  const s = clone(scene);
  if (patch.width !== undefined) {
    if (!(patch.width > 0)) fail('Szerokość płótna musi być dodatnia');
    s.width = patch.width;
  }
  if (patch.height !== undefined) {
    if (!(patch.height > 0)) fail('Wysokość płótna musi być dodatnia');
    s.height = patch.height;
  }
  if (patch.background !== undefined) s.background = patch.background;
  return s;
}

// ---------------------------------------------------------------- tworzenie węzłów

export function createScene(width: number, height: number, layerNames: string[] = ['Tło', 'Obiekty', 'Teksty']): Scene {
  if (!(width > 0) || !(height > 0)) fail('Wymiary płótna muszą być dodatnie');
  return {
    width,
    height,
    background: null,
    layers: layerNames.map((name) => ({ id: randomId('l'), name, hidden: false, locked: false, children: [] })),
  };
}

export function createTextNode(props: Partial<Omit<TextNode, 'type'>> & { id: string; text: string }): TextNode {
  return {
    type: 'text',
    name: props.name ?? props.text.split('\n')[0]!.slice(0, 40),
    transform: props.transform ?? { x: 0, y: 0, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
    opacity: 1,
    hidden: false,
    locked: false,
    fontFamily: 'Georgia, serif',
    fontSize: 48,
    fontWeight: 400,
    fontStyle: 'normal',
    fill: '#1f1e1b',
    anchor: 'start',
    lineHeight: 1.2,
    ...props,
  };
}

/** Wszystkie identyfikatory w scenie (warstwy i węzły). */
export function allIds(scene: Scene): Set<string> {
  const ids = new Set<string>(scene.layers.map((l) => l.id));
  for (const l of scene.layers) walkNodes(l.children, (n) => ids.add(n.id));
  return ids;
}
