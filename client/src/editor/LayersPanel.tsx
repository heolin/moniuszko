import { useState } from 'react';
import { ActionIcon, Button, Group, Menu, TextInput, Tooltip } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconPhoto,
  IconFolder,
  IconTypography,
} from '@tabler/icons-react';
import {
  addLayer,
  deleteLayer,
  moveLayer,
  moveToContainer,
  randomId,
  updateLayer,
  updateNode,
  type Layer,
  type SceneNode,
} from '@moniuszko/shared';
import { useEditor } from './store';
import { notifyError } from '../notify';

function run(fn: () => void, what: string) {
  try {
    fn();
  } catch (e) {
    notifyError(e, what);
  }
}

function InlineName({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  return (
    <TextInput
      size="xs"
      value={v}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.currentTarget.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(v.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
      style={{ flex: 1 }}
    />
  );
}

const ICON = { asset: IconPhoto, text: IconTypography, group: IconFolder } as const;

function NodeRow({ node, depth, renaming, setRenaming }: { node: SceneNode; depth: number; renaming: string | null; setRenaming: (id: string | null) => void }) {
  const selection = useEditor((s) => s.selection);
  const [open, setOpen] = useState(true);
  const selected = selection.includes(node.id);
  const Icon = ICON[node.type];
  return (
    <>
      <div
        className={`mz-layer-row${selected ? ' selected' : ''}${node.hidden ? ' dimmed' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={(e) => {
          const s = useEditor.getState();
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            s.setSelection(selected ? s.selection.filter((x) => x !== node.id) : [...s.selection, node.id]);
          } else {
            // Zaznaczenie z panelu może sięgnąć do wnętrza grupy; płótno wchodzi wtedy do jej rodzica.
            const parent = s.scene ? findParentGroup(s.scene.layers, node.id) : null;
            s.setEnteredGroup(parent);
            s.setSelection([node.id]);
          }
        }}
        onDoubleClick={() => setRenaming(node.id)}
      >
        {node.type === 'group' ? (
          <ActionIcon size="xs" variant="transparent" color="gray" onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
            {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </ActionIcon>
        ) : (
          <span style={{ width: 18 }} />
        )}
        <Icon size={14} color="var(--mz-muted)" />
        {renaming === node.id ? (
          <InlineName
            value={node.name}
            onDone={(v) => {
              setRenaming(null);
              if (v) run(() => useEditor.getState().apply((sc) => updateNode(sc, node.id, { name: v })), 'Nie udało się zmienić nazwy');
            }}
          />
        ) : (
          <span className="name">{node.name || '(bez nazwy)'}</span>
        )}
        <ActionIcon
          size="xs"
          variant="transparent"
          color="gray"
          aria-label={node.hidden ? 'Pokaż' : 'Ukryj'}
          onClick={(e) => {
            e.stopPropagation();
            run(() => useEditor.getState().apply((sc) => updateNode(sc, node.id, { hidden: !node.hidden })), 'Nie udało się zmienić widoczności');
          }}
        >
          {node.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
        </ActionIcon>
        <ActionIcon
          size="xs"
          variant="transparent"
          color="gray"
          aria-label={node.locked ? 'Odblokuj' : 'Zablokuj'}
          onClick={(e) => {
            e.stopPropagation();
            run(() => useEditor.getState().apply((sc) => updateNode(sc, node.id, { locked: !node.locked })), 'Nie udało się zmienić blokady');
          }}
        >
          {node.locked ? <IconLock size={13} /> : <IconLockOpen size={13} />}
        </ActionIcon>
      </div>
      {node.type === 'group' &&
        open &&
        [...node.children].reverse().map((c) => <NodeRow key={c.id} node={c} depth={depth + 1} renaming={renaming} setRenaming={setRenaming} />)}
    </>
  );
}

function findParentGroup(layers: Layer[], id: string): string | null {
  const walk = (nodes: SceneNode[], parent: string | null): string | null | undefined => {
    for (const n of nodes) {
      if (n.id === id) return parent;
      if (n.type === 'group') {
        const r = walk(n.children, n.id);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };
  for (const l of layers) {
    const r = walk(l.children, null);
    if (r !== undefined) return r;
  }
  return null;
}

function LayerRow({ layer, index, count, renaming, setRenaming }: { layer: Layer; index: number; count: number; renaming: string | null; setRenaming: (id: string | null) => void }) {
  const active = useEditor((s) => s.activeLayerId === layer.id);
  const selectionCount = useEditor((s) => s.selection.length);
  const [open, setOpen] = useState(true);
  const apply = (fn: Parameters<ReturnType<typeof useEditor.getState>['apply']>[0], what: string) =>
    run(() => useEditor.getState().apply(fn), what);
  return (
    <>
      <div
        className={`mz-layer-row layer${active ? ' active-layer' : ''}${layer.hidden ? ' dimmed' : ''}`}
        onClick={() => {
          const s = useEditor.getState();
          s.setActiveLayer(layer.id);
          s.setEnteredGroup(null);
        }}
        onDoubleClick={() => setRenaming(layer.id)}
      >
        <ActionIcon size="xs" variant="transparent" color="gray" onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </ActionIcon>
        {renaming === layer.id ? (
          <InlineName
            value={layer.name}
            onDone={(v) => {
              setRenaming(null);
              if (v) apply((sc) => updateLayer(sc, layer.id, { name: v }), 'Nie udało się zmienić nazwy warstwy');
            }}
          />
        ) : (
          <span className="name">{layer.name}</span>
        )}
        <ActionIcon
          size="xs"
          variant="transparent"
          color="gray"
          aria-label={layer.hidden ? 'Pokaż warstwę' : 'Ukryj warstwę'}
          onClick={(e) => {
            e.stopPropagation();
            apply((sc) => updateLayer(sc, layer.id, { hidden: !layer.hidden }), 'Nie udało się zmienić widoczności');
          }}
        >
          {layer.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
        </ActionIcon>
        <ActionIcon
          size="xs"
          variant="transparent"
          color="gray"
          aria-label={layer.locked ? 'Odblokuj warstwę' : 'Zablokuj warstwę'}
          onClick={(e) => {
            e.stopPropagation();
            apply((sc) => updateLayer(sc, layer.id, { locked: !layer.locked }), 'Nie udało się zmienić blokady');
          }}
        >
          {layer.locked ? <IconLock size={13} /> : <IconLockOpen size={13} />}
        </ActionIcon>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon size="xs" variant="transparent" color="gray" onClick={(e) => e.stopPropagation()} aria-label="Więcej">
              <IconDots size={13} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => setRenaming(layer.id)}>Zmień nazwę</Menu.Item>
            <Menu.Item disabled={index === count - 1} onClick={() => apply((sc) => moveLayer(sc, layer.id, index + 1), 'Nie udało się przenieść warstwy')}>
              Przenieś wyżej
            </Menu.Item>
            <Menu.Item disabled={index === 0} onClick={() => apply((sc) => moveLayer(sc, layer.id, index - 1), 'Nie udało się przenieść warstwy')}>
              Przenieś niżej
            </Menu.Item>
            <Menu.Item
              disabled={selectionCount === 0}
              onClick={() => apply((sc) => moveToContainer(sc, useEditor.getState().selection, layer.id), 'Nie udało się przenieść obiektów')}
            >
              Przenieś zaznaczone tutaj
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              disabled={count === 1}
              onClick={() => apply((sc) => deleteLayer(sc, layer.id), 'Nie udało się usunąć warstwy')}
            >
              Usuń warstwę z zawartością
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      {open && [...layer.children].reverse().map((n) => <NodeRow key={n.id} node={n} depth={1} renaming={renaming} setRenaming={setRenaming} />)}
    </>
  );
}

export function LayersPanel() {
  const layers = useEditor((s) => s.scene?.layers ?? null);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!layers) return null;
  return (
    <div>
      {/* Wierzch na górze listy, jak w programach graficznych. */}
      {[...layers].reverse().map((l) => (
        <LayerRow key={l.id} layer={l} index={layers.indexOf(l)} count={layers.length} renaming={renaming} setRenaming={setRenaming} />
      ))}
      <Group mt="sm">
        <Tooltip label="Nowa warstwa na wierzchu">
          <Button
            size="xs"
            variant="default"
            onClick={() => {
              const id = randomId('l');
              run(() => {
                useEditor.getState().apply((sc) => addLayer(sc, { id, name: `Warstwa ${sc.layers.length + 1}` }));
                useEditor.getState().setActiveLayer(id);
                setRenaming(id);
              }, 'Nie udało się dodać warstwy');
            }}
          >
            + Warstwa
          </Button>
        </Tooltip>
      </Group>
    </div>
  );
}
