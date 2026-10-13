import { ActionIcon, Button, Menu, Text, Tooltip } from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconBoxMultiple,
  IconBoxOff,
  IconChevronDown,
  IconChevronUp,
  IconChevronsDown,
  IconChevronsUp,
  IconFlipVertical,
  IconHandStop,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignRight,
  IconLayoutDistributeHorizontal,
  IconPointer,
  IconShape,
  IconTypography,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useStore } from 'zustand';
import { notifyError } from '../notify';
import { action } from './actions';
import { insertShape, SHAPE_PRESETS } from './insert';
import { useEditor, type SaveState } from './store';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'zapisano',
  dirty: 'niezapisane zmiany',
  saving: 'zapisywanie…',
  error: 'błąd zapisu',
  conflict: 'konflikt z wersją na serwerze',
};

function Btn({ id, icon, active }: { id: string; icon: React.ReactNode; active?: boolean }) {
  const a = action(id);
  // Subskrypcja całego stanu i historii: dostępność akcji zależy od zaznaczenia i od undo/redo.
  const state = useEditor();
  useStore(useEditor.temporal, (t) => `${t.pastStates.length}:${t.futureStates.length}`);
  return (
    <Tooltip label={a.shortcut ? `${a.label} (${a.shortcut})` : a.label}>
      <ActionIcon
        variant={active ? 'light' : 'subtle'}
        color={active ? undefined : 'dark'}
        size="lg"
        disabled={!a.enabled(state)}
        onClick={() => {
          try {
            void a.run();
          } catch (e) {
            notifyError(e, a.label);
          }
        }}
        aria-label={a.label}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

export function Toolbar({ onSave, onExport }: { onSave: () => void; onExport: () => void }) {
  const navigate = useNavigate();
  const name = useEditor((s) => s.meta?.name ?? '');
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const tool = useEditor((s) => s.tool);
  const sep = <div className="mz-ed-sep" />;
  return (
    <div className="mz-ed-toolbar">
      <Tooltip label="Wróć do listy kompozycji">
        <ActionIcon variant="default" size="lg" onClick={() => navigate('/compositions')} aria-label="Wróć">
          <IconArrowLeft size={18} />
        </ActionIcon>
      </Tooltip>
      <Text fw={600} ml={6} maw={240} truncate>
        {name}
      </Text>
      <Tooltip label={saveError ?? 'Zapis następuje automatycznie; Ctrl+S zapisuje od razu'}>
        <Text size="xs" c={saveState === 'error' || saveState === 'conflict' ? 'red' : 'dimmed'} mr={4}>
          {SAVE_LABEL[saveState]}
        </Text>
      </Tooltip>
      {sep}
      <Btn id="undo" icon={<IconArrowBackUp size={18} />} />
      <Btn id="redo" icon={<IconArrowForwardUp size={18} />} />
      {sep}
      <Btn id="tool-select" icon={<IconPointer size={18} />} active={tool === 'select'} />
      <Btn id="tool-text" icon={<IconTypography size={18} />} active={tool === 'text'} />
      <Btn id="tool-pan" icon={<IconHandStop size={18} />} active={tool === 'pan'} />
      <Menu position="bottom-start" withinPortal>
        <Menu.Target>
          <Tooltip label="Kształty">
            <ActionIcon variant="subtle" color="dark" size="lg" aria-label="Kształty">
              <IconShape size={18} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          {SHAPE_PRESETS.map((p) => (
            <Menu.Item
              key={p.preset}
              onClick={() => {
                try {
                  insertShape(p.preset);
                } catch (e) {
                  notifyError(e, 'Nie udało się wstawić kształtu');
                }
              }}
            >
              {p.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      {sep}
      <Btn id="group" icon={<IconBoxMultiple size={18} />} />
      <Btn id="ungroup" icon={<IconBoxOff size={18} />} />
      {sep}
      <Btn id="front" icon={<IconChevronsUp size={18} />} />
      <Btn id="forward" icon={<IconChevronUp size={18} />} />
      <Btn id="backward" icon={<IconChevronDown size={18} />} />
      <Btn id="back" icon={<IconChevronsDown size={18} />} />
      {sep}
      <Btn id="align-left" icon={<IconLayoutAlignLeft size={18} />} />
      <Btn id="align-hcenter" icon={<IconLayoutAlignCenter size={18} />} />
      <Btn id="align-right" icon={<IconLayoutAlignRight size={18} />} />
      <Btn id="distribute-h" icon={<IconLayoutDistributeHorizontal size={18} />} />
      <div style={{ flex: 1 }} />
      <Btn id="flip-h" icon={<IconFlipVertical size={18} style={{ transform: 'rotate(90deg)' }} />} />
      <Button variant="default" size="xs" onClick={onSave} disabled={saveState === 'saved' || saveState === 'saving'}>
        Zapisz
      </Button>
      <Button size="xs" onClick={onExport}>
        Eksportuj…
      </Button>
    </div>
  );
}
