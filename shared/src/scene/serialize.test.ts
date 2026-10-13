import { describe, expect, it } from 'vitest';
import { prepareAssetSvg } from '../svg/assetSvg.js';
import { createTextNode } from './commands.js';
import { CompositionParseError, parseScene, parseTransform } from './parse.js';
import { serializeScene } from './serialize.js';
import type { AssetNode, Scene } from './types.js';

const TREE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#4f8a3c"/></linearGradient></defs>
  <style>#trunk { fill: url(#g); }</style>
  <rect id="trunk" x="44" y="60" width="12" height="30"/>
  <circle cx="50" cy="42" r="28" fill="url(#g)"/>
  <use href="#trunk" x="5"/>
</svg>`;

function asset(id: string, x = 0): AssetNode {
  const p = prepareAssetSvg(TREE, id);
  return {
    type: 'asset',
    id,
    name: 'Drzewo',
    assetId: 'tree1',
    assetVersion: 1,
    width: p.width,
    height: p.height,
    svg: p.svg,
    transform: { x, y: 10, rotation: 15, skewX: 0, scaleX: -1.5, scaleY: 1.5 },
    opacity: 0.8,
    hidden: false,
    locked: true,
  };
}

function sampleScene(): Scene {
  return {
    width: 1600,
    height: 900,
    background: '#ffffff',
    layers: [
      { id: 'l1', name: 'Tło', hidden: false, locked: true, children: [asset('n1')] },
      {
        id: 'l2',
        name: 'Obiekty & "rzeczy"',
        hidden: true,
        locked: false,
        children: [
          {
            type: 'group',
            id: 'n2',
            name: 'Zagroda',
            transform: { x: 100, y: 200, rotation: 0, skewX: 0, scaleX: 1, scaleY: 1 },
            opacity: 1,
            hidden: false,
            locked: false,
            children: [asset('n3', 50), createTextNode({ id: 'n4', text: 'Wieś <latem>\n\ndrugi & wiersz', anchor: 'middle' })],
          },
        ],
      },
      { id: 'l3', name: 'Puste', hidden: false, locked: false, children: [] },
    ],
  };
}

const META = { name: 'Wieś <latem> & "lato"', author: 'agent', status: 'draft' } as const;

describe('serializeScene / parseScene', () => {
  it('parse(serialize(scena)) daje tę samą scenę i te same dane kompozycji', () => {
    const scene = sampleScene();
    expect(parseScene(serializeScene(scene, META))).toEqual({ scene, meta: META });
  });

  it('serializacja jest stabilna po ponownym odczycie', () => {
    const svg = serializeScene(sampleScene(), META);
    const parsed = parseScene(svg);
    expect(serializeScene(parsed.scene, parsed.meta)).toBe(svg);
  });

  it('identyfikatory w treści instancji dostają prefiks węzła', () => {
    const svg = asset('n9').svg;
    expect(svg).toContain('id="n9-g"');
    expect(svg).toContain('url(#n9-g)');
    expect(svg).toContain('href="#n9-trunk"');
    expect(svg).toContain('#n9-trunk {');
    expect(svg).not.toMatch(/id="g"/);
  });

  it('odrzuca plik, który nie jest kompozycją', () => {
    expect(() => parseScene('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')).toThrow(CompositionParseError);
  });

  it('odrzuca nieznany element zamiast go pominąć', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-mz-composition="1" data-mz-author="human" data-mz-status="draft"><circle r="3"/></svg>';
    expect(() => parseScene(svg)).toThrow(/Nieoczekiwany element/);
  });
});

describe('parseTransform', () => {
  it('odczytuje postać kanoniczną dokładnie', () => {
    expect(parseTransform('translate(1 2) rotate(30) scale(-1 2)')).toEqual({
      x: 1,
      y: 2,
      rotation: 30,
      skewX: 0,
      scaleX: -1,
      scaleY: 2,
    });
  });

  it('składa dowolną listę funkcji', () => {
    const t = parseTransform('rotate(90, 10, 10)');
    expect(t.rotation).toBeCloseTo(90);
    expect(t.x).toBeCloseTo(20);
    expect(t.y).toBeCloseTo(0);
  });

  it('odrzuca nieznaną funkcję', () => {
    expect(() => parseTransform('perspective(3)')).toThrow(CompositionParseError);
  });
});
