import { escapeAttr, fmt } from '../svg/xml.js';
import type { ShapeNode } from './types.js';

/**
 * Wierzchołki wielokąta foremnego lub gwiazdy dopasowane do prostokąta (0,0,w,h): najpierw na
 * okręgu jednostkowym z wierzchołkiem u góry, potem przeskalowane do własnego prostokąta
 * otaczającego, żeby kształt dotykał wszystkich krawędzi swojego pola.
 */
export function shapePoints(node: Pick<ShapeNode, 'shape' | 'width' | 'height' | 'sides' | 'innerRatio'>): [number, number][] {
  const n = node.shape === 'star' ? node.sides * 2 : node.sides;
  const unit: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const r = node.shape === 'star' && i % 2 === 1 ? node.innerRatio : 1;
    unit.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const xs = unit.map((p) => p[0]);
  const ys = unit.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  return unit.map(([x, y]) => [((x - minX) / spanX) * node.width, ((y - minY) / spanY) * node.height]);
}

/** Element SVG kształtu (bez transformacji węzła). Deterministyczny: te same parametry, ten sam tekst. */
export function shapeElement(node: ShapeNode): string {
  const paint =
    node.shape === 'line'
      ? `fill="none"`
      : `fill="${node.fill === null ? 'none' : escapeAttr(node.fill)}"`;
  const stroke =
    node.stroke === null ? ` stroke="none"` : ` stroke="${escapeAttr(node.stroke)}" stroke-width="${fmt(node.strokeWidth)}"`;
  const style = `${paint}${stroke}`;
  const w = node.width;
  const h = node.height;
  switch (node.shape) {
    case 'rect': {
      const r = Math.min(node.cornerRadius, w / 2, h / 2);
      return `<rect width="${fmt(w)}" height="${fmt(h)}"${r > 0 ? ` rx="${fmt(r)}"` : ''} ${style}/>`;
    }
    case 'ellipse':
      return `<ellipse cx="${fmt(w / 2)}" cy="${fmt(h / 2)}" rx="${fmt(w / 2)}" ry="${fmt(h / 2)}" ${style}/>`;
    case 'polygon':
    case 'star':
      return `<polygon points="${shapePoints(node)
        .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
        .join(' ')}" ${style}/>`;
    case 'line':
      return `<line x1="0" y1="${fmt(h / 2)}" x2="${fmt(w)}" y2="${fmt(h / 2)}" ${style} stroke-linecap="round"/>`;
    default: {
      const never: never = node.shape;
      throw new Error(`Nieznany rodzaj kształtu: ${String(never)}`);
    }
  }
}
