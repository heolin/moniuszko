import { describe, expect, it } from 'vitest';
import { estimateTextMeasurer } from './bounds.js';
import {
  align,
  createScene,
  deleteLayer,
  distribute,
  duplicate,
  flip,
  group,
  insertNode,
  moveBy,
  moveToContainer,
  reorder,
  resize,
  rotateBy,
  sceneBounds,
  setRotation,
  ungroup,
  CommandError,
} from './commands.js';
import { getNode } from './tree.js';
import type { AssetNode, Rect, Scene } from './types.js';

const ctx = { measurer: estimateTextMeasurer };

function box(id: string, x: number, y: number, w = 100, h = 50): AssetNode {
  return {
    type: 'asset',
    id,
    name: id,
    assetId: 'a',
    assetVersion: 1,
    width: w,
    height: h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"><rect id="${id}-r" width="${w}" height="${h}"/></svg>`,
    transform: { x, y, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
    opacity: 1,
    hidden: false,
    locked: false,
  };
}

function scene(): Scene {
  let s = createScene(1000, 600, ['A', 'B']);
  const layer = s.layers[0]!.id;
  s = insertNode(s, box('a', 0, 0), { containerId: layer });
  s = insertNode(s, box('b', 200, 100), { containerId: layer });
  s = insertNode(s, box('c', 500, 300), { containerId: layer });
  return s;
}

function expectRect(r: Rect | null, e: Rect) {
  expect(r).not.toBeNull();
  expect(r!.x).toBeCloseTo(e.x, 4);
  expect(r!.y).toBeCloseTo(e.y, 4);
  expect(r!.width).toBeCloseTo(e.width, 4);
  expect(r!.height).toBeCloseTo(e.height, 4);
}

describe('komendy sceny', () => {
  it('nie zmieniają sceny wejściowej', () => {
    const s = scene();
    const before = JSON.stringify(s);
    moveBy(s, ['a'], 10, 10);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('obrót pojedynczego węzła zachowuje jego środek', () => {
    const s = setRotation(scene(), 'b', 90, ctx);
    const r = sceneBounds(s, 'b', ctx)!;
    expect(r.x + r.width / 2).toBeCloseTo(250);
    expect(r.y + r.height / 2).toBeCloseTo(125);
    expect(r.width).toBeCloseTo(50);
    expect(getNode(s, 'b').node.transform.rotation).toBeCloseTo(90);
  });

  it('grupowanie i rozgrupowanie zachowują położenie na płótnie', () => {
    let s = scene();
    const before = ['a', 'b'].map((id) => sceneBounds(s, id, ctx));
    s = group(s, ['a', 'b'], 'g', 'Grupa', ctx);
    expect(getNode(s, 'a').parent.id).toBe('g');
    ['a', 'b'].forEach((id, i) => expectRect(sceneBounds(s, id, ctx), before[i]!));
    s = rotateBy(s, ['g'], 30, ctx);
    const rotated = ['a', 'b'].map((id) => sceneBounds(s, id, ctx)!);
    s = ungroup(s, 'g');
    ['a', 'b'].forEach((id, i) => expectRect(sceneBounds(s, id, ctx), rotated[i]!));
    expect(s.layers[0]!.children.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('grupa ma położenie lewego górnego rogu zaznaczenia', () => {
    const s = group(scene(), ['b', 'c'], 'g', 'G', ctx);
    const g = getNode(s, 'g').node;
    expect(g.transform.x).toBe(200);
    expect(g.transform.y).toBe(100);
    expect(s.layers[0]!.children.map((n) => n.id)).toEqual(['a', 'g']);
  });

  it('grupowanie węzłów z różnych rodziców kończy się błędem', () => {
    let s = scene();
    s = moveToContainer(s, ['c'], s.layers[1]!.id);
    expect(() => group(s, ['a', 'c'], 'g', 'G', ctx)).toThrow(CommandError);
  });

  it('odbicie w poziomie zostawia obrót i ustawia ujemną scaleX', () => {
    let s = setRotation(scene(), 'a', 20, ctx);
    const before = sceneBounds(s, 'a', ctx)!;
    s = flip(s, ['a'], 'horizontal', ctx);
    const t = getNode(s, 'a').node.transform;
    expect(t.scaleX).toBeCloseTo(-1);
    expect(t.scaleY).toBeCloseTo(1);
    expect(t.rotation).toBeCloseTo(-20);
    expectRect(sceneBounds(s, 'a', ctx), before);
  });

  it('zmiana rozmiaru z zachowaniem proporcji', () => {
    const s = resize(scene(), 'a', { width: 200, keepAspect: true }, ctx);
    expectRect(sceneBounds(s, 'a', ctx), { x: 0, y: 0, width: 200, height: 100 });
  });

  it('wyrównanie do lewej krawędzi zaznaczenia', () => {
    const s = align(scene(), ['a', 'b', 'c'], 'left', ctx);
    for (const id of ['a', 'b', 'c']) expect(sceneBounds(s, id, ctx)!.x).toBeCloseTo(0);
  });

  it('rozłożenie daje równe odstępy', () => {
    const s = distribute(scene(), ['a', 'b', 'c'], 'horizontal', ctx);
    const xs = ['a', 'b', 'c'].map((id) => sceneBounds(s, id, ctx)!.x);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
  });

  it('kolejność: na wierzch i na spód', () => {
    let s = reorder(scene(), ['a'], 'front');
    expect(s.layers[0]!.children.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    s = reorder(s, ['c'], 'back');
    expect(s.layers[0]!.children.map((n) => n.id)).toEqual(['c', 'b', 'a']);
    s = reorder(s, ['c'], 'forward');
    expect(s.layers[0]!.children.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('kopia dostaje nowe id i nowy prefiks identyfikatorów w treści', () => {
    let n = 0;
    const r = duplicate(scene(), ['a'], { x: 10, y: 0 }, () => `k${++n}`);
    const copy = getNode(r.scene, 'k1').node as AssetNode;
    expect(r.ids).toEqual(['k1']);
    expect(copy.svg).toContain('id="k1-r"');
    expect(copy.transform.x).toBe(10);
  });

  it('przeniesienie do obróconej grupy zachowuje położenie', () => {
    let s = group(scene(), ['b'], 'g', 'G', ctx);
    s = rotateBy(s, ['g'], 45, ctx);
    const before = sceneBounds(s, 'c', ctx)!;
    s = moveToContainer(s, ['c'], 'g');
    expect(getNode(s, 'c').parent.id).toBe('g');
    expectRect(sceneBounds(s, 'c', ctx), before);
  });

  it('nie pozwala usunąć ostatniej warstwy', () => {
    const s = createScene(10, 10, ['Jedyna']);
    expect(() => deleteLayer(s, s.layers[0]!.id)).toThrow(CommandError);
  });
});
