import { toMatrix, transformRect, unionRects } from './matrix.js';
import type { Rect, SceneNode, TextNode } from './types.js';

/**
 * Źródło wymiarów tekstu. Serwer (MCP) nie ma silnika renderującego tekst, więc używa
 * oszacowania; klient podaje wymiary zmierzone w przeglądarce.
 */
export interface TextMeasurer {
  /** Prostokąt tekstu w jego lokalnym układzie (przed transformacją węzła). */
  measure(node: TextNode): Rect;
}

/** Średnia szerokość znaku jako ułamek rozmiaru fontu, dla typowych krojów proporcjonalnych. */
const AVG_CHAR_WIDTH = 0.55;
/** Część fontu poniżej linii bazowej. */
const DESCENT = 0.25;

/**
 * Oszacowanie wymiarów tekstu na podstawie liczby znaków. Służy serwerowi do obrotu wokół
 * środka i do wyrównywania; edytor zastępuje je pomiarem z przeglądarki.
 */
export const estimateTextMeasurer: TextMeasurer = {
  measure(node) {
    const lines = node.text.split('\n');
    const longest = Math.max(...lines.map((l) => l.length), 1);
    const width = longest * node.fontSize * AVG_CHAR_WIDTH;
    const height = node.fontSize * (1 + DESCENT + (lines.length - 1) * node.lineHeight);
    const x = node.anchor === 'start' ? 0 : node.anchor === 'middle' ? -width / 2 : -width;
    return { x, y: 0, width, height };
  },
};

/** Prostokąt węzła w jego własnym układzie. Pusta grupa nie ma granic. */
export function localBounds(node: SceneNode, measurer: TextMeasurer): Rect | null {
  switch (node.type) {
    case 'asset':
    case 'shape':
      return { x: 0, y: 0, width: node.width, height: node.height };
    case 'text':
      return measurer.measure(node);
    case 'group':
      return unionRects(
        node.children.map((c) => nodeBounds(c, measurer)).filter((r): r is Rect => r !== null),
      );
    default: {
      const never: never = node;
      throw new Error(`Nieznany typ węzła: ${JSON.stringify(never)}`);
    }
  }
}

/** Prostokąt otaczający węzeł w układzie rodzica. */
export function nodeBounds(node: SceneNode, measurer: TextMeasurer): Rect | null {
  const local = localBounds(node, measurer);
  if (!local) return null;
  return transformRect(toMatrix(node.transform), local);
}
