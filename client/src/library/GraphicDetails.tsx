import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Autocomplete,
  Badge,
  Button,
  Code,
  FileButton,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { modalsConfirm } from '../confirm';
import type { GraphicDetailDto, GraphicMetadataPatch, TagStatus } from '@moniuszko/shared';
import { api } from '../api/client';
import { notifyError, notifyOk } from '../notify';

export const STATUS_LABEL: Record<TagStatus, string> = {
  untagged: 'bez metadanych',
  ai: 'otagowana przez AI',
  reviewed: 'sprawdzona',
};

export const STATUS_COLOR: Record<TagStatus, string> = {
  untagged: 'yellow',
  ai: 'violet',
  reviewed: 'green',
};

type Props = {
  id: string;
  categories: string[];
  knownTags: string[];
  /** Licznik zmian z serwera; jego zmiana powoduje ponowne pobranie szczegółów. */
  refreshKey: number;
  onChanged: () => void;
  onDeleted: () => void;
};

type Form = { title: string; description: string; category: string; tags: string[] };

export function GraphicDetails({ id, categories, knownTags, refreshKey, onChanged, onDeleted }: Props) {
  const [g, setG] = useState<GraphicDetailDto | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .graphic(id)
      .then((data) => {
        if (cancelled) return;
        setG(data);
        setForm({ title: data.title, description: data.description, category: data.category ?? '', tags: data.tags });
      })
      .catch((e) => notifyError(e, 'Nie udało się wczytać grafiki'));
    return () => {
      cancelled = true;
    };
  }, [id, refreshKey]);

  if (!g || !form) return <Loader m="md" />;

  const dirty =
    form.title !== g.title ||
    form.description !== g.description ||
    form.category !== (g.category ?? '') ||
    form.tags.join('\n') !== g.tags.join('\n');

  async function save(extra: GraphicMetadataPatch = {}) {
    if (!form) throw new Error('Formularz nie jest wczytany');
    setSaving(true);
    try {
      const updated = await api.updateGraphic(id, {
        title: form.title,
        description: form.description,
        category: form.category.trim() || null,
        tags: form.tags,
        ...extra,
      });
      setG((prev) => (prev ? { ...prev, ...updated } : prev));
      setForm({ title: updated.title, description: updated.description, category: updated.category ?? '', tags: updated.tags });
      onChanged();
    } catch (e) {
      notifyError(e, 'Nie udało się zapisać metadanych');
    } finally {
      setSaving(false);
    }
  }

  async function replace(file: File | null) {
    if (!file) return;
    try {
      const r = await api.replaceGraphicFile(id, file);
      notifyOk(`Podmieniono plik; wersja ${r.graphic.version}${r.warnings.length ? ` (${r.warnings.join('; ')})` : ''}`);
      onChanged();
    } catch (e) {
      notifyError(e, 'Nie udało się podmienić pliku');
    }
  }

  async function remove() {
    if (!g) return;
    const used = g.usedIn.length ? ` Grafika jest użyta w ${g.usedIn.length} kompozycjach; kopie w nich zostaną.` : '';
    if (!(await modalsConfirm(`Usunąć grafikę „${g.title}”?${used}`))) return;
    try {
      await api.deleteGraphic(id);
      onDeleted();
    } catch (e) {
      notifyError(e, 'Nie udało się usunąć grafiki');
    }
  }

  async function showOriginal() {
    try {
      setOriginal(await api.graphicOriginal(id));
    } catch (e) {
      notifyError(e, 'Nie udało się wczytać oryginału');
    }
  }

  return (
    <Stack gap={6} p="md">
      <div className="mz-checker" style={{ border: '1px solid var(--mz-line)', borderRadius: 8, aspectRatio: '1', padding: 20 }}>
        {/* <img> nie wykonuje skryptów z SVG; plik i tak przeszedł sanityzację. */}
        <img src={api.svgUrl(g)} alt={g.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <Group justify="space-between" wrap="nowrap" mt={4}>
        <Text fw={600} truncate>
          {g.title}
        </Text>
        <Badge color={STATUS_COLOR[g.tagStatus]} variant="light" style={{ flex: 'none' }}>
          {STATUS_LABEL[g.tagStatus]}
        </Badge>
      </Group>

      <TextInput label="Tytuł" value={form.title} onChange={(e) => setForm({ ...form, title: e.currentTarget.value })} />
      <Textarea
        label="Opis"
        autosize
        minRows={3}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
      />
      <Autocomplete
        label="Kategoria"
        data={categories}
        value={form.category}
        onChange={(v) => setForm({ ...form, category: v })}
      />
      <TagsInput
        label="Tagi"
        data={knownTags}
        value={form.tags}
        onChange={(tags) => setForm({ ...form, tags })}
        placeholder="Dodaj tag…"
        clearable
      />

      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '4px 8px', fontSize: 12, marginTop: 8 }}>
        <span style={{ color: 'var(--mz-muted)' }}>Kolory</span>
        <span>
          {g.colors.map((c) => (
            <span
              key={c}
              title={c}
              style={{
                display: 'inline-block',
                width: 18,
                height: 18,
                borderRadius: 4,
                border: '1px solid var(--mz-line)',
                marginRight: 4,
                verticalAlign: 'middle',
                background: c,
              }}
            />
          ))}
        </span>
        <span style={{ color: 'var(--mz-muted)' }}>Wymiary</span>
        <span>
          {g.width} × {g.height} (viewBox {g.viewBox})
        </span>
        <span style={{ color: 'var(--mz-muted)' }}>Źródło</span>
        <span>{g.sourceName ?? '—'}</span>
        <span style={{ color: 'var(--mz-muted)' }}>Wersja</span>
        <span>{g.version}</span>
        <span style={{ color: 'var(--mz-muted)' }}>Dodano</span>
        <span>{new Date(g.createdAt).toLocaleDateString('pl-PL')}</span>
        <span style={{ color: 'var(--mz-muted)' }}>Użyta w</span>
        <span>
          {g.usedIn.length === 0
            ? '—'
            : g.usedIn.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <Link to={`/compositions/${c.id}`}>{c.name}</Link>
                </span>
              ))}
        </span>
      </div>

      <Group gap={6} mt="sm">
        {g.tagStatus !== 'reviewed' && (
          <Button size="xs" loading={saving} onClick={() => save({ tagStatus: 'reviewed' })}>
            Oznacz jako sprawdzoną
          </Button>
        )}
        <Button size="xs" variant="default" loading={saving} disabled={!dirty} onClick={() => save()}>
          Zapisz
        </Button>
        <Button size="xs" variant="default" component="a" href={`/api/graphics/${g.id}/download`}>
          Pobierz SVG
        </Button>
        <Button size="xs" variant="default" onClick={showOriginal}>
          Pokaż oryginał
        </Button>
        <FileButton onChange={replace} accept=".svg,image/svg+xml">
          {(props) => (
            <Button size="xs" variant="default" {...props}>
              Zastąp plik…
            </Button>
          )}
        </FileButton>
        <Button size="xs" variant="subtle" color="red" onClick={remove}>
          Usuń
        </Button>
      </Group>

      <Modal opened={original !== null} onClose={() => setOriginal(null)} title="Oryginalny plik (przed sanityzacją)" size="xl">
        <ScrollArea h={500}>
          <Code block>{original}</Code>
        </ScrollArea>
      </Modal>
    </Stack>
  );
}
