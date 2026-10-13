import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usedAssetIds } from '@moniuszko/shared';
import { loadSamples } from './samples.js';
import { makeCtx, SAMPLES, type TestCtx } from './test/helpers.js';

let t: TestCtx;
beforeEach(() => {
  t = makeCtx({ normalizeSvg: false });
});
afterEach(() => t.cleanup());

describe('przykładowe dane', () => {
  it('wczytują wszystkie grafiki z metadanymi i kompozycję', async () => {
    const r = await loadSamples(t.ctx, SAMPLES);
    const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.svg'));
    expect(Object.keys(r.graphics).sort()).toEqual(files.sort());
    const facets = t.ctx.library.repo.facets();
    expect(facets.total).toBe(files.length);
    expect(facets.tagStatus.untagged).toBe(2);
    const { scene, meta } = t.ctx.compositions.load(r.compositionId);
    expect(meta.name).toBe('Wieś latem');
    expect(usedAssetIds(scene).length).toBeGreaterThan(5);
  });

  it('zgłaszają plik bez opisu w library.json', async () => {
    const dir = path.join(t.dir, 'samples');
    fs.cpSync(SAMPLES, dir, { recursive: true });
    fs.copyFileSync(path.join(dir, 'kot.svg'), path.join(dir, 'nowy.svg'));
    await expect(loadSamples(t.ctx, dir)).rejects.toThrow(/nowy\.svg/);
  });
});
