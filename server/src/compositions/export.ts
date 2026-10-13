import type { Element } from '@xmldom/xmldom';
import {
  elementChildren,
  fmt,
  parseXml,
  serializeScene,
  serializeXml,
  type CompositionMeta,
  type ExportMode,
  type Scene,
} from '@moniuszko/shared';
import { badRequest } from '../errors.js';

export type ExportDeps = {
  /** Odwołanie do pliku grafiki z biblioteki dla trybu z referencjami; null, gdy pliku nie ma. */
  graphicHref(graphicId: string): string | null;
};

/**
 * Plik eksportu kompozycji.
 *
 * - `standalone`: treść grafik zostaje wklejona.
 * - `linked`: każda instancja grafiki to <image href> wskazujący plik w bibliotece. Używamy
 *   <image>, a nie <use>, bo <use> do zewnętrznego pliku nie działa w części przeglądarek
 *   przy otwieraniu z dysku (file://).
 *
 * W obu trybach ukryte warstwy i obiekty są pomijane, a atrybuty edytora (data-mz-*) usuwane.
 */
export function exportComposition(scene: Scene, meta: CompositionMeta, mode: ExportMode, deps: ExportDeps): string {
  const doc = parseXml(serializeScene(scene, meta));
  const root = doc.documentElement!;
  const missing: string[] = [];
  transform(root, mode, deps, missing);
  if (missing.length) {
    throw badRequest(
      `Brak plików w bibliotece dla grafik: ${[...new Set(missing)].join(', ')}. Wyeksportuj kompozycję jako plik samodzielny.`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializeXml(root)}`;
}

function transform(el: Element, mode: ExportMode, deps: ExportDeps, missing: string[]): void {
  for (const child of elementChildren(el)) {
    if (child.getAttribute('data-mz-hidden') === '1') {
      el.removeChild(child);
      continue;
    }
    const assetId = child.getAttribute('data-mz-asset');
    if (assetId && mode === 'linked') {
      const inner = elementChildren(child)[0]!;
      const href = deps.graphicHref(assetId);
      if (href === null) {
        missing.push(assetId);
      } else {
        const image = child.ownerDocument!.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('href', href);
        image.setAttribute('width', fmt(Number(inner.getAttribute('width'))));
        image.setAttribute('height', fmt(Number(inner.getAttribute('height'))));
        child.replaceChild(image, inner);
      }
    } else if (!assetId) {
      transform(child, mode, deps, missing);
    }
    stripEditorAttrs(child);
  }
  stripEditorAttrs(el);
}

function stripEditorAttrs(el: Element): void {
  const names: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const name = el.attributes.item(i)!.name;
    if (name.startsWith('data-mz-')) names.push(name);
  }
  for (const n of names) el.removeAttribute(n);
}
