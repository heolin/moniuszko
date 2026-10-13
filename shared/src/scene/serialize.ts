import { escapeAttr, escapeText, fmt } from '../svg/xml.js';
import type { AssetNode, CompositionMeta, GroupNode, Layer, Scene, SceneNode, TextNode, Transform } from './types.js';

export const FORMAT_VERSION = 1;

/** Zapis transformacji w stałej kolejności; części tożsamościowe są pomijane. */
export function transformToString(t: Transform): string {
  const parts: string[] = [];
  if (t.x !== 0 || t.y !== 0) parts.push(`translate(${fmt(t.x)} ${fmt(t.y)})`);
  if (t.rotation !== 0) parts.push(`rotate(${fmt(t.rotation)})`);
  if (t.skewX !== 0) parts.push(`skewX(${fmt(t.skewX)})`);
  if (t.scaleX !== 1 || t.scaleY !== 1) {
    parts.push(t.scaleX === t.scaleY ? `scale(${fmt(t.scaleX)})` : `scale(${fmt(t.scaleX)} ${fmt(t.scaleY)})`);
  }
  return parts.join(' ');
}

/**
 * Plik roboczy kompozycji. Wynik zależy wyłącznie od modelu: ten sam model daje ten sam
 * tekst, więc zapis bez zmian nie zmienia pliku.
 */
export function serializeScene(scene: Scene, meta: CompositionMeta): string {
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
      ` width="${fmt(scene.width)}" height="${fmt(scene.height)}" viewBox="0 0 ${fmt(scene.width)} ${fmt(scene.height)}"` +
      ` data-mz-composition="${FORMAT_VERSION}" data-mz-author="${meta.author}" data-mz-status="${meta.status}">`,
  );
  out.push(`  <title>${escapeText(meta.name)}</title>`);
  if (scene.background !== null) {
    out.push(
      `  <rect data-mz-role="background" width="${fmt(scene.width)}" height="${fmt(scene.height)}" fill="${escapeAttr(scene.background)}"/>`,
    );
  }
  for (const layer of scene.layers) serializeLayer(layer, out);
  out.push('</svg>');
  return out.join('\n') + '\n';
}

function serializeLayer(layer: Layer, out: string[]): void {
  let attrs = `data-mz-layer="${escapeAttr(layer.id)}" data-mz-name="${escapeAttr(layer.name)}"`;
  if (layer.hidden) attrs += ' data-mz-hidden="1" display="none"';
  if (layer.locked) attrs += ' data-mz-locked="1"';
  if (layer.children.length === 0) {
    out.push(`  <g ${attrs}/>`);
    return;
  }
  out.push(`  <g ${attrs}>`);
  for (const node of layer.children) serializeNode(node, out, '    ');
  out.push('  </g>');
}

function commonAttrs(node: SceneNode): string {
  let attrs = `data-mz-node="${escapeAttr(node.id)}" data-mz-name="${escapeAttr(node.name)}"`;
  const t = transformToString(node.transform);
  if (t) attrs += ` transform="${t}"`;
  if (node.opacity !== 1) attrs += ` opacity="${fmt(node.opacity)}"`;
  if (node.hidden) attrs += ' data-mz-hidden="1" display="none"';
  if (node.locked) attrs += ' data-mz-locked="1"';
  return attrs;
}

function serializeNode(node: SceneNode, out: string[], indent: string): void {
  switch (node.type) {
    case 'asset':
      return serializeAsset(node, out, indent);
    case 'text':
      return serializeText(node, out, indent);
    case 'group':
      return serializeGroup(node, out, indent);
    default: {
      const never: never = node;
      throw new Error(`Nieznany typ węzła: ${JSON.stringify(never)}`);
    }
  }
}

function serializeAsset(node: AssetNode, out: string[], indent: string): void {
  out.push(
    `${indent}<g ${commonAttrs(node)} data-mz-asset="${escapeAttr(node.assetId)}" data-mz-asset-version="${node.assetVersion}">`,
  );
  out.push(`${indent}  ${node.svg}`);
  out.push(`${indent}</g>`);
}

/** Linie bazowe kolejnych wierszy tekstu, licząc od górnej krawędzi pierwszego wiersza. */
export function textLineBaselines(node: TextNode): number[] {
  return node.text.split('\n').map((_, i) => node.fontSize * (1 + i * node.lineHeight));
}

function serializeText(node: TextNode, out: string[], indent: string): void {
  let attrs = commonAttrs(node);
  attrs += ` font-family="${escapeAttr(node.fontFamily)}" font-size="${fmt(node.fontSize)}"`;
  if (node.fontWeight !== 400) attrs += ` font-weight="${node.fontWeight}"`;
  if (node.fontStyle !== 'normal') attrs += ` font-style="${node.fontStyle}"`;
  attrs += ` fill="${escapeAttr(node.fill)}"`;
  if (node.anchor !== 'start') attrs += ` text-anchor="${node.anchor}"`;
  attrs += ` data-mz-line-height="${fmt(node.lineHeight)}" xml:space="preserve"`;
  const baselines = textLineBaselines(node);
  const lines = node.text.split('\n');
  // Jeden wiersz bez odstępów między <tspan>: przy xml:space="preserve" wcięcia byłyby
  // renderowane jako spacje i przesuwałyby tekst wyśrodkowany.
  const spans = lines.map((line, i) => `<tspan x="0" y="${fmt(baselines[i]!)}">${escapeText(line)}</tspan>`);
  out.push(`${indent}<text ${attrs}>${spans.join('')}</text>`);
}

function serializeGroup(node: GroupNode, out: string[], indent: string): void {
  const attrs = `${commonAttrs(node)} data-mz-group="1"`;
  if (node.children.length === 0) {
    out.push(`${indent}<g ${attrs}/>`);
    return;
  }
  out.push(`${indent}<g ${attrs}>`);
  for (const child of node.children) serializeNode(child, out, indent + '  ');
  out.push(`${indent}</g>`);
}
