// Operacje sceny w postaci danych — wejście narzędzia MCP `apply_scene_ops`. Każda operacja
// tłumaczy się na komendy z commands.ts. Lista wykonuje się w całości albo wcale.

import { z } from 'zod';
import { prepareAssetSvg } from '../svg/assetSvg.js';
import {
  CommandError,
  addLayer,
  align,
  createShapeNode,
  createTextNode,
  deleteLayer,
  deleteNodes,
  distribute,
  duplicate,
  flip,
  group,
  insertNode,
  moveBy,
  moveToContainer,
  reorder,
  resize,
  setCanvas,
  setRotation,
  setTransform,
  ungroup,
  updateLayer,
  updateNode,
  updateShape,
  updateText,
  type CommandCtx,
} from './commands.js';
import { getNode, randomId } from './tree.js';
import { SHAPE_KINDS, type AssetNode, type Scene } from './types.js';

const ref = z.string().min(1).describe('Id węzła albo alias "$nazwa" nadany wcześniej polem "as"');
const layerRef = z.string().min(1).describe('Id warstwy, alias "$nazwa" albo dokładna nazwa warstwy');
const alias = z
  .string()
  .regex(/^[A-Za-z_][\w-]*$/)
  .optional()
  .describe('Alias, pod którym kolejne operacje mogą odwołać się do utworzonego obiektu jako "$alias"');
const textProps = {
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().min(1).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  fill: z.string().min(1).optional().describe('Kolor tekstu, np. "#1f1e1b"'),
  anchor: z.enum(['start', 'middle', 'end']).optional().describe('Wyrównanie względem punktu x'),
  lineHeight: z.number().positive().optional(),
};

const shapeProps = {
  fill: z.string().nullable().optional().describe('Kolor wypełnienia albo null (bez wypełnienia)'),
  stroke: z.string().nullable().optional().describe('Kolor obrysu albo null (bez obrysu)'),
  strokeWidth: z.number().min(0).optional(),
  cornerRadius: z.number().min(0).optional().describe('Zaokrąglenie narożników prostokąta'),
  sides: z.number().int().min(3).max(64).optional().describe('Boki wielokąta albo ramiona gwiazdy'),
  innerRatio: z.number().gt(0).lt(1).optional().describe('Wcięcie gwiazdy: promień wewnętrzny / zewnętrzny'),
};

export const sceneOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('insert_graphic'),
    graphicId: z.string().min(1),
    layer: layerRef,
    x: z.number().describe('Lewa krawędź grafiki na płótnie (przed obrotem)'),
    y: z.number().describe('Górna krawędź grafiki na płótnie (przed obrotem)'),
    width: z.number().positive().optional().describe('Szerokość na płótnie; sama szerokość zachowuje proporcje'),
    height: z.number().positive().optional().describe('Wysokość na płótnie; sama wysokość zachowuje proporcje'),
    rotation: z.number().optional().describe('Obrót w stopniach wokół środka'),
    name: z.string().optional(),
    as: alias,
  }),
  z.object({
    op: z.literal('add_text'),
    text: z.string().min(1).describe('Treść; wiersze rozdzielone znakiem \\n'),
    layer: layerRef,
    x: z.number(),
    y: z.number().describe('Górna krawędź pierwszego wiersza'),
    rotation: z.number().optional(),
    name: z.string().optional(),
    ...textProps,
    as: alias,
  }),
  z.object({
    op: z.literal('add_shape'),
    shape: z.enum(SHAPE_KINDS).describe('rect (prostokąt, kwadrat), ellipse (elipsa, koło), polygon, star, line'),
    layer: layerRef,
    x: z.number().describe('Lewa krawędź kształtu (przed obrotem)'),
    y: z.number().describe('Górna krawędź kształtu (przed obrotem)'),
    width: z.number().positive(),
    height: z.number().positive().describe('Dla linii: wysokość pola, linia biegnie przez jego środek'),
    rotation: z.number().optional(),
    name: z.string().optional(),
    ...shapeProps,
    as: alias,
  }),
  z.object({
    op: z.literal('update'),
    node: ref,
    x: z.number().optional().describe('Przesunięcie węzła w układzie rodzica (dla grafiki: lewy górny róg przed obrotem)'),
    y: z.number().optional(),
    rotation: z.number().optional().describe('Obrót w stopniach; węzeł obraca się wokół swojego środka'),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    opacity: z.number().min(0).max(1).optional(),
    name: z.string().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    text: z.string().min(1).optional(),
    ...textProps,
    fill: z.string().nullable().optional().describe('Kolor tekstu albo wypełnienie kształtu (null: bez wypełnienia)'),
    stroke: shapeProps.stroke,
    strokeWidth: shapeProps.strokeWidth,
    cornerRadius: shapeProps.cornerRadius,
    sides: shapeProps.sides,
    innerRatio: shapeProps.innerRatio,
  }),
  z.object({ op: z.literal('move_by'), nodes: z.array(ref).min(1), dx: z.number(), dy: z.number() }),
  z.object({ op: z.literal('delete'), nodes: z.array(ref).min(1) }),
  z.object({
    op: z.literal('duplicate'),
    nodes: z.array(ref).min(1),
    dx: z.number().default(20),
    dy: z.number().default(20),
    as: z.array(z.string().regex(/^[A-Za-z_][\w-]*$/)).optional().describe('Aliasy kopii, w kolejności węzłów'),
  }),
  z.object({ op: z.literal('group'), nodes: z.array(ref).min(1), name: z.string().optional(), as: alias }),
  z.object({ op: z.literal('ungroup'), group: ref }),
  z.object({ op: z.literal('reorder'), nodes: z.array(ref).min(1), mode: z.enum(['front', 'back', 'forward', 'backward']) }),
  z.object({ op: z.literal('move_to_layer'), nodes: z.array(ref).min(1), layer: layerRef }),
  z.object({
    op: z.literal('align'),
    nodes: z.array(ref).min(1),
    mode: z.enum(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']),
    toCanvas: z.boolean().default(false),
  }),
  z.object({ op: z.literal('distribute'), nodes: z.array(ref).min(3), axis: z.enum(['horizontal', 'vertical']) }),
  z.object({ op: z.literal('flip'), nodes: z.array(ref).min(1), axis: z.enum(['horizontal', 'vertical']) }),
  z.object({ op: z.literal('add_layer'), name: z.string().min(1), index: z.number().int().min(0).optional(), as: alias }),
  z.object({
    op: z.literal('update_layer'),
    layer: layerRef,
    name: z.string().min(1).optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
  z.object({ op: z.literal('delete_layer'), layer: layerRef }),
  z.object({
    op: z.literal('set_canvas'),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    background: z.string().nullable().optional().describe('Kolor tła albo null dla przezroczystego'),
  }),
]);

export type SceneOp = z.infer<typeof sceneOpSchema>;
export type SceneOpInput = z.input<typeof sceneOpSchema>;

export type GraphicContent = { svg: string; version: number; title: string };

export type ApplyOpsDeps = CommandCtx & {
  loadGraphic(graphicId: string): Promise<GraphicContent>;
};

export type ApplyOpsResult = {
  scene: Scene;
  /** Alias → id obiektów utworzonych w tej liście operacji. */
  created: Record<string, string>;
  /** Id obiektów utworzonych przez każdą operację, w kolejności operacji. */
  results: { op: string; ids: string[] }[];
};

export class SceneOpError extends Error {
  constructor(
    readonly index: number,
    readonly op: string,
    message: string,
  ) {
    super(`Operacja #${index} (${op}): ${message}`);
  }
}

export async function applySceneOps(scene: Scene, ops: SceneOpInput[], deps: ApplyOpsDeps): Promise<ApplyOpsResult> {
  const aliases = new Map<string, string>();
  const results: ApplyOpsResult['results'] = [];
  let s = scene;
  for (let i = 0; i < ops.length; i++) {
    const raw = ops[i];
    const parsed = sceneOpSchema.safeParse(raw);
    const opName = typeof raw === 'object' && raw && 'op' in raw ? String(raw.op) : '?';
    if (!parsed.success) throw new SceneOpError(i, opName, z.prettifyError(parsed.error));
    try {
      const r = await applyOne(s, parsed.data, deps, aliases);
      s = r.scene;
      results.push({ op: parsed.data.op, ids: r.ids });
    } catch (e) {
      if (e instanceof SceneOpError) throw e;
      throw new SceneOpError(i, opName, e instanceof Error ? e.message : String(e));
    }
  }
  return { scene: s, created: Object.fromEntries(aliases), results };
}

function resolveNode(scene: Scene, r: string, aliases: Map<string, string>): string {
  const id = r.startsWith('$') ? aliases.get(r.slice(1)) : r;
  if (!id) throw new CommandError(`Nieznany alias „${r}”`);
  getNode(scene, id);
  return id;
}

function resolveLayer(scene: Scene, r: string, aliases: Map<string, string>): string {
  if (r.startsWith('$')) {
    const id = aliases.get(r.slice(1));
    if (!id) throw new CommandError(`Nieznany alias „${r}”`);
    return id;
  }
  if (scene.layers.some((l) => l.id === r)) return r;
  const byName = scene.layers.filter((l) => l.name === r);
  if (byName.length === 1) return byName[0]!.id;
  if (byName.length > 1) throw new CommandError(`Nazwa warstwy „${r}” nie jest jednoznaczna; podaj id`);
  throw new CommandError(`Nie ma warstwy „${r}” (ani o takim id, ani o takiej nazwie)`);
}

function remember(aliases: Map<string, string>, name: string | undefined, id: string): void {
  if (!name) return;
  if (aliases.has(name)) throw new CommandError(`Alias „${name}” jest już użyty`);
  aliases.set(name, id);
}

async function applyOne(
  scene: Scene,
  op: SceneOp,
  deps: ApplyOpsDeps,
  aliases: Map<string, string>,
): Promise<{ scene: Scene; ids: string[] }> {
  const node = (r: string) => resolveNode(scene, r, aliases);
  const nodes = (rs: string[]) => rs.map(node);
  switch (op.op) {
    case 'insert_graphic': {
      const layerId = resolveLayer(scene, op.layer, aliases);
      const graphic = await deps.loadGraphic(op.graphicId);
      const id = randomId('n');
      const prepared = prepareAssetSvg(graphic.svg, id);
      const asset: AssetNode = {
        type: 'asset',
        id,
        name: op.name ?? graphic.title,
        assetId: op.graphicId,
        assetVersion: graphic.version,
        width: prepared.width,
        height: prepared.height,
        svg: prepared.svg,
        transform: { x: op.x, y: op.y, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
        opacity: 1,
        hidden: false,
        locked: false,
      };
      let s = insertNode(scene, asset, { containerId: layerId });
      if (op.width !== undefined || op.height !== undefined) {
        s = resize(s, id, { width: op.width, height: op.height, keepAspect: true }, deps);
      }
      if (op.rotation) s = setRotation(s, id, op.rotation, deps);
      remember(aliases, op.as, id);
      return { scene: s, ids: [id] };
    }
    case 'add_text': {
      const layerId = resolveLayer(scene, op.layer, aliases);
      const id = randomId('n');
      const { op: _op, layer: _layer, as: _as, rotation, x, y, ...props } = op;
      const text = createTextNode({
        ...stripUndefined(props),
        id,
        text: op.text,
        transform: { x, y, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
      });
      let s = insertNode(scene, text, { containerId: layerId });
      if (rotation) s = setRotation(s, id, rotation, deps);
      remember(aliases, op.as, id);
      return { scene: s, ids: [id] };
    }
    case 'add_shape': {
      const layerId = resolveLayer(scene, op.layer, aliases);
      const id = randomId('n');
      const { op: _op, layer: _layer, as: _as, rotation, x, y, ...props } = op;
      const shape = createShapeNode({
        ...stripUndefined(props),
        id,
        shape: op.shape,
        width: op.width,
        height: op.height,
        transform: { x, y, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
      });
      let s = insertNode(scene, shape, { containerId: layerId });
      if (rotation) s = setRotation(s, id, rotation, deps);
      remember(aliases, op.as, id);
      return { scene: s, ids: [id] };
    }
    case 'update': {
      const id = node(op.node);
      let s = scene;
      const { x, y, rotation, width, height, opacity, name, hidden, locked } = op;
      if (x !== undefined || y !== undefined) s = setTransform(s, id, stripUndefined({ x, y }));
      if (width !== undefined || height !== undefined) s = resize(s, id, { width, height, keepAspect: true }, deps);
      if (rotation !== undefined) s = setRotation(s, id, rotation, deps);
      const props = stripUndefined({ opacity, name, hidden, locked });
      if (Object.keys(props).length) s = updateNode(s, id, props);
      // `fill` dotyczy tekstu albo kształtu, zależnie od rodzaju węzła.
      const isShape = getNode(s, id).node.type === 'shape';
      if (!isShape && op.fill === null) throw new CommandError('Tekst musi mieć kolor (fill nie może być null)');
      const textPatch = stripUndefined({
        text: op.text,
        fontSize: op.fontSize,
        fontFamily: op.fontFamily,
        fontWeight: op.fontWeight,
        fontStyle: op.fontStyle,
        fill: isShape ? undefined : (op.fill ?? undefined),
        anchor: op.anchor,
        lineHeight: op.lineHeight,
      });
      if (Object.keys(textPatch).length) s = updateText(s, id, textPatch);
      const shapePatch = stripUndefined({
        fill: isShape ? op.fill : undefined,
        stroke: op.stroke,
        strokeWidth: op.strokeWidth,
        cornerRadius: op.cornerRadius,
        sides: op.sides,
        innerRatio: op.innerRatio,
      });
      if (Object.keys(shapePatch).length) s = updateShape(s, id, shapePatch);
      return { scene: s, ids: [] };
    }
    case 'move_by':
      return { scene: moveBy(scene, nodes(op.nodes), op.dx, op.dy), ids: [] };
    case 'delete':
      return { scene: deleteNodes(scene, nodes(op.nodes)), ids: [] };
    case 'duplicate': {
      const r = duplicate(scene, nodes(op.nodes), { x: op.dx, y: op.dy });
      if (op.as) {
        if (op.as.length !== r.ids.length) throw new CommandError(`Podano ${op.as.length} aliasów dla ${r.ids.length} kopii`);
        op.as.forEach((a, i) => remember(aliases, a, r.ids[i]!));
      }
      return r;
    }
    case 'group': {
      const id = randomId('n');
      const s = group(scene, nodes(op.nodes), id, op.name ?? 'Grupa', deps);
      remember(aliases, op.as, id);
      return { scene: s, ids: [id] };
    }
    case 'ungroup':
      return { scene: ungroup(scene, node(op.group)), ids: [] };
    case 'reorder':
      return { scene: reorder(scene, nodes(op.nodes), op.mode), ids: [] };
    case 'move_to_layer':
      return { scene: moveToContainer(scene, nodes(op.nodes), resolveLayer(scene, op.layer, aliases)), ids: [] };
    case 'align':
      return { scene: align(scene, nodes(op.nodes), op.mode, deps, op.toCanvas), ids: [] };
    case 'distribute':
      return { scene: distribute(scene, nodes(op.nodes), op.axis, deps), ids: [] };
    case 'flip':
      return { scene: flip(scene, nodes(op.nodes), op.axis, deps), ids: [] };
    case 'add_layer': {
      const id = randomId('l');
      const s = addLayer(scene, { id, name: op.name, index: op.index });
      remember(aliases, op.as, id);
      return { scene: s, ids: [id] };
    }
    case 'update_layer': {
      const { name, hidden, locked } = op;
      return { scene: updateLayer(scene, resolveLayer(scene, op.layer, aliases), stripUndefined({ name, hidden, locked })), ids: [] };
    }
    case 'delete_layer':
      return { scene: deleteLayer(scene, resolveLayer(scene, op.layer, aliases)), ids: [] };
    case 'set_canvas': {
      const { width, height, background } = op;
      return { scene: setCanvas(scene, stripUndefined({ width, height, background })), ids: [] };
    }
    default: {
      const never: never = op;
      throw new CommandError(`Nieznana operacja: ${JSON.stringify(never)}`);
    }
  }
}

function stripUndefined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
