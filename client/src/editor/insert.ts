import {
  createShapeNode,
  createTextNode,
  getNode,
  insertNode,
  moveToContainer,
  prepareAssetSvg,
  randomId,
  replaceAssetContent,
  setRotation,
  type AssetNode,
  type Point,
  type Scene,
  type SceneNode,
} from '@moniuszko/shared';
import { api } from '../api/client';
import { ctx, insertContainer, useEditor } from './store';

/**
 * Rozmiar nowo wstawionej grafiki: dłuższy bok zajmuje 30% krótszego boku płótna. Grafiki w
 * bibliotece mają różne jednostki (100×100, 2000×2000), więc rozmiar naturalny bywa przypadkowy.
 */
const INSERT_FRACTION = 0.3;

/** Wstawia grafikę z biblioteki tak, że jej środek trafia w `at` (układ płótna). */
export async function insertGraphic(graphicId: string, at?: Point): Promise<string> {
  const [graphic, svg] = await Promise.all([api.graphic(graphicId), api.graphicSvg(graphicId)]);
  const s = useEditor.getState();
  if (!s.scene) throw new Error('Edytor nie ma wczytanej kompozycji');
  const containerId = insertContainer(s);
  const id = randomId('n');
  const prepared = prepareAssetSvg(svg, id);
  const scale = (Math.min(s.scene.width, s.scene.height) * INSERT_FRACTION) / Math.max(prepared.width, prepared.height);
  const center = at ?? { x: s.scene.width / 2, y: s.scene.height / 2 };
  const node: AssetNode = {
    type: 'asset',
    id,
    name: graphic.title || graphic.sourceName || graphic.id,
    assetId: graphic.id,
    assetVersion: graphic.version,
    width: prepared.width,
    height: prepared.height,
    svg: prepared.svg,
    transform: {
      x: center.x - (prepared.width * scale) / 2,
      y: center.y - (prepared.height * scale) / 2,
      rotation: 0,
      skewX: 0,
      scaleX: scale,
      scaleY: scale,
    },
    opacity: 1,
    hidden: false,
    locked: false,
  };
  s.apply((scene) => insertAtWorld(scene, node, containerId));
  useEditor.getState().setSelection([id]);
  return id;
}

/**
 * Wstawia węzeł, którego transformacja jest w układzie płótna. Do grupy trafia przez jej
 * warstwę i moveToContainer, które przelicza transformację do układu grupy.
 */
function insertAtWorld(scene: Scene, node: SceneNode, containerId: string): Scene {
  if (scene.layers.some((l) => l.id === containerId)) return insertNode(scene, node, { containerId });
  const layerId = getNode(scene, containerId).layer.id;
  return moveToContainer(insertNode(scene, node, { containerId: layerId }), [node.id], containerId);
}

export function insertText(at: Point, text = 'Tekst'): string {
  const s = useEditor.getState();
  if (!s.scene) throw new Error('Edytor nie ma wczytanej kompozycji');
  const containerId = insertContainer(s);
  const id = randomId('n');
  const fontSize = Math.round(Math.min(s.scene.width, s.scene.height) / 12);
  const node = createTextNode({ id, text, fontSize, transform: { x: at.x, y: at.y - fontSize / 2, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 } });
  s.apply((scene) => insertAtWorld(scene, node, containerId));
  useEditor.getState().setSelection([id]);
  return id;
}

export type ShapePreset = 'rect' | 'square' | 'ellipse' | 'circle' | 'triangle' | 'polygon' | 'star' | 'line';

export const SHAPE_PRESETS: { preset: ShapePreset; label: string }[] = [
  { preset: 'rect', label: 'Prostokąt' },
  { preset: 'square', label: 'Kwadrat' },
  { preset: 'ellipse', label: 'Elipsa' },
  { preset: 'circle', label: 'Koło' },
  { preset: 'triangle', label: 'Trójkąt' },
  { preset: 'polygon', label: 'Sześciokąt' },
  { preset: 'star', label: 'Gwiazda' },
  { preset: 'line', label: 'Linia' },
];

/**
 * Wstawia kształt na środku płótna. Rozmiar: 20% krótszego boku płótna, prostokąt i elipsa
 * w proporcji 3:2, linia o długości 30% i polu wysokości grubości obrysu.
 */
export function insertShape(preset: ShapePreset, at?: Point): string {
  const s = useEditor.getState();
  if (!s.scene) throw new Error('Edytor nie ma wczytanej kompozycji');
  const containerId = insertContainer(s);
  const unit = Math.min(s.scene.width, s.scene.height) * 0.2;
  const id = randomId('n');
  const label = SHAPE_PRESETS.find((p) => p.preset === preset)!.label;
  const spec: Record<ShapePreset, Omit<Parameters<typeof createShapeNode>[0], 'id'>> = {
    rect: { shape: 'rect', width: unit * 1.5, height: unit },
    square: { shape: 'rect', width: unit, height: unit },
    ellipse: { shape: 'ellipse', width: unit * 1.5, height: unit },
    circle: { shape: 'ellipse', width: unit, height: unit },
    triangle: { shape: 'polygon', width: unit, height: unit, sides: 3 },
    polygon: { shape: 'polygon', width: unit, height: unit, sides: 6 },
    star: { shape: 'star', width: unit, height: unit, sides: 5 },
    line: { shape: 'line', width: unit * 1.5, height: 12, strokeWidth: 6 },
  };
  const p = spec[preset];
  const center = at ?? { x: s.scene.width / 2, y: s.scene.height / 2 };
  const node = createShapeNode({
    ...p,
    id,
    name: label,
    transform: { x: center.x - p.width / 2, y: center.y - p.height / 2, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
  });
  s.apply((scene) => insertAtWorld(scene, node, containerId));
  useEditor.getState().setSelection([id]);
  return id;
}

/** Podmienia treść instancji na aktualną wersję grafiki albo na inną grafikę z biblioteki. */
export async function replaceGraphic(nodeId: string, graphicId: string): Promise<void> {
  const [graphic, svg] = await Promise.all([api.graphic(graphicId), api.graphicSvg(graphicId)]);
  const prepared = prepareAssetSvg(svg, nodeId);
  useEditor.getState().apply((scene) =>
    replaceAssetContent(scene, nodeId, { ...prepared, version: graphic.version, assetId: graphic.id }),
  );
}

export function rotateTo(nodeId: string, degrees: number): void {
  useEditor.getState().apply((scene) => setRotation(scene, nodeId, degrees, ctx));
}
