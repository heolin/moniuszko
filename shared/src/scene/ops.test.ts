import { describe, expect, it } from 'vitest';
import { estimateTextMeasurer } from './bounds.js';
import { createScene, sceneBounds } from './commands.js';
import { applySceneOps, SceneOpError } from './ops.js';
import { getNode } from './tree.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect id="r" width="100" height="50"/></svg>';
const deps = {
  measurer: estimateTextMeasurer,
  async loadGraphic(id: string) {
    if (id !== 'g1') throw new Error(`Nie ma grafiki ${id}`);
    return { svg: SVG, version: 3, title: 'Prostokąt' };
  },
};

describe('applySceneOps', () => {
  it('wstawia, grupuje i odwołuje się do aliasów', async () => {
    const scene = createScene(800, 600, ['Tło', 'Obiekty']);
    const r = await applySceneOps(
      scene,
      [
        { op: 'insert_graphic', graphicId: 'g1', layer: 'Obiekty', x: 10, y: 20, width: 200, as: 'big' },
        { op: 'insert_graphic', graphicId: 'g1', layer: 'Obiekty', x: 300, y: 20, as: 'small' },
        { op: 'add_text', text: 'Tytuł', layer: 'Obiekty', x: 10, y: 300, fontSize: 64, as: 'title' },
        { op: 'group', nodes: ['$big', '$small'], name: 'Para', as: 'pair' },
        { op: 'update', node: '$title', fill: '#ff0000' },
      ],
      deps,
    );
    const big = r.created.big!;
    expect(sceneBounds(r.scene, big, deps)).toMatchObject({ x: 10, y: 20, width: 200, height: 100 });
    expect(getNode(r.scene, big).parent.id).toBe(r.created.pair);
    const title = getNode(r.scene, r.created.title!).node;
    expect(title.type === 'text' && title.fill).toBe('#ff0000');
    const asset = getNode(r.scene, big).node;
    expect(asset.type === 'asset' && asset.assetVersion).toBe(3);
  });

  it('błąd w środku listy nie zmienia sceny i wskazuje numer operacji', async () => {
    const scene = createScene(800, 600, ['Obiekty']);
    const err = await applySceneOps(
      scene,
      [
        { op: 'insert_graphic', graphicId: 'g1', layer: 'Obiekty', x: 0, y: 0 },
        { op: 'delete', nodes: ['$nieznany'] },
      ],
      deps,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SceneOpError);
    expect((err as SceneOpError).index).toBe(1);
    expect(scene.layers[0]!.children).toHaveLength(0);
  });

  it('odrzuca niepoprawne dane operacji', async () => {
    const scene = createScene(800, 600, ['Obiekty']);
    await expect(applySceneOps(scene, [{ op: 'insert_graphic', graphicId: 'g1' } as never], deps)).rejects.toThrow(
      /Operacja #0 \(insert_graphic\)/,
    );
  });
});
