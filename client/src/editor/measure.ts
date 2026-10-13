import { textLineBaselines, type Rect, type TextMeasurer, type TextNode } from '@moniuszko/shared';

const SVG_NS = 'http://www.w3.org/2000/svg';
let host: SVGSVGElement | null = null;
const cache = new Map<string, Rect>();

function ensureHost(): SVGSVGElement {
  if (host) return host;
  host = document.createElementNS(SVG_NS, 'svg');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;visibility:hidden';
  document.body.appendChild(host);
  return host;
}

/**
 * Wymiary tekstu zmierzone przez przeglądarkę (getBBox) na niewidocznym elemencie z tymi samymi
 * atrybutami, które zapisuje serializacja. Wynik jest w lokalnym układzie tekstu.
 */
export const domTextMeasurer: TextMeasurer = {
  measure(node: TextNode): Rect {
    const key = JSON.stringify([node.text, node.fontFamily, node.fontSize, node.fontWeight, node.fontStyle, node.anchor, node.lineHeight]);
    const hit = cache.get(key);
    if (hit) return hit;
    const svg = ensureHost();
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('font-family', node.fontFamily);
    text.setAttribute('font-size', String(node.fontSize));
    text.setAttribute('font-weight', String(node.fontWeight));
    text.setAttribute('font-style', node.fontStyle);
    text.setAttribute('text-anchor', node.anchor);
    text.setAttribute('xml:space', 'preserve');
    const baselines = textLineBaselines(node);
    node.text.split('\n').forEach((line, i) => {
      const span = document.createElementNS(SVG_NS, 'tspan');
      span.setAttribute('x', '0');
      span.setAttribute('y', String(baselines[i]));
      span.textContent = line;
      text.appendChild(span);
    });
    svg.appendChild(text);
    const b = text.getBBox();
    svg.removeChild(text);
    // Pusty wiersz nie ma szerokości; prostokąt dostaje wtedy wysokość wiersza, żeby dało się go zaznaczyć.
    const rect: Rect =
      b.width === 0 && b.height === 0 ? { x: 0, y: 0, width: node.fontSize * 0.5, height: node.fontSize * 1.25 } : { x: b.x, y: b.y, width: b.width, height: b.height };
    cache.set(key, rect);
    return rect;
  },
};

/** Po wczytaniu fontów (document.fonts) wymiary tekstu mogą się zmienić. */
export function clearMeasureCache(): void {
  cache.clear();
}
