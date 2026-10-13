import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useSearchParams } from 'react-router';
import { Badge, Button, Chip, FileButton, Group, Loader, Select, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { FacetsDto, GraphicDto, TagStatus } from '@moniuszko/shared';
import { api } from '../api/client';
import { useServerEvents } from '../api/events';
import { notifyError } from '../notify';
import { GraphicDetails, STATUS_COLOR, STATUS_LABEL } from './GraphicDetails';
import { ImportModal } from './ImportModal';
import { useImport } from './useImport';

const NO_CATEGORY = '__none__';
type Sort = 'newest' | 'title' | 'recent-use' | 'relevance';

export function LibraryPage() {
  const [text, setText] = useState('');
  const [q] = useDebouncedValue(text, 250);
  const [tagStatus, setTagStatus] = useState<TagStatus | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('newest');
  const [items, setItems] = useState<GraphicDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<FacetsDto | null>(null);
  // ?g=<id> otwiera bibliotekę z zaznaczoną grafiką (link „Pokaż w bibliotece” z edytora).
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('g'));
  const [detailKey, setDetailKey] = useState(0);
  const [showAllTags, setShowAllTags] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [list, f] = await Promise.all([
        api.graphics({ q, tagStatus, category, tags, sort: q && sort === 'newest' ? 'relevance' : sort, limit: 500 }),
        api.facets(),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setFacets(f);
    } catch (e) {
      notifyError(e, 'Nie udało się wczytać biblioteki');
    }
  }, [q, tagStatus, category, tags, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useServerEvents((e) => {
    if (e.type === 'library-changed' || e.type === 'settings-changed') {
      void reload();
      if (selected && (e.type === 'settings-changed' || e.ids.includes(selected))) setDetailKey((k) => k + 1);
    }
  });

  const imp = useImport(reload);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => void imp.start(files),
    noClick: true,
    noKeyboard: true,
  });

  const categories = useMemo(() => (facets?.categories ?? []).flatMap((c) => (c.name ? [c.name] : [])), [facets]);
  const knownTags = useMemo(() => (facets?.tags ?? []).map((t) => t.name), [facets]);
  const visibleTags = showAllTags ? (facets?.tags ?? []) : (facets?.tags ?? []).slice(0, 15);

  return (
    <div className="mz-main" {...getRootProps()}>
      <input {...getInputProps()} />
      {isDragActive && <div className="mz-drop-overlay">Upuść pliki SVG, żeby dodać je do biblioteki</div>}

      <aside className="mz-side" style={{ padding: 14 }}>
        <div className="mz-section-title">Status metadanych</div>
        <div className={`mz-filter-row${!tagStatus ? ' active' : ''}`} onClick={() => setTagStatus(undefined)}>
          <span>Wszystkie</span>
          <span>{facets?.total ?? ''}</span>
        </div>
        {(['untagged', 'ai', 'reviewed'] as const).map((s) => (
          <div key={s} className={`mz-filter-row${tagStatus === s ? ' active' : ''}`} onClick={() => setTagStatus(s)}>
            <span>{{ untagged: 'Bez metadanych', ai: 'Otagowane przez AI', reviewed: 'Sprawdzone' }[s]}</span>
            <span>{facets?.tagStatus[s] ?? ''}</span>
          </div>
        ))}

        <div className="mz-section-title" style={{ marginTop: 18 }}>
          Kategoria
        </div>
        <div className={`mz-filter-row${!category ? ' active' : ''}`} onClick={() => setCategory(undefined)}>
          <span>Wszystkie</span>
          <span />
        </div>
        {(facets?.categories ?? []).map((c) => {
          const value = c.name ?? NO_CATEGORY;
          return (
            <div
              key={value}
              className={`mz-filter-row${category === value ? ' active' : ''}`}
              onClick={() => setCategory(category === value ? undefined : value)}
            >
              <span>{c.name ?? 'Bez kategorii'}</span>
              <span>{c.count}</span>
            </div>
          );
        })}

        <div className="mz-section-title" style={{ marginTop: 18 }}>
          Tagi
        </div>
        <Chip.Group multiple value={tags} onChange={setTags}>
          <Group gap={4}>
            {visibleTags.map((t) => (
              <Chip key={t.name} value={t.name} size="xs" variant="outline">
                {t.name} {t.count}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        {(facets?.tags.length ?? 0) > 15 && (
          <Button size="compact-xs" variant="subtle" mt={6} onClick={() => setShowAllTags((v) => !v)}>
            {showAllTags ? 'Mniej' : `+ ${(facets?.tags.length ?? 0) - 15}`}
          </Button>
        )}
      </aside>

      <main className="mz-content">
        <Group mb="md" gap="xs">
          <TextInput
            style={{ flex: 1, maxWidth: 520 }}
            placeholder="Szukaj w tytułach, opisach i tagach…"
            leftSection={<IconSearch size={16} />}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <Select
            w={180}
            value={sort}
            onChange={(v) => setSort((v as Sort | null) ?? 'newest')}
            data={[
              { value: 'newest', label: 'Najnowsze' },
              { value: 'title', label: 'Tytuł A–Z' },
              { value: 'recent-use', label: 'Ostatnio używane' },
            ]}
            allowDeselect={false}
          />
          <div style={{ flex: 1 }} />
          <FileButton onChange={(files) => void imp.start(files)} accept=".svg,image/svg+xml" multiple>
            {(props) => <Button {...props}>Dodaj pliki…</Button>}
          </FileButton>
        </Group>

        <div className="mz-drop-hint">
          <strong style={{ color: 'black' }}>Upuść pliki SVG w dowolnym miejscu tego ekranu</strong> — jeden lub wiele
          naraz. Pliki zostaną oczyszczone ze skryptów i dodane bez metadanych.
        </div>

        {items === null ? (
          <Loader />
        ) : items.length === 0 ? (
          <Text c="dimmed">{total === 0 && !q && !tagStatus && !category && tags.length === 0 ? 'Biblioteka jest pusta.' : 'Brak wyników.'}</Text>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {items.map((g) => (
              <div
                key={g.id}
                className={`mz-card${selected === g.id ? ' selected' : ''}`}
                onClick={() => setSelected(g.id)}
              >
                <div className="mz-card-thumb mz-checker">
                  <img src={api.thumbnailUrl(g)} alt={g.title} loading="lazy" />
                </div>
                <div style={{ padding: '8px 10px', borderTop: '1px solid var(--mz-line)' }}>
                  <Text size="sm" fw={600} truncate>
                    {g.title || g.sourceName}
                  </Text>
                  <Group justify="space-between" mt={4} wrap="nowrap">
                    <Text size="xs" c="dimmed" truncate>
                      {g.category ?? '—'}
                    </Text>
                    <Badge size="xs" color={STATUS_COLOR[g.tagStatus]} variant="light">
                      {g.tagStatus === 'ai' ? 'AI' : STATUS_LABEL[g.tagStatus]}
                    </Badge>
                  </Group>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <aside className="mz-side right">
        {selected ? (
          <GraphicDetails
            key={selected}
            id={selected}
            categories={categories}
            knownTags={knownTags}
            refreshKey={detailKey}
            onChanged={() => void reload()}
            onDeleted={() => {
              setSelected(null);
              void reload();
            }}
          />
        ) : (
          <Text c="dimmed" size="sm" p="md">
            Wybierz grafikę, żeby zobaczyć i zmienić jej metadane.
          </Text>
        )}
      </aside>

      <ImportModal
        rows={imp.rows}
        running={imp.running}
        opened={imp.open}
        onClose={() => imp.setOpen(false)}
        onForce={(key) => void imp.forceAdd(key).catch((e) => notifyError(e, 'Nie udało się dodać pliku'))}
        onSkip={imp.skip}
        onShowAdded={() => {
          imp.setOpen(false);
          setTagStatus('untagged');
          setCategory(undefined);
          setTags([]);
          setText('');
          setSort('newest');
        }}
      />
    </div>
  );
}
