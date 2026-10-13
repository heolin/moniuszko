// Zrzuty ekranów do dokumentacji: `npm run screenshots` zapisuje je w docs/images/.
// Dane: przykładowe grafiki i kompozycja z samples/ (loadSamples) oraz szkic agenta
// zbudowany operacjami MCP.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { applySceneOps, estimateTextMeasurer, type SceneOpInput } from '@moniuszko/shared';
import { connect, SAMPLES, type Harness } from './harness';

const OUT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'docs', 'images');

let h: Harness;

function gid(file: string): string {
  const id = h.samples?.graphics[file];
  if (!id) throw new Error(`Brak przykładowej grafiki ${file}`);
  return id;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300); // animacje Mantine (otwieranie okien, menu)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function ops(compositionId: string, list: SceneOpInput[]) {
  await h.ctx.compositions.update(
    compositionId,
    async (scene, meta) => {
      const r = await applySceneOps(scene, list, {
        measurer: estimateTextMeasurer,
        loadGraphic: async (id) => {
          const g = h.ctx.library.get(id);
          return { svg: h.ctx.library.readSvg(id), version: g.version, title: g.title };
        },
      });
      return { scene: r.scene, meta };
    },
    { source: 'agent' },
  );
}

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

test.beforeEach(async ({ page }) => {
  h = await connect(page, { samples: true });
});

test.afterEach(async () => {
  await h.close();
});

test('zrzuty ekranów do dokumentacji', async ({ page }) => {
  // ---- biblioteka
  await page.goto(`${h.origin}/library`);
  await page.locator('.mz-card', { hasText: 'Drzewo liściaste' }).click();
  await expect(page.getByLabel('Tytuł')).toHaveValue('Drzewo liściaste');
  await page.locator('.mz-content').evaluate((el) => el.scrollTo(0, 0));
  await shot(page, 'library');

  await page.locator('.mz-filter-row', { hasText: 'Bez metadanych' }).click();
  await expect(page.locator('.mz-card')).toHaveCount(2);
  await shot(page, 'library-untagged');
  await page.locator('.mz-filter-row', { hasText: 'Wszystkie' }).first().click();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dodaj pliki…' }).click();
  await (await chooser).setFiles([
    { name: 'drzewo-kopia.svg', mimeType: 'image/svg+xml', buffer: fs.readFileSync(path.join(SAMPLES, 'drzewo.svg')) },
    {
      name: 'ze-skryptem.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" fill="#5b4bb5" onclick="x()"/></svg>',
      ),
    },
    { name: 'zdjecie.png', mimeType: 'image/png', buffer: Buffer.from('PNG') },
    {
      name: 'kwadrat.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#2f7a4b"/></svg>'),
    },
  ]);
  await expect(page.getByText('Przetworzono 4 z 4')).toBeVisible();
  await shot(page, 'library-import');
  await page.getByRole('button', { name: 'Ukryj' }).click();

  // ---- kompozycje: przykładowa z samples/ i szkic agenta
  const village = h.samples!.compositionId;
  const draft = h.ctx.compositions.create({ name: 'Żaglówka o zachodzie', width: 1600, height: 900, author: 'agent' });
  await ops(draft.id, [
    { op: 'set_canvas', background: '#f3e6cf' },
    { op: 'add_shape', shape: 'rect', layer: 'Tło', x: 0, y: 520, width: 1600, height: 380, fill: '#3c6e8f', name: 'Morze' },
    { op: 'add_shape', shape: 'ellipse', layer: 'Tło', x: 1150, y: 120, width: 220, height: 220, fill: '#e9a72b', name: 'Słońce' },
    { op: 'insert_graphic', graphicId: gid('zaglowka.svg'), layer: 'Obiekty', x: 520, y: 220, width: 420 },
    { op: 'insert_graphic', graphicId: gid('ptak.svg'), layer: 'Obiekty', x: 200, y: 140, width: 120 },
  ]);
  await page.goto(`${h.origin}/compositions`);
  await expect(page.locator('.mz-card')).toHaveCount(2);
  await page.waitForTimeout(500); // miniatury
  await shot(page, 'compositions');

  await page.getByRole('button', { name: 'Nowa kompozycja' }).click();
  await shot(page, 'compositions-new');
  await page.keyboard.press('Escape');

  // ---- edytor
  await page.goto(`${h.origin}/compositions/${village}`);
  await expect(page.locator('.mz-layer-row.layer')).toHaveCount(3);
  const scene = h.ctx.compositions.load(village).scene;
  const zagroda = scene.layers.find((l) => l.name === 'Obiekty')!.children.find((n) => n.name === 'Zagroda')!;
  const tree = zagroda.type === 'group' ? zagroda.children.find((n) => n.name === 'Drzewo liściaste')! : zagroda;
  await page.locator('.mz-layer-row', { hasText: 'Zagroda' }).click();
  await shot(page, 'editor');

  // Wnętrze grupy: dwuklik na drzewie.
  const tb = (await page.locator(`[data-node-id="${tree.id}"]`).boundingBox())!;
  await page.mouse.dblclick(tb.x + tb.width / 2, tb.y + tb.height / 3);
  await expect(page.locator('.mz-layer-row.selected')).toContainText('Drzewo');
  await shot(page, 'editor-group');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Biblioteka' }).click();
  await shot(page, 'editor-library');
  await page.getByRole('tab', { name: 'Warstwy' }).click();

  await page.getByRole('button', { name: 'Kształty' }).click();
  await shot(page, 'editor-shapes');
  await page.getByRole('menuitem', { name: 'Gwiazda' }).click();
  await expect(page.getByText('Kształt', { exact: true })).toBeVisible();
  await shot(page, 'editor-shape-inspector');
  await page.keyboard.press('Delete');

  // Edycja tekstu w miejscu.
  const textNode = scene.layers.find((l) => l.name === 'Teksty')!.children[0]!;
  const xb = (await page.locator(`[data-node-id="${textNode.id}"]`).boundingBox())!;
  await page.mouse.dblclick(xb.x + xb.width / 2, xb.y + xb.height / 2);
  await expect(page.locator('textarea.mz-text-editor')).toBeFocused();
  await shot(page, 'editor-text');
  await page.keyboard.press('Escape');
  await expect(page.locator('textarea.mz-text-editor')).toHaveCount(0);

  // Zmiana od agenta przy otwartym edytorze.
  await expect(page.locator('.mz-ed-toolbar')).toContainText('zapisano', { timeout: 15_000 });
  await ops(village, [
    { op: 'insert_graphic', graphicId: gid('postac.svg'), layer: 'Obiekty', x: 560, y: 600, width: 130 },
    { op: 'insert_graphic', graphicId: gid('ptak.svg'), layer: 'Tło', x: 760, y: 90, width: 90 },
  ]);
  await expect(page.locator('.mz-notice')).toContainText('Agent zmienił');
  await page.getByRole('button', { name: 'Pokaż zmiany' }).click();
  await shot(page, 'editor-agent-change');
  await page.locator('.mz-notice button[aria-label="Zamknij"]').click();

  await page.getByRole('button', { name: 'Eksportuj…' }).click();
  await expect(page.getByText('Eksport kompozycji')).toBeVisible();
  await shot(page, 'export');
  await page.keyboard.press('Escape');

  // ---- ustawienia
  await page.goto(`${h.origin}/settings`);
  await expect(page.getByText('Narzędzia udostępniane agentowi')).toBeVisible();
  await shot(page, 'settings');

  // ---- podgląd, który agent dostaje z get_composition / apply_scene_ops
  fs.writeFileSync(path.join(OUT, 'mcp-preview.png'), h.ctx.compositions.renderPng(village, 1024));
});
