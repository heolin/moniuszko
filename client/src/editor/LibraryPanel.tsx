import { useEffect, useState } from 'react';
import { Loader, Select, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import type { FacetsDto, GraphicDto } from '@moniuszko/shared';
import { api } from '../api/client';
import { useServerEvents } from '../api/events';
import { notifyError } from '../notify';
import { GRAPHIC_MIME } from './Canvas';
import { insertGraphic } from './insert';
import { useEditor } from './store';

/** Siatka grafik do wyboru; używana w panelu edytora i w oknie „Zamień na inną grafikę”. */
export function GraphicPicker({ onPick, draggable }: { onPick: (g: GraphicDto) => void; draggable: boolean }) {
  const [text, setText] = useState('');
  const [q] = useDebouncedValue(text, 250);
  const [category, setCategory] = useState<string | null>(null);
  const [items, setItems] = useState<GraphicDto[] | null>(null);
  const [facets, setFacets] = useState<FacetsDto | null>(null);
  const [version, setVersion] = useState(0);

  useServerEvents((e) => {
    if (e.type === 'library-changed') setVersion((v) => v + 1);
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.graphics({ q, category: category ?? undefined, limit: 300 }), api.facets()])
      .then(([list, f]) => {
        if (cancelled) return;
        setItems(list.items);
        setFacets(f);
      })
      .catch((e) => notifyError(e, 'Nie udało się wczytać biblioteki'));
    return () => {
      cancelled = true;
    };
  }, [q, category, version]);

  return (
    <div>
      <TextInput
        size="xs"
        placeholder="Szukaj grafik…"
        leftSection={<IconSearch size={14} />}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        mb={6}
      />
      <Select
        size="xs"
        placeholder="Wszystkie kategorie"
        clearable
        value={category}
        onChange={setCategory}
        data={(facets?.categories ?? []).flatMap((c) => (c.name ? [{ value: c.name, label: `${c.name} (${c.count})` }] : []))}
        mb={10}
      />
      {items === null ? (
        <Loader size="sm" />
      ) : items.length === 0 ? (
        <Text size="xs" c="dimmed">
          Brak grafik.
        </Text>
      ) : (
        <div className="mz-mini-grid">
          {items.map((g) => (
            <div
              key={g.id}
              title={g.title}
              draggable={draggable}
              onDragStart={(e) => {
                e.dataTransfer.setData(GRAPHIC_MIME, g.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDoubleClick={() => onPick(g)}
              onClick={draggable ? undefined : () => onPick(g)}
            >
              <img src={api.thumbnailUrl(g)} alt={g.title} loading="lazy" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LibraryPanel() {
  const layerName = useEditor((s) => {
    if (s.enteredGroup) return 'wnętrze zaznaczonej grupy';
    return s.scene?.layers.find((l) => l.id === s.activeLayerId)?.name ?? '—';
  });
  return (
    <div>
      <GraphicPicker
        draggable
        onPick={(g) => {
          insertGraphic(g.id).catch((e) => notifyError(e, 'Nie udało się wstawić grafiki'));
        }}
      />
      <Text size="xs" c="dimmed" mt="sm">
        Przeciągnij grafikę na płótno albo kliknij dwukrotnie, żeby wstawić ją na środku. Nowe obiekty trafiają do: {layerName}.
      </Text>
    </div>
  );
}
