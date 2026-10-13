import { useEffect, useState } from 'react';
import { Button, Group, Loader, Modal, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { IconArrowUp, IconFolder } from '@tabler/icons-react';
import { api } from '../api/client';
import { notifyError } from '../notify';

type Props = {
  opened: boolean;
  initial: string;
  title: string;
  onClose: () => void;
  onPick: (path: string) => void;
};

/**
 * Wybór folderu na maszynie serwera. Przeglądarka nie daje dostępu do ścieżek na dysku, więc
 * listę podfolderów zwraca serwer (GET /api/fs/dirs).
 */
export function DirPickerModal({ opened, initial, title, onClose, onPick }: Props) {
  const [path, setPath] = useState(initial);
  const [typed, setTyped] = useState(initial);
  const [listing, setListing] = useState<{ path: string; parent: string; dirs: string[] } | null>(null);

  useEffect(() => {
    if (opened) {
      setPath(initial);
      setTyped(initial);
    }
  }, [opened, initial]);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setListing(null);
    api
      .listDirs(path)
      .then((l) => {
        if (!cancelled) {
          setListing(l);
          setTyped(l.path);
        }
      })
      .catch((e) => {
        notifyError(e, 'Nie można otworzyć folderu');
        // Folder nie istnieje (np. jeszcze nie utworzony): pokaż jego rodzica.
        if (!cancelled && path !== '/') setPath(path.replace(/\/[^/]*\/?$/, '') || '/');
      });
    return () => {
      cancelled = true;
    };
  }, [opened, path]);

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="lg">
      <Stack gap="sm">
        <Group gap="xs">
          <Button variant="default" size="xs" leftSection={<IconArrowUp size={14} />} onClick={() => listing && setPath(listing.parent)}>
            W górę
          </Button>
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setPath(typed);
            }}
          />
        </Group>
        <ScrollArea h={300} style={{ border: '1px solid var(--mz-line)', borderRadius: 6 }}>
          {!listing ? (
            <Loader m="md" size="sm" />
          ) : listing.dirs.length === 0 ? (
            <Text size="sm" c="dimmed" p="sm">
              Brak podfolderów.
            </Text>
          ) : (
            listing.dirs.map((d) => (
              <div
                key={d}
                className="mz-filter-row"
                style={{ justifyContent: 'flex-start', gap: 8 }}
                onDoubleClick={() => setPath(`${listing.path.replace(/\/$/, '')}/${d}`)}
              >
                <IconFolder size={16} />
                <span>{d}</span>
              </div>
            ))
          )}
        </ScrollArea>
        <Text size="xs" c="dimmed">
          Kliknij dwukrotnie, żeby wejść do folderu. Możesz też wpisać ścieżkę, która jeszcze nie istnieje — zostanie utworzona.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => onPick(typed)}>Wybierz ten folder</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
