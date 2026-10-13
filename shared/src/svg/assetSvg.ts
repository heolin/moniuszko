import type { Element } from '@xmldom/xmldom';
import { SVG_NS, XLINK_NS, elementChildren, fmt, localName, parseXml, serializeXml } from './xml.js';

export type SvgDimensions = { width: number; height: number; viewBox: string };

/**
 * Wymiary grafiki: z atrybutów width/height, jeśli są w jednostkach bezwzględnych
 * (liczba lub px), a w przeciwnym razie z viewBox. Brak obu to błąd.
 */
export function readDimensions(root: Element): SvgDimensions {
  const vb = root.getAttribute('viewBox')?.trim();
  let vbW: number | null = null;
  let vbH: number | null = null;
  let viewBox: string | null = null;
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
      throw new Error(`Niepoprawny viewBox: „${vb}”`);
    }
    vbW = parts[2]!;
    vbH = parts[3]!;
    viewBox = parts.map(fmt).join(' ');
  }
  const w = parseLength(root.getAttribute('width'));
  const h = parseLength(root.getAttribute('height'));
  const width = w ?? vbW;
  const height = h ?? vbH;
  if (width === null || height === null || width <= 0 || height <= 0) {
    throw new Error('Grafika nie ma określonych wymiarów (brak viewBox oraz width/height w px)');
  }
  return { width, height, viewBox: viewBox ?? `0 0 ${fmt(width)} ${fmt(height)}` };
}

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*(px)?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

/**
 * Zmienia identyfikatory XML wewnątrz fragmentu SVG funkcją `rename` i poprawia odwołania do
 * nich: url(#id) w atrybutach i stylach, href/xlink:href="#id" oraz selektory #id w <style>.
 */
export function rewriteIds(root: Element, rename: (id: string) => string): void {
  const map = new Map<string, string>();
  visit(root, (el) => {
    const id = el.getAttribute('id');
    if (id) map.set(id, rename(id));
  });
  if (map.size === 0) return;

  const escaped = [...map.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const urlRe = new RegExp(`url\\(\\s*(['"]?)#(${escaped.join('|')})\\1\\s*\\)`, 'g');
  const selectorRe = new RegExp(`#(${escaped.join('|')})(?![\\w-])`, 'g');
  const replaceUrl = (s: string) => s.replace(urlRe, (_m, q: string, id: string) => `url(${q}#${map.get(id)}${q})`);

  visit(root, (el) => {
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs.item(i)!;
      const name = attr.name;
      let value = attr.value;
      if (name === 'id') {
        value = map.get(value) ?? value;
      } else if (name === 'href' || name === 'xlink:href') {
        if (value.startsWith('#') && map.has(value.slice(1))) value = `#${map.get(value.slice(1))}`;
      } else {
        value = replaceUrl(value);
      }
      if (value !== attr.value) el.setAttribute(name, value);
    }
    if (localName(el) === 'style' && el.textContent) {
      // Jedno przejście obejmuje zarówno selektory #id, jak i url(#id) w regułach CSS.
      el.textContent = el.textContent.replace(selectorRe, (_m, id: string) => `#${map.get(id)}`);
    }
  });
}

function visit(el: Element, fn: (el: Element) => void): void {
  fn(el);
  for (const c of elementChildren(el)) visit(c, fn);
}

/** Atrybuty elementu głównego, których nie przenosimy do zagnieżdżonego <svg> instancji. */
const DROPPED_ROOT_ATTRS = new Set(['x', 'y', 'width', 'height', 'version', 'baseProfile', 'id']);

/**
 * Buduje element <svg> wstawiany do kompozycji jako treść instancji grafiki: wymiary w
 * jednostkach użytkownika, viewBox, overflow="visible" oraz identyfikatory z prefiksem
 * `${nodeId}-`, żeby dwie instancje tej samej grafiki nie kolidowały.
 */
export function prepareAssetSvg(librarySvg: string, nodeId: string): { svg: string; width: number; height: number } {
  const doc = parseXml(librarySvg);
  const root = doc.documentElement!;
  if (localName(root) !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new Error('Grafika z biblioteki nie jest dokumentem SVG');
  }
  const dims = readDimensions(root);
  for (const name of [...DROPPED_ROOT_ATTRS]) root.removeAttribute(name);
  root.setAttribute('width', fmt(dims.width));
  root.setAttribute('height', fmt(dims.height));
  root.setAttribute('viewBox', dims.viewBox);
  root.setAttribute('overflow', 'visible');
  if (usesXlink(root) && !root.getAttribute('xmlns:xlink')) root.setAttribute('xmlns:xlink', XLINK_NS);
  rewriteIds(root, (id) => `${nodeId}-${id}`);
  return { svg: serializeXml(root), width: dims.width, height: dims.height };
}

function usesXlink(root: Element): boolean {
  let found = false;
  visit(root, (el) => {
    if (el.hasAttribute('xlink:href')) found = true;
  });
  return found;
}

/** Zmienia prefiks identyfikatorów treści instancji przy kopiowaniu węzła. */
export function reprefixAssetSvg(svg: string, fromNodeId: string, toNodeId: string): string {
  const root = parseXml(svg).documentElement!;
  const from = `${fromNodeId}-`;
  rewriteIds(root, (id) => (id.startsWith(from) ? `${toNodeId}-${id.slice(from.length)}` : `${toNodeId}-${id}`));
  return serializeXml(root);
}
