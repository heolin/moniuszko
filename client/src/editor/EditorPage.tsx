import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Alert, Button, CloseButton, Loader, Tabs } from '@mantine/core';
import { api, ApiError, CLIENT_ID } from '../api/client';
import { useServerEvents } from '../api/events';
import { notifyError } from '../notify';
import { handleKeyDown } from './actions';
import { Canvas } from './Canvas';
import { ExportModal } from './ExportModal';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';
import { LibraryPanel } from './LibraryPanel';
import { clearMeasureCache } from './measure';
import { currentSvg, undo, useEditor } from './store';
import { Toolbar } from './Toolbar';

const AUTOSAVE_MS = 1500;

function isField(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** Zapis bieżącego dokumentu. Jeden naraz; kolejny zapis czeka na zakończenie poprzedniego. */
let saving: Promise<void> | null = null;

export async function saveNow(): Promise<void> {
  if (saving) await saving;
  const s = useEditor.getState();
  if (!s.id || s.gesture || s.saveState === 'conflict') return;
  const svg = currentSvg();
  if (!svg || svg === s.savedSvg) {
    if (s.saveState === 'dirty') useEditor.setState({ saveState: 'saved' });
    return;
  }
  const id = s.id;
  s.markSaving();
  saving = (async () => {
    try {
      const dto = await api.saveComposition(id, svg, s.revision);
      if (useEditor.getState().id === id) useEditor.getState().markSaved(svg, dto.revision);
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 409;
      useEditor.getState().markSaveError(e instanceof Error ? e.message : String(e), conflict);
      if (conflict) useEditor.getState().setNotice({ kind: 'conflict', source: 'agent' });
      else notifyError(e, 'Nie udało się zapisać kompozycji');
    } finally {
      saving = null;
    }
  })();
  await saving;
}

async function reloadFromServer(source: 'agent' | 'ui') {
  const id = useEditor.getState().id;
  if (!id) return;
  const dto = await api.composition(id);
  useEditor.getState().applyRemote(dto.svg, dto.revision, source);
}

/** „Zachowaj moją wersję”: zapis bieżącej treści na wersję, która jest teraz na serwerze. */
async function overwriteServer() {
  const id = useEditor.getState().id;
  if (!id) return;
  const dto = await api.composition(id);
  useEditor.setState({ revision: dto.revision, saveState: 'dirty', notice: null });
  await saveNow();
}

function Notice() {
  const notice = useEditor((s) => s.notice);
  if (!notice) return null;
  const close = () => useEditor.getState().setNotice(null);
  if (notice.kind === 'remote-change') {
    const who = notice.source === 'agent' ? 'Agent zmienił' : 'W innym oknie zmieniono';
    return (
      <div className="mz-notice">
        <span>
          {who} tę kompozycję o {notice.at}
          {notice.changed.length ? ` (${notice.changed.length} obiektów)` : ''}.
        </span>
        {notice.changed.length > 0 && (
          <Button
            size="compact-xs"
            variant="white"
            onClick={() => {
              useEditor.getState().setHighlight(notice.changed);
              setTimeout(() => useEditor.getState().setHighlight([]), 4000);
            }}
          >
            Pokaż zmiany
          </Button>
        )}
        <Button
          size="compact-xs"
          variant="white"
          onClick={() => {
            undo();
            close();
          }}
        >
          Cofnij te zmiany
        </Button>
        <CloseButton size="sm" onClick={close} aria-label="Zamknij" />
      </div>
    );
  }
  return (
    <div className="mz-notice" style={{ background: '#fbf0d2', color: '#9a6a00', borderColor: '#ecd9a0' }}>
      <span>Kompozycja zmieniła się na serwerze, a w edytorze są niezapisane zmiany.</span>
      <Button size="compact-xs" variant="white" onClick={() => reloadFromServer('agent').catch((e) => notifyError(e, 'Nie udało się wczytać'))}>
        Wczytaj wersję z serwera
      </Button>
      <Button size="compact-xs" variant="white" onClick={() => overwriteServer().catch((e) => notifyError(e, 'Nie udało się zapisać'))}>
        Zachowaj moją wersję
      </Button>
    </div>
  );
}

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const loaded = useEditor((s) => s.id === id && s.scene !== null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<string | null>('layers');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wczytanie kompozycji.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setError(null);
    useEditor.getState().reset();
    api
      .composition(id)
      .then((dto) => {
        if (!cancelled) useEditor.getState().load(dto.id, dto.svg, dto.revision);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      // Wyjście z edytora: zapis niezapisanych zmian.
      void saveNow().finally(() => useEditor.getState().reset());
    };
  }, [id]);

  // Po wczytaniu fontów zmieniają się wymiary tekstów.
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      clearMeasureCache();
      const s = useEditor.getState();
      if (s.scene) useEditor.setState({ scene: { ...s.scene } });
    });
  }, []);

  // Zapis automatyczny po chwili bez zmian.
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        // saveState też: cofnięcie zmienia scenę, a stan „zmieniona” ustawia osobno (afterHistoryJump).
        if (
          s.scene === prev.scene &&
          s.meta === prev.meta &&
          s.gesture === prev.gesture &&
          s.editingTextId === prev.editingTextId &&
          s.saveState === prev.saveState
        )
          return;
        if (timer.current) clearTimeout(timer.current);
        if (s.saveState !== 'dirty' || s.gesture || s.editingTextId) return;
        timer.current = setTimeout(() => void saveNow(), AUTOSAVE_MS);
      }),
    [],
  );

  // Ostrzeżenie przy zamykaniu karty z niezapisanymi zmianami.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState().saveState;
      if (s === 'dirty' || s === 'saving' || s === 'conflict') e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Skróty klawiszowe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isField(e.target)) return;
      if (useEditor.getState().editingTextId) {
        // Pole edycji tekstu bez fokusu: Escape zamyka je bez zapisu, inne klawisze są pomijane.
        if (e.key === 'Escape') useEditor.getState().setEditingText(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      try {
        if (handleKeyDown(e)) e.preventDefault();
      } catch (err) {
        e.preventDefault();
        notifyError(err, 'Nie udało się wykonać polecenia');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Zmiany z serwera (agent przez MCP, inna karta).
  useServerEvents((e) => {
    const s = useEditor.getState();
    if (!s.id) return;
    if (e.type === 'composition-deleted' && e.id === s.id) {
      notifyError(new Error('Kompozycja została usunięta'), 'Kompozycja usunięta');
      navigate('/compositions');
      return;
    }
    if (e.type !== 'composition-changed' || e.id !== s.id) return;
    if (e.clientId === CLIENT_ID || e.revision === s.revision) return;
    if (s.saveState === 'saved') {
      reloadFromServer(e.source).catch((err) => notifyError(err, 'Nie udało się wczytać zmian z serwera'));
    } else {
      useEditor.getState().setNotice({ kind: 'conflict', source: e.source });
    }
  });

  const onSave = useCallback(() => void saveNow(), []);

  if (error) {
    return (
      <div className="mz-content">
        <Alert color="red" title="Nie udało się otworzyć kompozycji">
          {error}
        </Alert>
      </div>
    );
  }
  if (!loaded) return <Loader m="xl" />;

  return (
    <>
      <Toolbar onSave={onSave} onExport={() => setExporting(true)} />
      <div className="mz-main">
        <aside className="mz-side">
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List grow>
              <Tabs.Tab value="layers">Warstwy</Tabs.Tab>
              <Tabs.Tab value="library">Biblioteka</Tabs.Tab>
            </Tabs.List>
            <div style={{ padding: 12 }}>
              {tab === 'layers' && <LayersPanel />}
              {tab === 'library' && <LibraryPanel />}
            </div>
          </Tabs>
        </aside>
        <div style={{ flex: 1, position: 'relative', display: 'flex', minWidth: 0 }}>
          <Notice />
          <Canvas />
        </div>
        <aside className="mz-side right">
          <Inspector />
        </aside>
      </div>
      <ExportModal opened={exporting} onClose={() => setExporting(false)} beforeExport={saveNow} />
    </>
  );
}
