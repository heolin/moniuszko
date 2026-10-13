import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconMinus, IconPlus, IconMaximize } from '@tabler/icons-react';
import {
  findNode,
  getNode,
  localBounds,
  moveBy,
  rotateBy,
  scaleBy,
  scaleNode,
  sceneBounds,
  selectionBounds,
  type Point,
} from '@moniuszko/shared';
import { notifyError } from '../notify';
import { insertGraphic, insertText } from './insert';
import { ctx, selectableNodes, useEditor } from './store';
import { SceneView } from './SceneView';
import { TextEditor } from './TextEditor';

/** Margines wokół płótna w pikselach ekranu, żeby dało się przewinąć obiekty wystające poza płótno. */
const MARGIN = 400;

export const GRAPHIC_MIME = 'application/x-moniuszko-graphic';

export function Canvas() {
  const scene = useEditor((s) => s.scene)!;
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const enteredGroup = useEditor((s) => s.enteredGroup);
  const tool = useEditor((s) => s.tool);
  const keepAspect = useEditor((s) => s.keepAspect);
  const editingTextId = useEditor((s) => s.editingTextId);
  const highlight = useEditor((s) => s.highlight);
  const inGesture = useEditor((s) => s.gesture !== null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Selecto potrzebuje elementu kontenera w propsach, więc trzymamy go też w stanie.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const [targets, setTargets] = useState<SVGElement[]>([]);
  const [spaceDown, setSpaceDown] = useState(false);
  const fitted = useRef<string | null>(null);

  const selectable = useMemo(
    () => new Set(selectableNodes(useEditor.getState()).map((n) => n.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, enteredGroup],
  );

  const W = scene.width * zoom;
  const H = scene.height * zoom;

  // ------------------------------------------------------------ współrzędne

  const scenePoint = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) throw new Error('Płótno nie jest wyrenderowane');
    const m = svg.getScreenCTM();
    if (!m) throw new Error('Brak macierzy ekranu płótna');
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const elementFor = useCallback((id: string) => {
    return svgRef.current?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(id)}"]`) ?? null;
  }, []);

  // ------------------------------------------------------------ dopasowanie widoku

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const s = useEditor.getState().scene;
    if (!s) return;
    const z = Math.min((el.clientWidth - 80) / s.width, (el.clientHeight - 80) / s.height);
    useEditor.getState().setZoom(z > 0 ? z : 1);
    requestAnimationFrame(() => {
      const e = scrollRef.current;
      if (!e) return;
      e.scrollLeft = (e.scrollWidth - e.clientWidth) / 2;
      e.scrollTop = (e.scrollHeight - e.clientHeight) / 2;
    });
  }, []);

  useLayoutEffect(() => {
    const key = `${useEditor.getState().id}:${scene.width}x${scene.height}`;
    if (fitted.current !== key) {
      fitted.current = key;
      fit();
    }
  }, [scene.width, scene.height, fit]);

  /** Zoom z zachowaniem punktu pod kursorem. */
  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const el = scrollRef.current;
      const svg = svgRef.current;
      if (!el || !svg) return;
      const rect = el.getBoundingClientRect();
      const cx = clientX ?? rect.left + rect.width / 2;
      const cy = clientY ?? rect.top + rect.height / 2;
      const pt = scenePoint(cx, cy);
      const before = useEditor.getState().zoom;
      useEditor.getState().setZoom(before * factor);
      const z = useEditor.getState().zoom;
      requestAnimationFrame(() => {
        el.scrollLeft = MARGIN + pt.x * z - (cx - rect.left);
        el.scrollTop = MARGIN + pt.y * z - (cy - rect.top);
      });
    },
    [scenePoint],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Spacja trzymana = przesuwanie widoku.
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const panning = tool === 'pan' || spaceDown;

  const onPanPointerDown = (e: React.PointerEvent) => {
    if (!(panning || e.button === 1)) return;
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    const move = (ev: PointerEvent) => {
      el.scrollLeft = start.l - (ev.clientX - start.x);
      el.scrollTop = start.t - (ev.clientY - start.y);
    };
    const upFn = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', upFn);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', upFn);
  };

  // ------------------------------------------------------------ cele Moveable

  useLayoutEffect(() => {
    const els = selection.map(elementFor).filter((e): e is SVGGElement => e !== null);
    setTargets((prev) => (prev.length === els.length && prev.every((p, i) => p === els[i]) ? prev : els));
  }, [selection, scene, elementFor]);

  useLayoutEffect(() => {
    // Po grupowaniu lub usunięciu stan `targets` przez jeden render wskazuje elementy już
    // odłączone od dokumentu; Moveable nie umie zmierzyć takich elementów.
    if (inGesture || !targets.every((t) => t.isConnected)) return;
    moveableRef.current?.updateRect();
  }, [scene, zoom, targets, inGesture]);

  // ------------------------------------------------------------ gesty

  const ids = () => useEditor.getState().selection;

  // Moveable zgłasza początek przeciągania już przy wciśnięciu przycisku, także przy zwykłym
  // kliknięciu i dwukliku. Gest (wstrzymanie historii) zaczyna się dopiero przy pierwszym ruchu.
  const dragStart = (e: { clientX: number; clientY: number; datas: Record<string, unknown> }) => {
    e.datas.start = { x: e.clientX, y: e.clientY };
  };
  const drag = (e: { clientX: number; clientY: number; datas: Record<string, unknown>; inputEvent: { shiftKey?: boolean } | null }) => {
    const start = e.datas.start as { x: number; y: number } | undefined;
    if (!start) return;
    if (!useEditor.getState().gesture) useEditor.getState().beginGesture();
    const z = useEditor.getState().zoom;
    let dx = (e.clientX - start.x) / z;
    let dy = (e.clientY - start.y) / z;
    if (e.inputEvent?.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const sel = ids();
    useEditor.getState().updateGesture((sc) => moveBy(sc, sel, dx, dy));
  };
  const gestureEnd = () => useEditor.getState().endGesture();

  const rotateStart = (e: { datas: Record<string, unknown>; setFixedDirection: (d: number[]) => void }) => {
    e.setFixedDirection([0, 0]);
    const s = useEditor.getState();
    // Środek prostokąta otaczającego jest obrazem środka węzła (przekształcenie afiniczne
    // zachowuje symetrię środkową), więc dla jednego i wielu węzłów liczymy go tak samo.
    const b = selectionBounds(s.scene!, s.selection, ctx);
    e.datas.pivot = b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    s.beginGesture();
  };
  const rotate = (e: { absoluteDist: number; datas: Record<string, unknown>; inputEvent: { shiftKey?: boolean } | null }) => {
    const pivot = e.datas.pivot as Point | null;
    if (!pivot) return;
    let d = e.absoluteDist;
    if (e.inputEvent?.shiftKey) d = Math.round(d / 15) * 15;
    const sel = ids();
    useEditor.getState().updateGesture((sc) => rotateBy(sc, sel, d, ctx, pivot));
  };

  const scaleStart = (e: { direction: number[]; datas: Record<string, unknown> }) => {
    const s = useEditor.getState();
    const sel = s.selection;
    const [dx = 0, dy = 0] = e.direction;
    if (sel.length === 1) {
      const lb = localBounds(getNode(s.scene!, sel[0]!).node, ctx.measurer);
      if (!lb) return;
      e.datas.anchor = { x: lb.x + (lb.width * (1 - dx)) / 2, y: lb.y + (lb.height * (1 - dy)) / 2 };
      e.datas.single = sel[0];
    } else {
      const b = selectionBounds(s.scene!, sel, ctx);
      if (!b) return;
      e.datas.anchor = { x: b.x + (b.width * (1 - dx)) / 2, y: b.y + (b.height * (1 - dy)) / 2 };
    }
    s.beginGesture();
  };
  const scale = (e: { dist: number[]; datas: Record<string, unknown> }) => {
    const anchor = e.datas.anchor as Point | undefined;
    if (!anchor) return;
    const [sx = 1, sy = 1] = e.dist;
    if (sx === 0 || sy === 0) return;
    const single = e.datas.single as string | undefined;
    const sel = ids();
    useEditor
      .getState()
      .updateGesture((sc) => (single ? scaleNode(sc, single, sx, sy, anchor) : scaleBy(sc, sel, sx, sy, anchor)));
  };

  // ------------------------------------------------------------ kliknięcia

  /** Łańcuch węzłów od klikniętego elementu w górę (od najgłębszego). */
  const nodeChain = (target: EventTarget | null): string[] => {
    const chain: string[] = [];
    let el = target instanceof Element ? target.closest('[data-node-id]') : null;
    while (el) {
      chain.push(el.getAttribute('data-node-id')!);
      el = el.parentElement?.closest('[data-node-id]') ?? null;
    }
    return chain;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useEditor.getState();
    const chain = nodeChain(e.target);
    const idx = chain.findIndex((id) => selectable.has(id));
    if (idx < 0) return;
    const id = chain[idx]!;
    const node = getNode(s.scene!, id).node;
    if (node.type === 'group') {
      s.setEnteredGroup(id);
      const child = chain[idx - 1];
      s.setSelection(child ? [child] : []);
    } else if (node.type === 'text') {
      s.setSelection([id]);
      s.setEditingText(id);
    }
  };

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (useEditor.getState().tool !== 'text' || panning || e.button !== 0) return;
    if (!(e.target instanceof Element) || !svgRef.current?.contains(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      const id = insertText(scenePoint(e.clientX, e.clientY));
      const s = useEditor.getState();
      s.setTool('select');
      s.setEditingText(id);
    } catch (err) {
      notifyError(err, 'Nie udało się dodać tekstu');
    }
  };

  // ------------------------------------------------------------ upuszczanie z panelu biblioteki

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(GRAPHIC_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(GRAPHIC_MIME);
    if (!id) return;
    e.preventDefault();
    insertGraphic(id, scenePoint(e.clientX, e.clientY)).catch((err) => notifyError(err, 'Nie udało się wstawić grafiki'));
  };

  // ------------------------------------------------------------ nakładki

  const overlays = useMemo(() => {
    const out: { id: string; x: number; y: number; width: number; height: number; kind: 'group' | 'highlight' }[] = [];
    if (enteredGroup && findNode(scene, enteredGroup)) {
      const b = sceneBounds(scene, enteredGroup, ctx);
      if (b) out.push({ id: `g-${enteredGroup}`, ...b, kind: 'group' });
    }
    for (const id of highlight) {
      if (!findNode(scene, id)) continue;
      const b = sceneBounds(scene, id, ctx);
      if (b) out.push({ id: `h-${id}`, ...b, kind: 'highlight' });
    }
    return out;
  }, [scene, enteredGroup, highlight]);

  const editingElement = editingTextId ? elementFor(editingTextId) : null;
  const single = targets.length === 1;

  return (
    <div className="mz-canvas-wrap" onDragOver={onDragOver} onDrop={onDrop}>
      <div
        ref={setScrollRef}
        className={`mz-canvas-scroll${panning ? ' panning' : ''}`}
        onPointerDownCapture={onPanPointerDown}
        style={{ cursor: panning ? 'grab' : tool === 'text' ? 'text' : undefined }}
      >
        <div ref={contentRef} style={{ position: 'relative', width: W + 2 * MARGIN, height: H + 2 * MARGIN }}>
          <div
            className="mz-artboard mz-checker"
            style={{ position: 'absolute', left: MARGIN, top: MARGIN, width: W, height: H }}
            onPointerDownCapture={onPointerDownCapture}
            onDoubleClick={onDoubleClick}
          >
            <svg
              ref={svgRef}
              width={W}
              height={H}
              viewBox={`0 0 ${scene.width} ${scene.height}`}
              overflow="visible"
              style={{ display: 'block' }}
            >
              <SceneView scene={scene} selectable={selectable} editingTextId={editingTextId} />
              <g pointerEvents="none">
                {overlays.map((o) => (
                  <rect
                    key={o.id}
                    x={o.x}
                    y={o.y}
                    width={o.width}
                    height={o.height}
                    fill="none"
                    stroke={o.kind === 'group' ? '#6f6c64' : '#5b4bb5'}
                    strokeWidth={2 / zoom}
                    strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                  />
                ))}
              </g>
            </svg>
          </div>

          {tool === 'select' && !panning && targets.every((t) => t.isConnected) && (
            <Moveable
              ref={moveableRef}
              target={single ? targets[0]! : targets}
              draggable
              rotatable
              scalable
              keepRatio={keepAspect}
              origin={false}
              renderDirections={['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']}
              onDragStart={dragStart}
              onDrag={drag}
              onDragEnd={gestureEnd}
              onDragGroupStart={dragStart}
              onDragGroup={drag}
              onDragGroupEnd={gestureEnd}
              onRotateStart={rotateStart}
              onRotate={rotate}
              onRotateEnd={gestureEnd}
              onRotateGroupStart={rotateStart}
              onRotateGroup={rotate}
              onRotateGroupEnd={gestureEnd}
              onScaleStart={scaleStart}
              onScale={scale}
              onScaleEnd={gestureEnd}
              onScaleGroupStart={scaleStart}
              onScaleGroup={scale}
              onScaleGroupEnd={gestureEnd}
            />
          )}

          {editingTextId && editingElement && contentRef.current && (
            <TextEditor key={editingTextId} nodeId={editingTextId} element={editingElement} container={contentRef.current} />
          )}
        </div>
      </div>

      {tool === 'select' && !panning && scrollEl && (
        <Selecto
          ref={selectoRef}
          container={scrollEl}
          dragContainer={scrollEl}
          selectableTargets={[() => Array.from(svgRef.current?.querySelectorAll<SVGElement>('[data-selectable="1"]') ?? [])]}
          hitRate={0}
          selectByClick
          selectFromInside={false}
          toggleContinueSelect={['shift']}
          ratio={0}
          onDragStart={(e) => {
            const moveable = moveableRef.current;
            const target = e.inputEvent.target as Element;
            if (useEditor.getState().editingTextId) {
              e.stop();
              return;
            }
            if (moveable?.isMoveableElement(target) || targets.some((t) => t === target || t.contains(target))) {
              e.stop();
            }
          }}
          onSelectEnd={(e) => {
            const s = useEditor.getState();
            const selectedIds = e.selected.map((el) => el.getAttribute('data-node-id')!).filter(Boolean);
            if (e.isClick && selectedIds.length === 0 && s.enteredGroup) {
              const groupEl = elementFor(s.enteredGroup);
              const target = e.inputEvent?.target as Node | undefined;
              if (!groupEl || !target || !groupEl.contains(target)) s.setEnteredGroup(null);
            }
            s.setSelection(selectedIds);
            if (e.isDragStart) {
              e.inputEvent.preventDefault();
              moveableRef.current?.waitToChangeTarget().then(() => {
                moveableRef.current?.dragStart(e.inputEvent);
              });
            }
          }}
        />
      )}

      <div className="mz-zoom">
        <Tooltip label="Pomniejsz (Ctrl+kółko)">
          <ActionIcon size="sm" variant="subtle" onClick={() => zoomAt(1 / 1.25)} aria-label="Pomniejsz">
            <IconMinus size={14} />
          </ActionIcon>
        </Tooltip>
        <span style={{ minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <Tooltip label="Powiększ (Ctrl+kółko)">
          <ActionIcon size="sm" variant="subtle" onClick={() => zoomAt(1.25)} aria-label="Powiększ">
            <IconPlus size={14} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Dopasuj do okna">
          <ActionIcon size="sm" variant="subtle" onClick={fit} aria-label="Dopasuj">
            <IconMaximize size={14} />
          </ActionIcon>
        </Tooltip>
        <span style={{ color: 'var(--mz-muted)' }}>
          {scene.width} × {scene.height}
        </span>
      </div>
    </div>
  );
}
