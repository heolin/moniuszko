import { Anchor, Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import type { ImportRow } from './useImport';

type Props = {
  rows: ImportRow[];
  running: boolean;
  opened: boolean;
  onClose: () => void;
  onForce: (key: string) => void;
  onSkip: (key: string) => void;
  onShowAdded: () => void;
};

function status(row: ImportRow): { text: string; color: string } {
  if (row.error) return { text: `błąd: ${row.error}`, color: 'var(--mz-accent)' };
  const r = row.result;
  if (!r) return { text: 'przetwarzanie…', color: 'var(--mz-muted)' };
  switch (r.status) {
    case 'added':
      return r.warnings.length
        ? { text: `dodano · ${r.warnings.join('; ')}`, color: '#9a6a00' }
        : { text: 'dodano', color: '#2f7a4b' };
    case 'duplicate':
      return { text: `duplikat „${r.duplicateOf.title}”`, color: '#9a6a00' };
    case 'rejected':
      return { text: `odrzucono · ${r.error}`, color: 'var(--mz-accent)' };
    default: {
      const never: never = r;
      throw new Error(`Nieznany wynik importu: ${JSON.stringify(never)}`);
    }
  }
}

export function ImportModal({ rows, running, opened, onClose, onForce, onSkip, onShowAdded }: Props) {
  const done = rows.filter((r) => r.result || r.error).length;
  return (
    <Modal opened={opened} onClose={onClose} title={`Import ${rows.length} plików`} size="lg">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm">
            Przetworzono {done} z {rows.length}
          </Text>
          <Text size="sm" c="dimmed">
            sanityzacja → miniatura → zapis
          </Text>
        </Group>
        <Progress value={rows.length ? (done / rows.length) * 100 : 0} animated={running} />
        <div style={{ border: '1px solid var(--mz-line)', borderRadius: 6, maxHeight: 380, overflow: 'auto' }}>
          {rows.map((row) => {
            const s = status(row);
            return (
              <div
                key={row.key}
                style={{ display: 'flex', gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--mz-line)', fontSize: 13 }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.file.name}</span>
                <span style={{ color: s.color, fontSize: 12, textAlign: 'right' }}>
                  {s.text}
                  {row.result?.status === 'duplicate' && (
                    <>
                      {' · '}
                      <Anchor size="xs" onClick={() => onSkip(row.key)}>
                        pomiń
                      </Anchor>
                      {' / '}
                      <Anchor size="xs" onClick={() => onForce(row.key)}>
                        dodaj mimo to
                      </Anchor>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <Text size="xs" c="dimmed">
          Nowe grafiki trafiają do biblioteki ze statusem „bez metadanych”. Agent znajdzie je przez narzędzie MCP list_untagged.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Ukryj
          </Button>
          <Button onClick={onShowAdded} disabled={running}>
            Pokaż dodane
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
