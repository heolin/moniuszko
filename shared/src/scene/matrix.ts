import type { Rect, Transform } from './types.js';

/** Macierz afiniczna w kolejności SVG: [a b c d e f] = matrix(a b c d e f). */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

const RAD = Math.PI / 180;

export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('Macierz transformacji jest osobliwa (skala 0?)');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function translateMatrix(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function rotateMatrix(deg: number): Matrix {
  const r = deg * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

export function scaleMatrix(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function skewXMatrix(deg: number): Matrix {
  return [1, 0, Math.tan(deg * RAD), 1, 0, 0];
}

export function toMatrix(t: Transform): Matrix {
  let m = translateMatrix(t.x, t.y);
  if (t.rotation) m = multiply(m, rotateMatrix(t.rotation));
  if (t.skewX) m = multiply(m, skewXMatrix(t.skewX));
  if (t.scaleX !== 1 || t.scaleY !== 1) m = multiply(m, scaleMatrix(t.scaleX, t.scaleY));
  return m;
}

/**
 * Rozkład macierzy na translate·rotate·skewX·scale. Dokładny dla każdej nieosobliwej
 * macierzy. Odbicie lustrzane trafia domyślnie do scaleY; przy `flipX` trafia do scaleX
 * (wtedy węzeł odbity w poziomie zachowuje swój obrót zamiast dostać +180°).
 */
export function fromMatrix(m: Matrix, flipX = false): Transform {
  if (flipX) {
    const t = fromMatrix(multiply(m, scaleMatrix(-1, 1)));
    return clean({ ...t, scaleX: -t.scaleX });
  }
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('Macierz transformacji jest osobliwa (skala 0?)');
  const scaleX = Math.hypot(a, b);
  const rotation = Math.atan2(b, a) / RAD;
  // Po zdjęciu obrotu: [scaleX, 0; scaleY*tan(skew), scaleY]
  const cos = a / scaleX;
  const sin = b / scaleX;
  const c2 = cos * c + sin * d; // = scaleY * tan(skew)
  const d2 = -sin * c + cos * d; // = scaleY
  const scaleY = d2; // różne od zera, bo det = scaleX * scaleY
  const skewX = Math.atan(c2 / scaleY) / RAD;
  return clean({ x: e, y: f, rotation, skewX, scaleX, scaleY });
}

function round(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

/** Zaokrągla do 6 miejsc, żeby serializacja była stabilna po złożeniach macierzy. */
export function clean(t: Transform): Transform {
  return {
    x: round(t.x),
    y: round(t.y),
    rotation: round(normalizeAngle(t.rotation)),
    skewX: round(t.skewX),
    scaleX: round(t.scaleX),
    scaleY: round(t.scaleY),
  };
}

export function normalizeAngle(deg: number): number {
  let r = deg % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}

export function applyToPoint(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Prostokąt otaczający obraz prostokąta `r` po przekształceniu macierzą `m`. */
export function transformRect(m: Matrix, r: Rect): Rect {
  const pts = [
    applyToPoint(m, r.x, r.y),
    applyToPoint(m, r.x + r.width, r.y),
    applyToPoint(m, r.x, r.y + r.height),
    applyToPoint(m, r.x + r.width, r.y + r.height),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
