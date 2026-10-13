import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Code, Group, Loader, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import type { SettingsDto } from '@moniuszko/shared';
import { api } from '../api/client';
import { DirPickerModal } from '../components/DirPickerModal';
import { notifyError, notifyOk } from '../notify';

type DirKey = 'workspace' | 'libraryDir' | 'compositionsDir' | 'exportsDir';

const DIR_LABELS: Record<DirKey, string> = {
  workspace: 'Workspace',
  libraryDir: 'Biblioteka grafik',
  compositionsDir: 'Kompozycje',
  exportsDir: 'Domyślny folder eksportu',
};

const TOOLS = [
  'search_graphics',
  'get_graphic',
  'add_graphic',
  'update_graphic_metadata',
  'list_untagged',
  'get_library_overview',
  'list_compositions',
  'get_composition',
  'create_composition',
  'apply_scene_ops',
];

export function SettingsPage() {
  const [saved, setSaved] = useState<SettingsDto | null>(null);
  const [draft, setDraft] = useState<SettingsDto | null>(null);
  const [moveFiles, setMoveFiles] = useState(false);
  const [picking, setPicking] = useState<DirKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSaved(s);
        setDraft(s);
      })
      .catch((e) => notifyError(e, 'Nie udało się wczytać ustawień'));
  }, []);

  if (!saved || !draft) return <Loader m="xl" />;

  const changedDirs = (['libraryDir', 'compositionsDir', 'exportsDir'] as const).filter((k) => draft[k] !== saved[k]);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const mcpUrl = `${window.location.origin}/mcp`;

  async function save() {
    if (!draft || !saved) throw new Error('Ustawienia nie są wczytane');
    setBusy(true);
    try {
      const patch = {
        ...(draft.workspace !== saved.workspace ? { workspace: draft.workspace } : {}),
        ...Object.fromEntries(changedDirs.map((k) => [k, draft[k]])),
        normalizeSvg: draft.normalizeSvg,
        warnDuplicates: draft.warnDuplicates,
        moveFiles: changedDirs.length > 0 ? moveFiles : false,
      };
      const next = await api.updateSettings(patch);
      setSaved(next);
      setDraft(next);
      setMoveFiles(false);
      notifyOk('Zapisano ustawienia');
    } catch (e) {
      notifyError(e, 'Nie udało się zapisać ustawień');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mz-main">
      <main className="mz-content">
        <Stack maw={760} gap="md">
          <Paper withBorder p="md">
            <Title order={4} mb="sm">
              Foldery
            </Title>
            {(Object.keys(DIR_LABELS) as DirKey[]).map((key) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <Text size="xs" c="dimmed" mb={4}>
                  {DIR_LABELS[key]}
                </Text>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    style={{ flex: 1 }}
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.currentTarget.value })}
                  />
                  <Button variant="default" onClick={() => setPicking(key)}>
                    Wybierz…
                  </Button>
                </Group>
              </div>
            ))}
            <Text size="xs" c="dimmed">
              Workspace zawiera bazę <code>moniuszko.db</code> i miniatury. Zmiana workspace otwiera inną bazę i niczego nie
              przenosi. Foldery biblioteki, kompozycji i eksportu domyślnie leżą w workspace.
            </Text>
            {changedDirs.length > 0 && (
              <Checkbox
                mt="sm"
                checked={moveFiles}
                onChange={(e) => setMoveFiles(e.currentTarget.checked)}
                label="Przenieś istniejące pliki do nowych folderów (w przeciwnym razie aplikacja tylko wskaże nowe miejsce)"
              />
            )}
          </Paper>

          <Paper withBorder p="md">
            <Title order={4} mb="sm">
              Import
            </Title>
            <Checkbox
              checked={draft.normalizeSvg}
              onChange={(e) => setDraft({ ...draft, normalizeSvg: e.currentTarget.checked })}
              label="Normalizuj SVG przez svgo (oryginał zostaje w library/originals/)"
              mb="xs"
            />
            <Checkbox
              checked={draft.warnDuplicates}
              onChange={(e) => setDraft({ ...draft, warnDuplicates: e.currentTarget.checked })}
              label="Ostrzegaj o duplikatach (ta sama treść pliku)"
            />
          </Paper>

          <Group justify="flex-end">
            <Button variant="default" disabled={!dirty} onClick={() => setDraft(saved)}>
              Przywróć
            </Button>
            <Button disabled={!dirty} loading={busy} onClick={save}>
              Zapisz ustawienia
            </Button>
          </Group>

          <Paper withBorder p="md">
            <Title order={4} mb="sm">
              MCP
            </Title>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 8px', fontSize: 13 }}>
              <span style={{ color: 'var(--mz-muted)' }}>Adres</span>
              <code>{mcpUrl}</code>
              <span style={{ color: 'var(--mz-muted)' }}>Transport</span>
              <span>Streamable HTTP, bez sesji</span>
              <span style={{ color: 'var(--mz-muted)' }}>Plik konfiguracji</span>
              <code>{saved.configPath}</code>
            </div>
            <Text size="xs" c="dimmed" mt="sm" mb={4}>
              Konfiguracja dla Claude Code
            </Text>
            <Code block>{`claude mcp add --transport http moniuszko ${mcpUrl}`}</Code>
            {window.location.port === '5173' && (
              <Alert color="yellow" mt="sm">
                Klient działa na serwerze deweloperskim Vite (port 5173), który przekazuje /mcp do serwera aplikacji. Agent może
                też łączyć się bezpośrednio z serwerem: <code>http://localhost:{saved.port}/mcp</code>.
              </Alert>
            )}
            <Text size="xs" c="dimmed" mt="sm" mb={4}>
              Narzędzia udostępniane agentowi
            </Text>
            <Group gap={4}>
              {TOOLS.map((t) => (
                <Code key={t}>{t}</Code>
              ))}
            </Group>
          </Paper>
        </Stack>
      </main>

      <DirPickerModal
        opened={picking !== null}
        title={picking ? DIR_LABELS[picking] : ''}
        initial={picking ? draft[picking] : ''}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          if (picking) setDraft({ ...draft, [picking]: p });
          setPicking(null);
        }}
      />
    </div>
  );
}
