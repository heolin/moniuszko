import { Resvg } from '@resvg/resvg-js';

/**
 * Rasteryzuje SVG do PNG. Dłuższy bok ma `size` pikseli. Fonty pochodzą z systemu, więc
 * tekst w podglądzie zależy od fontów zainstalowanych na maszynie serwera.
 */
export function renderPng(svg: string, size: number, background?: string): Buffer {
  const probe = new Resvg(svg, { font: { loadSystemFonts: false } });
  const fitTo =
    probe.width >= probe.height ? ({ mode: 'width', value: size } as const) : ({ mode: 'height', value: size } as const);
  const resvg = new Resvg(svg, {
    fitTo,
    background,
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  });
  return resvg.render().asPng();
}
