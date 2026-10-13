import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Parsuje dokument XML; błąd składni kończy się wyjątkiem z opisem parsera. */
export function parseXml(source: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level !== 'warning') errors.push(msg);
    },
  }).parseFromString(source, 'image/svg+xml');
  if (errors.length > 0) throw new Error(`Niepoprawny XML: ${errors[0]}`);
  if (!doc.documentElement) throw new Error('Niepoprawny XML: brak elementu głównego');
  return doc;
}

export function serializeXml(node: Element | Document): string {
  return new XMLSerializer().serializeToString(node);
}

export function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) out.push(n as Element);
  }
  return out;
}

export function localName(el: Element): string {
  return el.localName ?? el.nodeName;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;');
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Liczba w zapisie SVG: najwyżej 6 miejsc po przecinku, bez zbędnych zer. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Nieskończona lub nieokreślona liczba w SVG: ${n}`);
  const r = Math.round(n * 1e6) / 1e6;
  return String(Object.is(r, -0) ? 0 : r);
}
