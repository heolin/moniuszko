import type { Element } from '@xmldom/xmldom';
import { readDimensions } from '../svg/assetSvg.js';
import { elementChildren, localName, parseXml, serializeXml } from '../svg/xml.js';
import {
  IDENTITY_MATRIX,
  fromMatrix,
  multiply,
  rotateMatrix,
  scaleMatrix,
  skewXMatrix,
  translateMatrix,
  type Matrix,
} from './matrix.js';
import { IDENTITY, type CompositionMeta, type GroupNode, type Layer, type Scene, type SceneNode, type TextNode, type Transform } from './types.js';

/** Błąd odczytu pliku kompozycji; wskazuje element, którego nie udało się zinterpretować. */
export class CompositionParseError extends Error {}

export function parseScene(source: string): { scene: Scene; meta: CompositionMeta } {
  const doc = parseXml(source);
  const root = doc.documentElement!;
  if (localName(root) !== 'svg') throw new CompositionParseError('Element główny nie jest <svg>');
  if (!root.hasAttribute('data-mz-composition')) {
    throw new CompositionParseError('To nie jest plik kompozycji Moniuszki (brak atrybutu data-mz-composition)');
  }
  const dims = readDimensions(root);
  const author = required(root, 'data-mz-author');
  if (author !== 'human' && author !== 'agent') throw new CompositionParseError(`Nieznany autor „${author}”`);
  const status = required(root, 'data-mz-status');
  if (status !== 'draft' && status !== 'reviewed') throw new CompositionParseError(`Nieznany status „${status}”`);
  const meta: CompositionMeta = { name: '', author, status };
  const scene: Scene = { width: dims.width, height: dims.height, background: null, layers: [] };
  for (const el of elementChildren(root)) {
    if (localName(el) === 'title') {
      meta.name = el.textContent ?? '';
    } else if (localName(el) === 'rect' && el.getAttribute('data-mz-role') === 'background') {
      scene.background = required(el, 'fill');
    } else if (localName(el) === 'g' && el.hasAttribute('data-mz-layer')) {
      scene.layers.push(parseLayer(el));
    } else {
      throw new CompositionParseError(`Nieoczekiwany element na najwyższym poziomie: ${describe(el)}`);
    }
  }
  return { scene, meta };
}

function parseLayer(el: Element): Layer {
  return {
    id: required(el, 'data-mz-layer'),
    name: el.getAttribute('data-mz-name') ?? '',
    hidden: el.getAttribute('data-mz-hidden') === '1',
    locked: el.getAttribute('data-mz-locked') === '1',
    children: elementChildren(el).map(parseNode),
  };
}

function parseNode(el: Element): SceneNode {
  if (!el.hasAttribute('data-mz-node')) {
    throw new CompositionParseError(`Element bez atrybutu data-mz-node: ${describe(el)}`);
  }
  const base = {
    id: required(el, 'data-mz-node'),
    name: el.getAttribute('data-mz-name') ?? '',
    transform: parseTransform(el.getAttribute('transform')),
    opacity: el.hasAttribute('opacity') ? num(el, 'opacity') : 1,
    hidden: el.getAttribute('data-mz-hidden') === '1',
    locked: el.getAttribute('data-mz-locked') === '1',
  };
  const tag = localName(el);
  if (tag === 'g' && el.hasAttribute('data-mz-asset')) {
    const kids = elementChildren(el);
    const inner = kids[0];
    if (kids.length !== 1 || !inner || localName(inner) !== 'svg') {
      throw new CompositionParseError(`Instancja grafiki ${base.id} musi zawierać dokładnie jeden element <svg>`);
    }
    const dims = readDimensions(inner);
    return {
      ...base,
      type: 'asset',
      assetId: required(el, 'data-mz-asset'),
      assetVersion: el.hasAttribute('data-mz-asset-version') ? num(el, 'data-mz-asset-version') : 1,
      width: dims.width,
      height: dims.height,
      svg: serializeXml(inner),
    };
  }
  if (tag === 'g' && el.getAttribute('data-mz-group') === '1') {
    const group: GroupNode = { ...base, type: 'group', children: elementChildren(el).map(parseNode) };
    return group;
  }
  if (tag === 'text') {
    const lines = elementChildren(el)
      .filter((c) => localName(c) === 'tspan')
      .map((c) => c.textContent ?? '');
    const anchor = el.getAttribute('text-anchor') ?? 'start';
    if (anchor !== 'start' && anchor !== 'middle' && anchor !== 'end') {
      throw new CompositionParseError(`Nieznana wartość text-anchor „${anchor}” w ${base.id}`);
    }
    const fontStyle = el.getAttribute('font-style') ?? 'normal';
    if (fontStyle !== 'normal' && fontStyle !== 'italic') {
      throw new CompositionParseError(`Nieznana wartość font-style „${fontStyle}” w ${base.id}`);
    }
    const text: TextNode = {
      ...base,
      type: 'text',
      text: lines.join('\n'),
      fontFamily: required(el, 'font-family'),
      fontSize: num(el, 'font-size'),
      fontWeight: el.hasAttribute('font-weight') ? num(el, 'font-weight') : 400,
      fontStyle,
      fill: required(el, 'fill'),
      anchor,
      lineHeight: el.hasAttribute('data-mz-line-height') ? num(el, 'data-mz-line-height') : 1.2,
    };
    return text;
  }
  throw new CompositionParseError(`Nieznany rodzaj węzła ${base.id}: ${describe(el)}`);
}

const NUM = '(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?)';
/** Postać zapisywana przez serializeScene: translate? rotate? skewX? scale?. */
const CANONICAL = new RegExp(
  `^(?:translate\\(${NUM} ${NUM}\\))?\\s*(?:rotate\\(${NUM}\\))?\\s*(?:skewX\\(${NUM}\\))?\\s*(?:scale\\(${NUM}(?: ${NUM})?\\))?$`,
  'i',
);

/**
 * Odczytuje transformację. Postać zapisaną przez Moniuszkę odtwarza dokładnie (z odbiciami
 * lustrzanymi włącznie); każdą inną listę funkcji SVG składa w macierz i rozkłada.
 */
export function parseTransform(value: string | null): Transform {
  if (!value || !value.trim()) return { ...IDENTITY };
  const v = value.trim();
  const m = CANONICAL.exec(v);
  if (m) {
    const n = (i: number, d: number) => (m[i] === undefined ? d : Number(m[i]));
    const scaleX = n(5, 1);
    return { x: n(1, 0), y: n(2, 0), rotation: n(3, 0), skewX: n(4, 0), scaleX, scaleY: n(6, scaleX) };
  }
  return fromMatrix(parseTransformList(v));
}

export function parseTransformList(value: string): Matrix {
  if (!/^\s*(\w+\s*\([^)]*\)\s*,?\s*)*$/.test(value)) {
    throw new CompositionParseError(`Niepoprawna transformacja: „${value}”`);
  }
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let m: Matrix = IDENTITY_MATRIX;
  for (const match of value.matchAll(re)) {
    const fn = match[1]!.toLowerCase();
    const args = match[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((a) => !Number.isFinite(a))) throw new CompositionParseError(`Niepoprawna transformacja: „${value}”`);
    const a = (i: number, d?: number) => {
      const v = args[i] ?? d;
      if (v === undefined) throw new CompositionParseError(`Za mało argumentów w ${fn}(): „${value}”`);
      return v;
    };
    switch (fn) {
      case 'translate':
        m = multiply(m, translateMatrix(a(0), a(1, 0)));
        break;
      case 'rotate': {
        const cx = a(1, 0);
        const cy = a(2, 0);
        m = multiply(m, translateMatrix(cx, cy));
        m = multiply(m, rotateMatrix(a(0)));
        m = multiply(m, translateMatrix(-cx, -cy));
        break;
      }
      case 'scale':
        m = multiply(m, scaleMatrix(a(0), a(1, a(0))));
        break;
      case 'skewx':
        m = multiply(m, skewXMatrix(a(0)));
        break;
      case 'skewy': {
        const t = Math.tan((a(0) * Math.PI) / 180);
        m = multiply(m, [1, t, 0, 1, 0, 0]);
        break;
      }
      case 'matrix':
        m = multiply(m, [a(0), a(1), a(2), a(3), a(4), a(5)]);
        break;
      default:
        throw new CompositionParseError(`Nieznana funkcja transformacji ${fn}() w „${value}”`);
    }
  }
  return m;
}

function required(el: Element, attr: string): string {
  const v = el.getAttribute(attr);
  if (v === null || v === '') throw new CompositionParseError(`Brak atrybutu ${attr} w ${describe(el)}`);
  return v;
}

function num(el: Element, attr: string): number {
  const v = Number(required(el, attr));
  if (!Number.isFinite(v)) throw new CompositionParseError(`Atrybut ${attr} nie jest liczbą w ${describe(el)}`);
  return v;
}

function describe(el: Element): string {
  const id = el.getAttribute('data-mz-node') ?? el.getAttribute('data-mz-layer') ?? el.getAttribute('id');
  return `<${localName(el)}${id ? ` id=${id}` : ''}>`;
}
