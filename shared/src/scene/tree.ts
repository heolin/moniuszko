import { IDENTITY_MATRIX, multiply, toMatrix, type Matrix } from './matrix.js';
import type { GroupNode, Layer, Scene, SceneNode } from './types.js';

export type NodeLocation = {
  node: SceneNode;
  /** Bezpośredni rodzic: warstwa albo grupa. */
  parent: Layer | GroupNode;
  index: number;
  layer: Layer;
  /** Grupy od warstwy w dół do rodzica (bez samego węzła). */
  ancestors: GroupNode[];
};

export function findNode(scene: Scene, id: string): NodeLocation | null {
  for (const layer of scene.layers) {
    const found = findIn(layer, layer, id, []);
    if (found) return found;
  }
  return null;
}

function findIn(
  parent: Layer | GroupNode,
  layer: Layer,
  id: string,
  ancestors: GroupNode[],
): NodeLocation | null {
  for (let index = 0; index < parent.children.length; index++) {
    const node = parent.children[index]!;
    if (node.id === id) return { node, parent, index, layer, ancestors };
    if (node.type === 'group') {
      const found = findIn(node, layer, id, [...ancestors, node]);
      if (found) return found;
    }
  }
  return null;
}

export function getNode(scene: Scene, id: string): NodeLocation {
  const loc = findNode(scene, id);
  if (!loc) throw new Error(`Nie ma węzła o id „${id}”`);
  return loc;
}

export function getLayer(scene: Scene, id: string): Layer {
  const layer = scene.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`Nie ma warstwy o id „${id}”`);
  return layer;
}

/** Rodzic po id: warstwa albo grupa. */
export function getContainer(scene: Scene, id: string): Layer | GroupNode {
  const layer = scene.layers.find((l) => l.id === id);
  if (layer) return layer;
  const loc = findNode(scene, id);
  if (!loc) throw new Error(`Nie ma warstwy ani grupy o id „${id}”`);
  if (loc.node.type !== 'group') throw new Error(`Węzeł „${id}” nie jest grupą`);
  return loc.node;
}

/** Macierz z układu rodzica węzła do układu płótna (złożenie transformacji grup-przodków). */
export function parentMatrix(loc: NodeLocation): Matrix {
  return loc.ancestors.reduce<Matrix>((m, g) => multiply(m, toMatrix(g.transform)), IDENTITY_MATRIX);
}

/** Macierz z lokalnego układu węzła do układu płótna. */
export function worldMatrix(loc: NodeLocation): Matrix {
  return multiply(parentMatrix(loc), toMatrix(loc.node.transform));
}

/** Macierz z układu kontenera (warstwy lub grupy) do układu płótna. */
export function containerMatrix(scene: Scene, containerId: string): Matrix {
  if (scene.layers.some((l) => l.id === containerId)) return IDENTITY_MATRIX;
  return worldMatrix(getNode(scene, containerId));
}

export function walkNodes(nodes: SceneNode[], fn: (node: SceneNode) => void): void {
  for (const node of nodes) {
    fn(node);
    if (node.type === 'group') walkNodes(node.children, fn);
  }
}

export function allNodes(scene: Scene): SceneNode[] {
  const out: SceneNode[] = [];
  for (const layer of scene.layers) walkNodes(layer.children, (n) => out.push(n));
  return out;
}

/** Identyfikatory grafik z biblioteki użytych w scenie, bez powtórzeń, w kolejności wystąpienia. */
export function usedAssetIds(scene: Scene): string[] {
  const ids = new Set<string>();
  for (const n of allNodes(scene)) if (n.type === 'asset') ids.add(n.assetId);
  return [...ids];
}

/** Czy `ancestorId` jest przodkiem (grupą zawierającą) węzła `id`. */
export function isDescendantOf(scene: Scene, id: string, ancestorId: string): boolean {
  const loc = findNode(scene, id);
  return loc ? loc.ancestors.some((g) => g.id === ancestorId) : false;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Losowy identyfikator węzła lub warstwy. Zaczyna się od litery, bo służy też jako prefiks
 * identyfikatorów XML wewnątrz wklejonych grafik.
 */
export function randomId(prefix: 'n' | 'l'): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = prefix;
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
