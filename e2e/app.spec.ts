import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getNode, parseScene, type Scene } from '@moniuszko/shared';
import { connect, SAMPLES, type Harness } from './harness';

let h: Harness;

test.beforeEach(async ({ page }) => {
  h = await connect(page);
});
test.afterEach(async () => {
  await h.close();
});

/** Zrzut ekranu do folderu z SHOTS_DIR (gdy ustawiony); służy do ręcznego obejrzenia ekranów. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

function importSamples(names: string[]): string[] {
  return names.map((n) => {
    const r = h.ctx.library.importFile(n, fs.readFileSync(path.join(SAMPLES, n)));
    if (r.status !== 'added') throw new Error(`import ${n}: ${r.status}`);
    return r.graphic.id;
  });
}

function sceneOnDisk(id: string): Scene {
  return parseScene(fs.readFileSync(h.ctx.workspace.compositionPath(id), 'utf8')).scene;
}

async function waitSaved(page: Page) {
  await expect(page.locator('.mz-ed-toolbar')).toContainText('zapisano', { timeout: 10_000 });
}

test('biblioteka: import przez wybór plików i edycja metadanych', async ({ page }) => {
  await page.goto(`${h.origin}/library`);
  await expect(page.getByText('Biblioteka jest pusta.')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dodaj pliki…' }).click();
  await (await chooser).setFiles(['drzewo.svg', 'dom.svg', 'kwiat.svg', 'chmura.svg'].map((f) => path.join(SAMPLES, f)));
  await expect(page.getByText('Przetworzono 4 z 4')).toBeVisible();
  await shot(page, '01-import');
  await page.getByRole('button', { name: 'Ukryj' }).click();

  await expect(page.locator('.mz-card')).toHaveCount(4);
  await page.locator('.mz-card', { hasText: 'drzewo' }).click();
  await page.getByLabel('Tytuł').fill('Drzewo liściaste');
  await page.getByLabel('Opis').fill('Drzewo z okrągłą koroną');
  await page.getByRole('combobox', { name: 'Kategoria' }).fill('Rośliny');
  const tags = page.getByPlaceholder('Dodaj tag…');
  await tags.fill('drzewo');
  await tags.press('Enter');
  await tags.fill('lato');
  await tags.press('Enter');
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(page.locator('.mz-card', { hasText: 'Drzewo liściaste' })).toBeVisible();

  const g = h.ctx.library.repo.list({ q: 'liściaste' }).items[0]!;
  expect(g).toMatchObject({ title: 'Drzewo liściaste', category: 'Rośliny', tags: ['drzewo', 'lato'] });

  await page.getByPlaceholder('Szukaj w tytułach, opisach i tagach…').fill('koron');
  await expect(page.locator('.mz-card')).toHaveCount(1);
  await page.getByPlaceholder('Szukaj w tytułach, opisach i tagach…').fill('');
  await page.locator('.mz-card', { hasText: 'Drzewo liściaste' }).click();
  await shot(page, '02-library');
});

test('kompozycje: nowa kompozycja otwiera edytor', async ({ page }) => {
  await page.goto(`${h.origin}/compositions`);
  await page.getByRole('button', { name: 'Nowa kompozycja' }).click();
  await page.getByLabel('Nazwa').fill('Wieś latem');
  await page.getByRole('button', { name: 'Utwórz' }).click();
  await expect(page).toHaveURL(`${h.origin}/compositions/wies-latem`);
  await expect(page.locator('.mz-ed-toolbar')).toContainText('Wieś latem');
  await expect(page.locator('.mz-layer-row.layer')).toHaveText(['Teksty', 'Obiekty', 'Tło']);
});

test('edytor: wstawianie, przesuwanie, obrót, skalowanie, grupowanie, tekst, cofanie', async ({ page }) => {
  const [tree, house] = importSamples(['drzewo.svg', 'dom.svg']);
  const c = h.ctx.compositions.create({ name: 'Test', width: 1600, height: 900, author: 'human' });
  await page.goto(`${h.origin}/compositions/${c.id}`);
  await expect(page.locator('.mz-layer-row.layer')).toHaveCount(3);

  // Wstawienie dwóch grafik dwuklikiem w panelu biblioteki (do aktywnej warstwy).
  await page.getByRole('tab', { name: 'Biblioteka' }).click();
  await page.locator(`.mz-mini-grid > div[title="drzewo"]`).dblclick();
  await expect(page.locator('[data-node-id]')).toHaveCount(1);
  await page.locator(`.mz-mini-grid > div[title="dom"]`).dblclick();
  await expect(page.locator('[data-node-id]')).toHaveCount(2);
  await waitSaved(page);
  let scene = sceneOnDisk(c.id);
  const layer = scene.layers.at(-1)!;
  expect(layer.children.map((n) => n.type === 'asset' && n.assetId)).toEqual([tree, house]);
  const houseId = layer.children[1]!.id;
  const treeId = layer.children[0]!.id;
  const before = getNode(scene, houseId).node.transform;
  expect(before.scaleX).toBeCloseTo(2.7); // 30% z 900 / 100

  // Przesunięcie domu myszą o 100 px ekranu.
  const house$ = page.locator(`[data-node-id="${houseId}"]`);
  const box = (await house$.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await waitSaved(page);
  await shot(page, '03-editor-moved');
  scene = sceneOnDisk(c.id);
  const zoomText = (await page.locator('.mz-zoom').textContent())!;
  const zoom = Number(/(\d+)%/.exec(zoomText)![1]) / 100;
  const moved = getNode(scene, houseId).node.transform;
  expect(moved.x - before.x).toBeCloseTo(100 / zoom, -0.5);
  expect(moved.y - before.y).toBeCloseTo(40 / zoom, -0.5);

  // Obrót uchwytem Moveable.
  const rot = page.locator('.moveable-rotation-control').first();
  await expect(rot).toBeVisible();
  const rb = (await rot.boundingBox())!;
  const hb = (await house$.boundingBox())!;
  const cx = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  // obrót o 90° zgodnie z ruchem wskazówek: z góry środka na prawo od środka
  const r = cy - (rb.y + rb.height / 2);
  await page.mouse.move(cx + r * Math.sin(Math.PI / 8), cy - r * Math.cos(Math.PI / 8), { steps: 4 });
  await page.mouse.move(cx + r * Math.sin(Math.PI / 4), cy - r * Math.cos(Math.PI / 4), { steps: 4 });
  await page.mouse.move(cx + r, cy, { steps: 6 });
  await page.mouse.up();
  await waitSaved(page);
  await shot(page, '04-editor-rotated');
  scene = sceneOnDisk(c.id);
  const rotated = getNode(scene, houseId).node.transform;
  expect(rotated.rotation).toBeGreaterThan(80);
  expect(rotated.rotation).toBeLessThan(100);

  // Inspektor: obrót wpisany ręcznie.
  await page.getByLabel('Obrót').fill('0');
  await page.getByLabel('Obrót').press('Enter');
  await waitSaved(page);
  expect(getNode(sceneOnDisk(c.id), houseId).node.transform.rotation).toBeCloseTo(0);

  // Skalowanie narożnym uchwytem (proporcjonalnie).
  const se = page.locator('.moveable-control.moveable-se').first();
  const sb = (await se.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 30, sb.y + 30, { steps: 5 });
  await page.mouse.move(sb.x + 60, sb.y + 60, { steps: 5 });
  await page.mouse.up();
  await waitSaved(page);
  const scaled = getNode(sceneOnDisk(c.id), houseId).node.transform;
  expect(scaled.scaleX).toBeGreaterThan(before.scaleX);
  expect(scaled.scaleX).toBeCloseTo(scaled.scaleY, 3);

  // Zaznaczenie obu (Ctrl+A) i grupowanie (Ctrl+G).
  await page.locator('.mz-canvas-scroll').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await waitSaved(page);
  scene = sceneOnDisk(c.id);
  expect(scene.layers.at(-1)!.children).toHaveLength(1);
  expect(scene.layers.at(-1)!.children[0]!.type).toBe('group');
  await page.getByRole('tab', { name: 'Warstwy' }).click();
  await expect(page.locator('.mz-layer-row', { hasText: 'Grupa' })).toBeVisible();
  await shot(page, '04b-editor-grouped');

  // Cofnięcie grupowania.
  await page.keyboard.press('Control+z');
  await waitSaved(page);
  expect(sceneOnDisk(c.id).layers.at(-1)!.children.map((n) => n.id)).toEqual([treeId, houseId]);

  // Tekst: narzędzie T, klik na płótnie, wpisanie treści.
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  const art = (await page.locator('.mz-artboard').boundingBox())!;
  await page.mouse.click(art.x + art.width / 2, art.y + 60);
  const editor = page.locator('textarea.mz-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Wieś latem');
  await editor.press('Control+Enter');
  await waitSaved(page);
  scene = sceneOnDisk(c.id);
  const texts = scene.layers.flatMap((l) => l.children).filter((n) => n.type === 'text');
  expect(texts.map((t) => t.type === 'text' && t.text)).toEqual(['Wieś latem']);
  await shot(page, '05-editor-text');
});

test('edytor: kształty z menu i ich parametry', async ({ page }) => {
  const c = h.ctx.compositions.create({ name: 'Kształty', width: 1000, height: 600, author: 'human' });
  await page.goto(`${h.origin}/compositions/${c.id}`);
  for (const label of ['Koło', 'Gwiazda', 'Prostokąt']) {
    await page.getByRole('button', { name: 'Kształty' }).click();
    await page.getByRole('menuitem', { name: label }).click();
  }
  await expect(page.locator('[data-node-id]')).toHaveCount(3);
  // Zaznaczony jest ostatni wstawiony (prostokąt): wyłączenie wypełnienia, zaokrąglenie.
  await page.getByLabel('Wypełnienie').uncheck();
  await page.getByLabel('Obrys').check();
  await page.getByLabel('Zaokrąglenie narożników').fill('12');
  await page.getByLabel('Zaokrąglenie narożników').press('Enter');
  await waitSaved(page);
  await shot(page, '08-editor-shapes');
  const nodes = sceneOnDisk(c.id).layers.flatMap((l) => l.children);
  expect(nodes.map((n) => n.type === 'shape' && n.shape)).toEqual(['ellipse', 'star', 'rect']);
  expect(nodes[2]).toMatchObject({ fill: null, stroke: '#1f1e1b', cornerRadius: 12 });
  expect(nodes[0]).toMatchObject({ width: 120, height: 120 });
});

test('edytor: wejście do grupy dwuklikiem i zmiana z zewnątrz (agent)', async ({ page }) => {
  const [tree] = importSamples(['drzewo.svg']);
  const c = h.ctx.compositions.create({ name: 'Agent', width: 1200, height: 800, author: 'agent' });
  const { applySceneOps, estimateTextMeasurer } = await import('@moniuszko/shared');
  await h.ctx.compositions.update(
    c.id,
    async (scene, meta) => {
      const r = await applySceneOps(
        scene,
        [
          { op: 'insert_graphic', graphicId: tree!, layer: 'Obiekty', x: 100, y: 100, width: 300, as: 'a' },
          { op: 'insert_graphic', graphicId: tree!, layer: 'Obiekty', x: 600, y: 100, width: 300, as: 'b' },
          { op: 'group', nodes: ['$a', '$b'], name: 'Drzewa' },
        ],
        { measurer: estimateTextMeasurer, loadGraphic: async (id) => ({ svg: h.ctx.library.readSvg(id), version: 1, title: 'drzewo' }) },
      );
      return { scene: r.scene, meta };
    },
    { source: 'agent' },
  );
  await page.goto(`${h.origin}/compositions/${c.id}`);
  await expect(page.locator('.mz-ed-toolbar')).toContainText('Agent');
  await expect(page.getByText('agent · szkic')).toBeVisible();

  const groupEl = page.locator('[data-mz-group], [data-node-id]').first();
  await expect(groupEl).toBeVisible();
  const scene = sceneOnDisk(c.id);
  const group = scene.layers.find((l) => l.name === 'Obiekty')!.children[0]!;
  const firstChild = group.type === 'group' ? group.children[0]! : null;
  const child$ = page.locator(`[data-node-id="${firstChild!.id}"]`);
  const cb = (await child$.boundingBox())!;
  await page.mouse.dblclick(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await expect(page.locator('.mz-layer-row.selected')).toHaveCount(1);
  await expect(page.locator('.mz-layer-row.selected')).toContainText('drzewo');

  await shot(page, '06-editor-group');

  // Agent dodaje tekst, gdy kompozycja jest otwarta: edytor wczytuje zmianę i pokazuje komunikat.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await h.ctx.compositions.update(
    c.id,
    async (sc, meta) => {
      const r = await applySceneOps(sc, [{ op: 'add_text', text: 'Od agenta', layer: 'Teksty', x: 100, y: 500 }], {
        measurer: estimateTextMeasurer,
        loadGraphic: async () => {
          throw new Error('niepotrzebne');
        },
      });
      return { scene: r.scene, meta };
    },
    { source: 'agent' },
  );
  await expect(page.locator('.mz-notice')).toContainText('Agent zmienił');
  await expect(page.locator('svg text', { hasText: 'Od agenta' })).toBeVisible();
  await shot(page, '07-editor-agent-change');

  await page.getByRole('button', { name: 'Cofnij te zmiany' }).click();
  await expect(page.locator('svg text', { hasText: 'Od agenta' })).toHaveCount(0);
  await waitSaved(page);
  const after = sceneOnDisk(c.id);
  expect(after.layers.find((l) => l.name === 'Teksty')!.children).toHaveLength(0);
});
