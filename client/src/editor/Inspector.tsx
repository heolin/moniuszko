import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  ColorInput,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
} from '@tabler/icons-react';
import {
  getNode,
  localBounds,
  resize,
  setCanvas,
  setRotation,
  setTransform,
  updateNode,
  updateText,
  type AssetNode,
  type SceneNode,
  type TextNode,
} from '@moniuszko/shared';
import { api } from '../api/client';
import { notifyError } from '../notify';
import { action } from './actions';
import { GraphicPicker } from './LibraryPanel';
import { replaceGraphic } from './insert';
import { ctx, useEditor } from './store';

const FONTS = ['Georgia, serif', 'Inter, sans-serif', 'DejaVu Sans', 'DejaVu Serif', 'Arial, sans-serif', 'Times New Roman, serif', 'Courier New, monospace'];

const r2 = (n: number) => Math.round(n * 100) / 100;

function guarded(fn: () => void, what: string) {
  try {
    fn();
  } catch (e) {
    notifyError(e, what);
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid var(--mz-line)', paddingBottom: 14, marginBottom: 14 }}>
      <div className="mz-section-title">{title}</div>
      {children}
    </div>
  );
}

/** Pole liczbowe zatwierdzane przy opuszczeniu albo Enter, żeby nie tworzyć wpisu historii na każdy znak. */
function Num({ label, value, onCommit, min, step = 1, suffix }: { label: string; value: number; onCommit: (v: number) => void; min?: number; step?: number; suffix?: string }) {
  const [v, setV] = useState<string | number>(r2(value));
  useEffect(() => setV(r2(value)), [value]);
  const commit = () => {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n !== r2(value)) onCommit(n);
    else setV(r2(value));
  };
  return (
    <NumberInput
      size="xs"
      label={label}
      value={v}
      min={min}
      step={step}
      suffix={suffix}
      decimalScale={2}
      onChange={setV}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

function AlignButtons() {
  const ids: [string, React.ComponentType<{ size?: number }>][] = [
    ['align-left', IconLayoutAlignLeft],
    ['align-hcenter', IconLayoutAlignCenter],
    ['align-right', IconLayoutAlignRight],
    ['align-top', IconLayoutAlignTop],
    ['align-vcenter', IconLayoutAlignMiddle],
    ['align-bottom', IconLayoutAlignBottom],
    ['distribute-h', IconLayoutDistributeHorizontal],
    ['distribute-v', IconLayoutDistributeVertical],
  ];
  const state = useEditor();
  return (
    <Group gap={4}>
      {ids.map(([id, Icon]) => {
        const a = action(id);
        return (
          <Tooltip key={id} label={a.label}>
            <ActionIcon variant="default" disabled={!a.enabled(state)} onClick={() => guarded(() => void a.run(), a.label)} aria-label={a.label}>
              <Icon size={16} />
            </ActionIcon>
          </Tooltip>
        );
      })}
    </Group>
  );
}

function AssetSection({ node }: { node: AssetNode }) {
  const [libVersion, setLibVersion] = useState<number | 'missing' | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .graphic(node.assetId)
      .then((g) => !cancelled && setLibVersion(g.version))
      .catch((e: { status?: number }) => {
        if (cancelled) return;
        if (e.status === 404) setLibVersion('missing');
        else notifyError(e, 'Nie udało się sprawdzić grafiki w bibliotece');
      });
    return () => {
      cancelled = true;
    };
  }, [node.assetId, node.assetVersion]);

  return (
    <Section title="Instancja">
      <Text size="xs" c="dimmed">
        Kopia grafiki z biblioteki wklejona do pliku kompozycji (wersja {node.assetVersion}).
      </Text>
      {libVersion === 'missing' && (
        <Text size="xs" c="red" mt={4}>
          Tej grafiki nie ma już w bibliotece. Kopia w kompozycji zostaje; eksport z referencjami jej nie obejmie.
        </Text>
      )}
      {typeof libVersion === 'number' && libVersion > node.assetVersion && (
        <Text size="xs" c="orange" mt={4}>
          Biblioteka ma nowszą wersję tej grafiki ({libVersion}).
        </Text>
      )}
      <Group gap={6} mt="xs">
        {typeof libVersion === 'number' && libVersion > node.assetVersion && (
          <Button size="xs" onClick={() => replaceGraphic(node.id, node.assetId).catch((e) => notifyError(e, 'Nie udało się podmienić grafiki'))}>
            Podmień na aktualną wersję
          </Button>
        )}
        <Button size="xs" variant="default" onClick={() => setPicking(true)}>
          Zamień na inną grafikę…
        </Button>
        {libVersion !== 'missing' && (
          <Button size="xs" variant="subtle" component="a" href={`/library?g=${node.assetId}`} target="_blank">
            Pokaż w bibliotece
          </Button>
        )}
      </Group>
      <Modal opened={picking} onClose={() => setPicking(false)} title="Zamień na inną grafikę" size="lg">
        <GraphicPicker
          draggable={false}
          onPick={(g) => {
            setPicking(false);
            replaceGraphic(node.id, g.id).catch((e) => notifyError(e, 'Nie udało się zamienić grafiki'));
          }}
        />
      </Modal>
    </Section>
  );
}

function TextSection({ node }: { node: TextNode }) {
  const apply = (patch: Parameters<typeof updateText>[2]) =>
    guarded(() => useEditor.getState().apply((sc) => updateText(sc, node.id, patch)), 'Nie udało się zmienić tekstu');
  const [text, setText] = useState(node.text);
  useEffect(() => setText(node.text), [node.text]);
  return (
    <Section title="Tekst">
      <Textarea
        size="xs"
        autosize
        minRows={2}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => text !== node.text && text.trim() && apply({ text })}
      />
      <Group grow gap={8} mt={6}>
        <Autocomplete size="xs" label="Font" data={FONTS} value={node.fontFamily} onChange={(v) => v.trim() && apply({ fontFamily: v })} />
        <Num label="Rozmiar" value={node.fontSize} min={1} onCommit={(v) => apply({ fontSize: v })} />
      </Group>
      <Group grow gap={8} mt={6}>
        <ColorInput size="xs" label="Kolor" value={node.fill} onChangeEnd={(v) => apply({ fill: v })} />
        <Num label="Interlinia" value={node.lineHeight} min={0.5} step={0.1} onCommit={(v) => apply({ lineHeight: v })} />
      </Group>
      <SegmentedControl
        size="xs"
        mt={8}
        fullWidth
        value={node.anchor}
        onChange={(v) => apply({ anchor: v as TextNode['anchor'] })}
        data={[
          { value: 'start', label: 'Do lewej' },
          { value: 'middle', label: 'Środek' },
          { value: 'end', label: 'Do prawej' },
        ]}
      />
      <Group mt={8} gap="md">
        <Checkbox size="xs" label="Pogrubienie" checked={node.fontWeight >= 600} onChange={(e) => apply({ fontWeight: e.currentTarget.checked ? 700 : 400 })} />
        <Checkbox size="xs" label="Kursywa" checked={node.fontStyle === 'italic'} onChange={(e) => apply({ fontStyle: e.currentTarget.checked ? 'italic' : 'normal' })} />
      </Group>
    </Section>
  );
}

function NodeInspector({ node }: { node: SceneNode }) {
  const keepAspect = useEditor((s) => s.keepAspect);
  const lb = localBounds(node, ctx.measurer);
  const t = node.transform;
  const w = lb ? lb.width * Math.abs(t.scaleX) : 0;
  const h = lb ? lb.height * Math.abs(t.scaleY) : 0;
  const apply = (fn: Parameters<ReturnType<typeof useEditor.getState>['apply']>[0], what: string) =>
    guarded(() => useEditor.getState().apply(fn), what);
  const kind = { asset: 'grafika z biblioteki', text: 'tekst', group: 'grupa' }[node.type];
  return (
    <>
      <Section title="Zaznaczenie">
        <Text size="sm" fw={600}>
          {node.name || '(bez nazwy)'}
        </Text>
        <Text size="xs" c="dimmed">
          {kind}
          {node.type === 'group' ? ` · ${node.children.length} obiektów · kliknij dwukrotnie, żeby edytować wnętrze` : ''}
        </Text>
      </Section>
      <Section title="Położenie i rozmiar">
        <Group grow gap={8}>
          <Num label="X" value={t.x} onCommit={(x) => apply((sc) => setTransform(sc, node.id, { x }), 'Nie udało się przesunąć')} />
          <Num label="Y" value={t.y} onCommit={(y) => apply((sc) => setTransform(sc, node.id, { y }), 'Nie udało się przesunąć')} />
        </Group>
        <Group grow gap={8} mt={6}>
          <Num label="Szerokość" value={w} min={0.01} onCommit={(width) => apply((sc) => resize(sc, node.id, { width, keepAspect }, ctx), 'Nie udało się zmienić rozmiaru')} />
          <Num label="Wysokość" value={h} min={0.01} onCommit={(height) => apply((sc) => resize(sc, node.id, { height, keepAspect }, ctx), 'Nie udało się zmienić rozmiaru')} />
        </Group>
        <Group grow gap={8} mt={6} align="flex-end">
          <Num label="Obrót" value={t.rotation} suffix="°" onCommit={(deg) => apply((sc) => setRotation(sc, node.id, deg, ctx), 'Nie udało się obrócić')} />
          <Switch size="xs" label="Zachowaj proporcje" checked={keepAspect} onChange={(e) => useEditor.getState().setKeepAspect(e.currentTarget.checked)} mb={6} />
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          X i Y to położenie lewego górnego rogu przed obrotem, w układzie {node.type === 'text' ? 'warstwy (dla tekstu: punkt wyrównania)' : 'warstwy lub grupy'}.
        </Text>
      </Section>
      <Section title="Wygląd">
        <Text size="xs" c="dimmed">
          Krycie: {Math.round(node.opacity * 100)}%
        </Text>
        <Slider
          size="sm"
          min={0}
          max={100}
          defaultValue={Math.round(node.opacity * 100)}
          key={`${node.id}-${node.opacity}`}
          onChangeEnd={(v) => apply((sc) => updateNode(sc, node.id, { opacity: v / 100 }), 'Nie udało się zmienić krycia')}
        />
        <Group gap={6} mt="sm">
          <Button size="xs" variant="default" onClick={() => void action('flip-h').run()}>
            Odbij poziomo
          </Button>
          <Button size="xs" variant="default" onClick={() => void action('flip-v').run()}>
            Odbij pionowo
          </Button>
        </Group>
      </Section>
      {node.type === 'asset' && <AssetSection node={node} />}
      {node.type === 'text' && <TextSection node={node} />}
      <Section title="Wyrównanie do płótna">
        <AlignButtons />
      </Section>
    </>
  );
}

function CompositionInspector() {
  const scene = useEditor((s) => s.scene)!;
  const meta = useEditor((s) => s.meta)!;
  const id = useEditor((s) => s.id);
  const [name, setName] = useState(meta.name);
  useEffect(() => setName(meta.name), [meta.name]);
  const apply = (fn: Parameters<ReturnType<typeof useEditor.getState>['apply']>[0]) =>
    guarded(() => useEditor.getState().apply(fn), 'Nie udało się zmienić płótna');
  return (
    <>
      <Section title="Kompozycja">
        <TextInput
          size="xs"
          label="Nazwa"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => name.trim() && name !== meta.name && useEditor.getState().setMeta({ name: name.trim() })}
        />
        <Group mt="sm" gap={6}>
          <Badge color={meta.status === 'draft' ? 'violet' : 'green'} variant="light">
            {meta.author === 'agent' ? 'agent' : 'człowiek'} · {meta.status === 'draft' ? 'szkic' : 'przejrzana'}
          </Badge>
          {meta.status === 'draft' ? (
            <Button size="compact-xs" onClick={() => useEditor.getState().setMeta({ status: 'reviewed' })}>
              Oznacz jako przejrzaną
            </Button>
          ) : (
            <Button size="compact-xs" variant="subtle" onClick={() => useEditor.getState().setMeta({ status: 'draft' })}>
              Oznacz jako szkic
            </Button>
          )}
        </Group>
      </Section>
      <Section title="Płótno">
        <Group grow gap={8}>
          <Num label="Szerokość" value={scene.width} min={1} onCommit={(width) => apply((sc) => setCanvas(sc, { width }))} />
          <Num label="Wysokość" value={scene.height} min={1} onCommit={(height) => apply((sc) => setCanvas(sc, { height }))} />
        </Group>
        <Checkbox
          size="xs"
          mt="sm"
          label="Przezroczyste tło"
          checked={scene.background === null}
          onChange={(e) => apply((sc) => setCanvas(sc, { background: e.currentTarget.checked ? null : '#ffffff' }))}
        />
        {scene.background !== null && (
          <ColorInput size="xs" mt={6} label="Kolor tła" value={scene.background} onChangeEnd={(v) => apply((sc) => setCanvas(sc, { background: v }))} />
        )}
      </Section>
      <Section title="Plik">
        <Text size="xs" c="dimmed">
          compositions/{id}.svg
        </Text>
      </Section>
    </>
  );
}

export function Inspector() {
  const scene = useEditor((s) => s.scene);
  const selection = useEditor((s) => s.selection);
  if (!scene) return null;
  if (selection.length === 0) return <Stack gap={0} p="md"><CompositionInspector /></Stack>;
  if (selection.length === 1) {
    const node = getNode(scene, selection[0]!).node;
    return (
      <Stack gap={0} p="md">
        <NodeInspector key={node.id} node={node} />
      </Stack>
    );
  }
  return (
    <Stack gap={0} p="md">
      <Section title="Zaznaczenie">
        <Text size="sm" fw={600}>
          {selection.length} obiekty
        </Text>
      </Section>
      <Section title="Wyrównanie i rozmieszczenie">
        <AlignButtons />
        <Text size="xs" c="dimmed" mt={6}>
          Kilka obiektów wyrównuje się do prostokąta zaznaczenia; rozmieszczenie wymaga co najmniej trzech.
        </Text>
      </Section>
      <Group gap={6}>
        <Button size="xs" variant="default" onClick={() => guarded(() => void action('group').run(), 'Nie udało się zgrupować')}>
          Grupuj
        </Button>
        <Button size="xs" variant="default" onClick={() => void action('flip-h').run()}>
          Odbij poziomo
        </Button>
        <Button size="xs" variant="subtle" color="red" onClick={() => void action('delete').run()}>
          Usuń
        </Button>
      </Group>
    </Stack>
  );
}
