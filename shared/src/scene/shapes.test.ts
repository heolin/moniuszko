import { describe, expect, it } from 'vitest';
import { estimateTextMeasurer } from './bounds.js';
import { CommandError, createScene, createShapeNode, insertNode, sceneBounds, updateShape } from './commands.js';
import { applySceneOps } from './ops.js';
import { parseScene } from './parse.js';
import { serializeScene } from './serialize.js';
import { shapeElement, shapePoints } from './shapes.js';
import { getNode } from './tree.js';
import { SHAPE_KINDS } from './types.js';

const META = { name: 'K', author: 'human', status: 'reviewed' } as const;
const ctx = { measurer: estimateTextMeasurer };

describe('kształty', () => {
  it('każdy rodzaj przechodzi zapis i odczyt bez zmian', () => {
    let s = createScene(500, 500, ['A']);
    const layer = s.layers[0]!.id;
    SHAPE_KINDS.forEach((kind, i) => {
      s = insertNode(
        s,
        createShapeNode({
          id: `s${i}`,
          shape: kind,
          width: 100,
          height: 60,
          stroke: '#000000',
          cornerRadius: kind === 'rect' ? 8 : 0,
          transform: { x: i * 10, y: 5, rotation: 15, skewX: 0, scaleX: 1, scaleY: 1 },
        }),
        { containerId: layer },
      );
    });
    const svg = serializeScene(s, META);
    expect(parseScene(svg)).toEqual({ scene: s, meta: META });
    expect(svg).toContain('<rect width="100" height="60" rx="8"');
    expect(svg).toContain('<ellipse cx="50" cy="30" rx="50" ry="30"');
  });

  it('wielokąt i gwiazda wypełniają swoje pole', () => {
    for (const shape of ['polygon', 'star'] as const) {
      for (const sides of [3, 5, 6]) {
        const pts = shapePoints({ shape, width: 200, height: 100, sides, innerRatio: 0.4 });
        expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(0);
        expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(200);
        expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(0);
        expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(100);
        expect(pts).toHaveLength(shape === 'star' ? sides * 2 : sides);
      }
    }
  });

  it('linia nie ma wypełnienia i wymaga obrysu', () => {
    const line = createShapeNode({ id: 'l', shape: 'line', width: 100, height: 10 });
    expect(shapeElement(line)).toMatch(/^<line .*fill="none" stroke="#1f1e1b"/);
    expect(() => createShapeNode({ id: 'l', shape: 'line', width: 100, height: 10, fill: '#fff' })).toThrow(CommandError);
  });

  it('odrzuca niepoprawne parametry', () => {
    let s = createScene(100, 100, ['A']);
    s = insertNode(s, createShapeNode({ id: 'p', shape: 'polygon', width: 10, height: 10 }), { containerId: s.layers[0]!.id });
    expect(() => updateShape(s, 'p', { sides: 2 })).toThrow(CommandError);
    expect(() => updateShape(s, 'p', { strokeWidth: -1 })).toThrow(CommandError);
  });

  it('agent dodaje koło i zmienia jego wypełnienie', async () => {
    const scene = createScene(800, 600, ['Obiekty']);
    const r = await applySceneOps(
      scene,
      [
        { op: 'add_shape', shape: 'ellipse', layer: 'Obiekty', x: 100, y: 100, width: 200, height: 200, fill: '#f4c242', as: 'slonce' },
        { op: 'update', node: '$slonce', fill: null, stroke: '#e9a72b', strokeWidth: 8 },
      ],
      { ...ctx, loadGraphic: async () => Promise.reject(new Error('niepotrzebne')) },
    );
    const n = getNode(r.scene, r.created.slonce!).node;
    expect(n).toMatchObject({ type: 'shape', shape: 'ellipse', fill: null, stroke: '#e9a72b', strokeWidth: 8 });
    expect(sceneBounds(r.scene, n.id, ctx)).toEqual({ x: 100, y: 100, width: 200, height: 200 });
  });
});
