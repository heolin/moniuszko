import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deleteNodes, getNode, updateNode, updateText, type TextNode } from '@moniuszko/shared';
import { useEditor } from './store';

type Props = {
  nodeId: string;
  /** Element <g> tekstu na płótnie; z niego bierzemy położenie pola edycji. */
  element: SVGGElement;
  container: HTMLElement;
};

/**
 * Edycja tekstu w miejscu: pole tekstowe nałożone na tekst na płótnie. Enter z Ctrl albo
 * kliknięcie poza polem zatwierdza, Esc anuluje. Pusty tekst usuwa węzeł.
 */
export function TextEditor({ nodeId, element, container }: Props) {
  const scene = useEditor((s) => s.scene)!;
  const zoom = useEditor((s) => s.zoom);
  const node = getNode(scene, nodeId).node as TextNode;
  const [value, setValue] = useState(node.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const r = element.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    setBox({ left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height });
  }, [element, container, zoom, value]);

  useEffect(() => {
    // Po klatce: przy dwukliku przeglądarka kończy obsługę myszy i odbiera fokus polu
    // ustawiony od razu.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    const s = useEditor.getState();
    s.setEditingText(null);
    if (!commit || value === node.text) return;
    if (value.trim() === '') {
      s.apply((sc) => deleteNodes(sc, [nodeId]));
      s.setSelection([]);
    } else {
      // Nazwa nadana automatycznie (pierwszy wiersz treści) idzie za treścią; nazwa wpisana ręcznie zostaje.
      const autoName = (t: string) => t.split('\n')[0]!.slice(0, 40);
      const rename = node.name === autoName(node.text);
      s.apply((sc) => {
        const next = updateText(sc, nodeId, { text: value });
        return rename ? updateNode(next, nodeId, { name: autoName(value) }) : next;
      });
    }
  }

  if (!box) return null;
  const fontPx = node.fontSize * Math.abs(node.transform.scaleY) * zoom;
  return (
    <textarea
      ref={ref}
      className="mz-text-editor"
      value={value}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
      }}
      style={{
        left: box.left,
        top: box.top,
        minWidth: Math.max(box.width, 40),
        minHeight: box.height,
        width: Math.max(box.width + fontPx, 60),
        height: box.height + fontPx * 0.2,
        fontFamily: node.fontFamily,
        fontSize: fontPx,
        fontWeight: node.fontWeight,
        fontStyle: node.fontStyle,
        lineHeight: node.lineHeight,
        color: node.fill,
        textAlign: node.anchor === 'start' ? 'left' : node.anchor === 'middle' ? 'center' : 'right',
      }}
    />
  );
}
