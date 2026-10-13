// Dominujące kolory grafiki, liczone z atrybutów i stylów (fill, stroke, stop-color).
// To przybliżenie: liczy wystąpienia koloru, a nie powierzchnię, którą zajmuje.

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  brown: '#a52a2a',
  pink: '#ffc0cb',
  navy: '#000080',
  teal: '#008080',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  silver: '#c0c0c0',
  gold: '#ffd700',
};

const COLOR_PROP = /(?:^|[\s;{"'])(fill|stroke|stop-color)\s*[:=]\s*["']?\s*([^;"'}\s)]+\)?)/gi;

export function normalizeColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((c) => Math.min(255, Number(c)).toString(16).padStart(2, '0')).join('')}`;
  }
  return NAMED[v] ?? null;
}

export function dominantColors(svg: string, limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const m of svg.matchAll(COLOR_PROP)) {
    const c = normalizeColor(m[2]!);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([c]) => c);
}
