import { describe, expect, it } from 'vitest';
import { createScene, createTextNode, insertNode, updateText } from '@moniuszko/shared';
import { changedNodeIds, useEditor } from './store';
import { serializeScene } from '@moniuszko/shared';

describe('changedNodeIds', () => {
  it('zwraca nowe i zmienione węzły', () => {
    let a = createScene(100, 100, ['A']);
    const layer = a.layers[0]!.id;
    a = insertNode(a, createTextNode({ id: 't1', text: 'jeden' }), { containerId: layer });
    a = insertNode(a, createTextNode({ id: 't2', text: 'dwa' }), { containerId: layer });
    let b = updateText(a, 't2', { text: 'zmieniony' });
    b = insertNode(b, createTextNode({ id: 't3', text: 'nowy' }), { containerId: layer });
    expect(changedNodeIds(a, b)).toEqual(['t2', 't3']);
  });
});

describe('historia gestu', () => {
  it('cały gest to jeden wpis w historii', () => {
    let scene = createScene(100, 100, ['A']);
    scene = insertNode(scene, createTextNode({ id: 't1', text: 'x' }), { containerId: scene.layers[0]!.id });
    const svg = serializeScene(scene, { name: 'T', author: 'human', status: 'reviewed' });
    const s = useEditor.getState();
    s.load('t', svg, 1);
    s.beginGesture();
    for (let i = 1; i <= 5; i++) {
      useEditor.getState().updateGesture((sc) => ({ ...sc, width: 100 + i }));
    }
    useEditor.getState().endGesture();
    expect(useEditor.getState().scene!.width).toBe(105);
    expect(useEditor.temporal.getState().pastStates).toHaveLength(1);
    useEditor.temporal.getState().undo();
    expect(useEditor.getState().scene!.width).toBe(100);
  });
});
