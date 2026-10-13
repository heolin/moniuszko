import { useEffect, useState } from 'react';
import { Button, Group, Modal, Radio, Stack, Text, TextInput } from '@mantine/core';
import { allNodes, type ExportMode } from '@moniuszko/shared';
import { api } from '../api/client';
import { DirPickerModal } from '../components/DirPickerModal';
import { notifyError, notifyOk } from '../notify';
import { useEditor } from './store';

type Props = { opened: boolean; onClose: () => void; beforeExport: () => Promise<void> };

export function ExportModal({ opened, onClose, beforeExport }: Props) {
  const id = useEditor((s) => s.id);
  const scene = useEditor((s) => s.scene);
  const [mode, setMode] = useState<ExportMode>('standalone');
  const [fileName, setFileName] = useState('');
  const [dir, setDir] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened || !id) return;
    setFileName(`${id}.svg`);
    api
      .settings()
      .then((s) => setDir(s.exportsDir))
      .catch((e) => notifyError(e, 'Nie udało się wczytać folderu eksportu'));
  }, [opened, id]);

  const fonts = scene
    ? [...new Set(allNodes(scene).flatMap((n) => (n.type === 'text' && !n.hidden ? [n.fontFamily] : [])))]
    : [];

  async function run() {
    if (!id) throw new Error('Brak kompozycji');
    setBusy(true);
    try {
      await beforeExport();
      const r = await api.exportComposition(id, { mode, dir, fileName });
      notifyOk(`Zapisano ${r.path}`);
      onClose();
    } catch (e) {
      notifyError(e, 'Eksport nie powiódł się');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Eksport kompozycji" size="lg">
      <Stack gap="sm">
        <Radio.Group value={mode} onChange={(v) => setMode(v as ExportMode)} label="Tryb">
          <Stack gap="xs" mt={6}>
            <Radio
              value="standalone"
              label="Plik samodzielny"
              description="Treść grafik jest wklejona do pliku, atrybuty edytora (data-mz-*) są usunięte. Plik otwiera się bez dostępu do biblioteki."
            />
            <Radio
              value="linked"
              label="Z referencjami do biblioteki"
              description="Każda grafika jest odwołaniem <image href> do pliku w bibliotece (ścieżka względna od folderu eksportu). Zmiana grafiki w bibliotece jest widoczna w tym pliku. Plik wymaga dostępu do folderu biblioteki."
            />
          </Stack>
        </Radio.Group>
        <TextInput label="Nazwa pliku" value={fileName} onChange={(e) => setFileName(e.currentTarget.value)} />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Folder
          </Text>
          <Group gap="xs" wrap="nowrap">
            <TextInput style={{ flex: 1 }} value={dir} onChange={(e) => setDir(e.currentTarget.value)} />
            <Button variant="default" onClick={() => setPicking(true)}>
              Wybierz…
            </Button>
          </Group>
        </div>
        <Text size="xs" c="dimmed">
          Ukryte warstwy i obiekty nie trafiają do eksportu. Teksty zostają elementami &lt;text&gt;
          {fonts.length ? `; odbiorca musi mieć zainstalowane fonty: ${fonts.join(', ')}.` : '.'}
        </Text>
        <Group justify="space-between">
          <Button variant="subtle" component="a" href={id ? `/api/compositions/${id}/download` : undefined} onClick={() => void beforeExport()}>
            Pobierz plik samodzielny
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              Anuluj
            </Button>
            <Button onClick={run} loading={busy} disabled={!fileName.trim() || !dir.trim()}>
              Eksportuj
            </Button>
          </Group>
        </Group>
      </Stack>
      <DirPickerModal
        opened={picking}
        initial={dir}
        title="Folder eksportu"
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setDir(p);
          setPicking(false);
        }}
      />
    </Modal>
  );
}
