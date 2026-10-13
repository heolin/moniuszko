import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ActionIcon, Alert, Badge, Button, Group, Loader, Menu, Modal, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconDots, IconSearch } from '@tabler/icons-react';
import type { CompositionDto } from '@moniuszko/shared';
import { api } from '../api/client';
import { useServerEvents } from '../api/events';
import { modalsConfirm } from '../confirm';
import { notifyError } from '../notify';

type Filter = 'all' | 'agent-drafts' | 'mine';

const PRESETS: Record<string, [number, number] | null> = {
  '1600x900': [1600, 900],
  '1920x1080': [1920, 1080],
  '1080x1080': [1080, 1080],
  a4: [794, 1123],
  custom: null,
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'przed chwilą';
  if (diff < 3600) return `${Math.floor(diff / 60)} min temu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} godz. temu`;
  return new Date(iso).toLocaleDateString('pl-PL');
}

function NewCompositionModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('Bez tytułu');
  const [preset, setPreset] = useState('1600x900');
  const [size, setSize] = useState<[number, number]>([1600, 900]);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const c = await api.createComposition({ name, width: size[0], height: size[1] });
      onClose();
      navigate(`/compositions/${c.id}`);
    } catch (e) {
      notifyError(e, 'Nie udało się utworzyć kompozycji');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Nowa kompozycja">
      <Stack gap="sm">
        <TextInput label="Nazwa" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <Select
          label="Rozmiar płótna"
          value={preset}
          allowDeselect={false}
          onChange={(v) => {
            const key = v ?? '1600x900';
            setPreset(key);
            const s = PRESETS[key];
            if (s) setSize(s);
          }}
          data={[
            { value: '1600x900', label: '1600 × 900 (16:9)' },
            { value: '1920x1080', label: '1920 × 1080 (16:9)' },
            { value: '1080x1080', label: '1080 × 1080 (kwadrat)' },
            { value: 'a4', label: 'A4 pion (794 × 1123)' },
            { value: 'custom', label: 'własny…' },
          ]}
        />
        {preset === 'custom' && (
          <Group grow>
            <NumberInput label="Szerokość" min={1} value={size[0]} onChange={(v) => setSize([Number(v) || 1, size[1]])} />
            <NumberInput label="Wysokość" min={1} value={size[1]} onChange={(v) => setSize([size[0], Number(v) || 1])} />
          </Group>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={create} loading={busy} disabled={!name.trim()}>
            Utwórz
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function CompositionsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CompositionDto[] | null>(null);
  const [broken, setBroken] = useState<{ file: string; error: string }[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<CompositionDto | null>(null);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async () => {
    try {
      const r = await api.compositions();
      setItems(r.items);
      setBroken(r.broken);
    } catch (e) {
      notifyError(e, 'Nie udało się wczytać kompozycji');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useServerEvents((e) => {
    if (e.type === 'composition-changed' || e.type === 'composition-deleted' || e.type === 'settings-changed') void reload();
  });

  const agentDrafts = (items ?? []).filter((c) => c.author === 'agent' && c.status === 'draft');
  const visible = useMemo(() => {
    let list = items ?? [];
    if (filter === 'agent-drafts') list = list.filter((c) => c.author === 'agent' && c.status === 'draft');
    if (filter === 'mine') list = list.filter((c) => c.author === 'human');
    const s = search.trim().toLowerCase();
    if (s) list = list.filter((c) => c.name.toLowerCase().includes(s));
    return [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'pl') : b.updatedAt.localeCompare(a.updatedAt)));
  }, [items, filter, search, sort]);

  async function act(fn: () => Promise<unknown>, what: string) {
    try {
      await fn();
      await reload();
    } catch (e) {
      notifyError(e, what);
    }
  }

  return (
    <div className="mz-main">
      <aside className="mz-side" style={{ padding: 14 }}>
        <div className="mz-section-title">Pokaż</div>
        {(
          [
            ['all', 'Wszystkie', items?.length],
            ['agent-drafts', 'Szkice agenta do przejrzenia', agentDrafts.length],
            ['mine', 'Moje', items?.filter((c) => c.author === 'human').length],
          ] as const
        ).map(([key, label, n]) => (
          <div key={key} className={`mz-filter-row${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
            <span>{label}</span>
            <span>{n ?? ''}</span>
          </div>
        ))}
      </aside>

      <main className="mz-content">
        <Group mb="md" gap="xs">
          <TextInput
            style={{ flex: 1, maxWidth: 520 }}
            placeholder="Szukaj kompozycji…"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Select
            w={190}
            value={sort}
            allowDeselect={false}
            onChange={(v) => setSort(v === 'name' ? 'name' : 'updated')}
            data={[
              { value: 'updated', label: 'Ostatnio zmieniane' },
              { value: 'name', label: 'Nazwa A–Z' },
            ]}
          />
          <div style={{ flex: 1 }} />
          <Button onClick={() => setCreating(true)}>Nowa kompozycja</Button>
        </Group>

        {broken.length > 0 && (
          <Alert color="red" title="Nie udało się odczytać plików kompozycji" mb="md">
            {broken.map((b) => (
              <div key={b.file} style={{ fontSize: 13 }}>
                <code>{b.file}</code>: {b.error}
              </div>
            ))}
          </Alert>
        )}

        {items === null ? (
          <Loader />
        ) : visible.length === 0 ? (
          <Text c="dimmed">{items.length === 0 ? 'Nie ma jeszcze kompozycji.' : 'Brak wyników.'}</Text>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {visible.map((c) => (
              <div key={c.id} className="mz-card" onClick={() => navigate(`/compositions/${c.id}`)}>
                <div className="mz-checker" style={{ aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={api.compositionThumbUrl(c)}
                    alt={c.name}
                    loading="lazy"
                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                  />
                </div>
                <div style={{ padding: '8px 10px', borderTop: '1px solid var(--mz-line)' }}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={600} truncate>
                      {c.name}
                    </Text>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" size="sm" onClick={(e) => e.stopPropagation()} aria-label="Więcej">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                        <Menu.Item onClick={() => navigate(`/compositions/${c.id}`)}>Otwórz</Menu.Item>
                        <Menu.Item
                          onClick={() => {
                            setRenaming(c);
                            setNewName(c.name);
                          }}
                        >
                          Zmień nazwę
                        </Menu.Item>
                        <Menu.Item onClick={() => void act(() => api.duplicateComposition(c.id), 'Nie udało się zduplikować')}>
                          Duplikuj
                        </Menu.Item>
                        <Menu.Item component="a" href={`/api/compositions/${c.id}/download`}>
                          Pobierz SVG
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          onClick={async () => {
                            if (await modalsConfirm(`Usunąć kompozycję „${c.name}” razem z plikiem?`)) {
                              await act(() => api.deleteComposition(c.id), 'Nie udało się usunąć');
                            }
                          }}
                        >
                          Usuń
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                  <Group justify="space-between" mt={4} wrap="nowrap">
                    <Text size="xs" c="dimmed" truncate>
                      {c.width} × {c.height} · {c.author === 'agent' ? 'agent, ' : 'zmieniono '}
                      {timeAgo(c.updatedAt)}
                    </Text>
                    {c.author === 'agent' && c.status === 'draft' ? (
                      <Badge size="xs" color="violet" variant="light" style={{ flexShrink: 0 }}>
                        szkic agenta
                      </Badge>
                    ) : c.author === 'agent' ? (
                      <Badge size="xs" color="green" variant="light" style={{ flexShrink: 0 }}>
                        agent, przejrzana
                      </Badge>
                    ) : (
                      <Badge size="xs" color="green" variant="light" style={{ flexShrink: 0 }}>
                        moja
                      </Badge>
                    )}
                  </Group>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <NewCompositionModal opened={creating} onClose={() => setCreating(false)} />

      <Modal opened={renaming !== null} onClose={() => setRenaming(null)} title="Zmień nazwę">
        <Stack gap="sm">
          <TextInput value={newName} onChange={(e) => setNewName(e.currentTarget.value)} data-autofocus />
          <Text size="xs" c="dimmed">
            Nazwa pliku ({renaming?.id}.svg) się nie zmienia.
          </Text>
          <Group justify="flex-end">
            <Button
              disabled={!newName.trim()}
              onClick={() => {
                const target = renaming;
                setRenaming(null);
                if (target) void act(() => api.patchComposition(target.id, { name: newName }), 'Nie udało się zmienić nazwy');
              }}
            >
              Zapisz
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
