import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { optimize } from 'svgo';

const { window } = new JSDOM('');
const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);

/** Odwołanie dozwolone w grafice: fragment tego samego pliku albo osadzony obraz rastrowy. */
function isLocalRef(value: string): boolean {
  const v = value.trim();
  return v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);/i.test(v);
}

/** url(...) wskazujące poza plik, oraz @import. */
const EXTERNAL_CSS = /@import|url\(\s*(['"]?)(?!#|data:image\/)[^)]*\1\s*\)/i;

let extraRemoved: string[] = [];

purify.addHook('uponSanitizeAttribute', (_node, data) => {
  const name = data.attrName;
  if ((name === 'href' || name === 'xlink:href') && !isLocalRef(data.attrValue)) {
    data.keepAttr = false;
    extraRemoved.push(`atrybut ${name} z zewnętrznym adresem`);
  } else if (name === 'style' && EXTERNAL_CSS.test(data.attrValue)) {
    data.keepAttr = false;
    extraRemoved.push('atrybut style z zewnętrznym url() lub @import');
  }
});

purify.addHook('uponSanitizeElement', (node) => {
  if (node.nodeName.toLowerCase() === 'style' && EXTERNAL_CSS.test(node.textContent ?? '')) {
    node.parentNode?.removeChild(node);
    extraRemoved.push('<style> z zewnętrznym url() lub @import');
  }
});

export type SanitizeResult = {
  svg: string;
  /** Opis usuniętych elementów i atrybutów, zgrupowany i policzony. */
  removed: string[];
};

/**
 * Usuwa z SVG skrypty, handlery zdarzeń, foreignObject, elementy edytorów (sodipodi,
 * inkscape) i odwołania do zasobów spoza pliku. Plik niebędący poprawnym XML z elementem
 * głównym <svg> jest odrzucany.
 */
export function sanitizeSvg(source: string): SanitizeResult {
  const doc = new window.DOMParser().parseFromString(source, 'image/svg+xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) throw new Error(`Niepoprawny XML: ${parserError.textContent?.trim().split('\n')[0] ?? ''}`);
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('Plik nie jest dokumentem SVG (element główny to nie <svg>)');
  }
  extraRemoved = [];
  purify.sanitize(root, { IN_PLACE: true, USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['use'] });
  const removed: string[] = [];
  for (const r of purify.removed as { element?: Element; attribute?: Attr | null }[]) {
    if (r.attribute) {
      // xmlns:* przestrzeni nazw usuniętych elementów nie są warte osobnego ostrzeżenia
      if (r.attribute.name.startsWith('xmlns:')) continue;
      removed.push(`atrybut ${r.attribute.name}`);
    } else if (r.element) {
      removed.push(`<${r.element.nodeName}>`);
    }
  }
  removed.push(...extraRemoved);
  return { svg: new window.XMLSerializer().serializeToString(root), removed: countItems(removed) };
}

function countItems(items: string[]): string[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} (${n}×)` : k));
}

/**
 * Normalizacja svgo (preset-default). W svgo 4 preset-default nie usuwa viewBox, od którego
 * zależą wymiary instancji w kompozycjach.
 */
export function normalizeSvg(svg: string): string {
  return optimize(svg, { multipass: true, plugins: ['preset-default'] }).data;
}
