import { describe, expect, it } from 'vitest';
import { fromMatrix, multiply, toMatrix } from './matrix.js';
import type { Transform } from './types.js';

const t = (p: Partial<Transform>): Transform => ({ x: 0, y: 0, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1, ...p });

function expectClose(a: Transform, b: Transform) {
  for (const k of Object.keys(a) as (keyof Transform)[]) expect(a[k]).toBeCloseTo(b[k], 5);
}

describe('fromMatrix', () => {
  it.each([
    t({}),
    t({ x: 10, y: -5 }),
    t({ rotation: 30 }),
    t({ rotation: -170, scaleX: 2, scaleY: 0.5 }),
    t({ x: 3, y: 4, rotation: 45, skewX: 12, scaleX: 1.5, scaleY: 3 }),
    t({ scaleY: -1, rotation: 20 }),
  ])('odtwarza %o', (tr) => {
    expectClose(fromMatrix(toMatrix(tr)), tr);
  });

  it('z flipX zachowuje odbicie w osi X', () => {
    const tr = t({ x: 5, rotation: 15, scaleX: -2, scaleY: 1 });
    expectClose(fromMatrix(toMatrix(tr), true), tr);
  });

  it('bez flipX przenosi odbicie do scaleY i obrotu', () => {
    const r = fromMatrix(toMatrix(t({ scaleX: -1 })));
    expect(r.scaleX).toBeCloseTo(1);
    expect(r.scaleY).toBeCloseTo(-1);
    expect(Math.abs(r.rotation)).toBeCloseTo(180);
  });

  it('rozkłada złożenie obróconej grupy z niejednorodnie skalowanym dzieckiem', () => {
    const g = toMatrix(t({ x: 100, rotation: 30 }));
    const c = toMatrix(t({ x: 10, scaleX: 2, scaleY: 1, rotation: -10 }));
    const m = multiply(g, c);
    const back = toMatrix(fromMatrix(m));
    m.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 5));
  });
});
