import {
  estimateTextMeasurer,
  localBounds,
  multiply,
  toMatrix,
  transformRect,
  type CompositionMeta,
  type Matrix,
  type Rect,
  type Scene,
  type SceneNode,
  IDENTITY_MATRIX,
} from '@moniuszko/shared';

type NodeSummary = {
  id: string;
  type: SceneNode['type'];
  name: string;
  /** Parametry transformacji względem rodzica. */
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Prostokąt otaczający na płótnie (dla tekstu szacowany z liczby znaków). */
  bounds: Rect | null;
  opacity?: number;
  hidden?: true;
  locked?: true;
  graphicId?: string;
  text?: string;
  fontSize?: number;
  fill?: string | null;
  shape?: string;
  stroke?: string | null;
  children?: NodeSummary[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function round(rect: Rect | null): Rect | null {
  return rect && { x: r2(rect.x), y: r2(rect.y), width: r2(rect.width), height: r2(rect.height) };
}

function summarize(node: SceneNode, parent: Matrix): NodeSummary {
  const world = multiply(parent, toMatrix(node.transform));
  const local = localBounds(node, estimateTextMeasurer);
  const t = node.transform;
  const s: NodeSummary = {
    id: node.id,
    type: node.type,
    name: node.name,
    x: r2(t.x),
    y: r2(t.y),
    rotation: r2(t.rotation),
    scaleX: r2(t.scaleX),
    scaleY: r2(t.scaleY),
    bounds: round(local ? transformRect(world, local) : null),
  };
  if (node.opacity !== 1) s.opacity = node.opacity;
  if (node.hidden) s.hidden = true;
  if (node.locked) s.locked = true;
  if (node.type === 'asset') s.graphicId = node.assetId;
  if (node.type === 'text') {
    s.text = node.text;
    s.fontSize = node.fontSize;
    s.fill = node.fill;
  }
  if (node.type === 'shape') {
    s.shape = node.shape;
    s.fill = node.fill;
    s.stroke = node.stroke;
  }
  if (node.type === 'group') s.children = node.children.map((c) => summarize(c, world));
  return s;
}

/** Opis sceny dla agenta: płótno, warstwy od spodu do wierzchu i węzły bez treści SVG. */
export function describeScene(id: string, scene: Scene, meta: CompositionMeta) {
  return {
    id,
    name: meta.name,
    author: meta.author,
    status: meta.status,
    canvas: { width: scene.width, height: scene.height, background: scene.background },
    layers: scene.layers.map((l) => ({
      id: l.id,
      name: l.name,
      ...(l.hidden ? { hidden: true } : {}),
      ...(l.locked ? { locked: true } : {}),
      nodes: l.children.map((n) => summarize(n, IDENTITY_MATRIX)),
    })),
  };
}
