import { useCallback, useState } from 'react';
import type { ImportItemResult } from '@moniuszko/shared';
import { api } from '../api/client';

export type ImportRow = { key: string; file: File; result: ImportItemResult | null; error?: string };

const BATCH = 8;

/** Import plików partiami, żeby okno importu pokazywało postęp. */
export function useImport(onDone: () => void) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);

  const start = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const fresh: ImportRow[] = files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, result: null }));
      setRows(fresh);
      setOpen(true);
      setRunning(true);
      for (let i = 0; i < fresh.length; i += BATCH) {
        const batch = fresh.slice(i, i + BATCH);
        try {
          const results = await api.importGraphics(batch.map((r) => r.file));
          setRows((prev) =>
            prev.map((row) => {
              const idx = batch.findIndex((b) => b.key === row.key);
              return idx >= 0 ? { ...row, result: results[idx] ?? null } : row;
            }),
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setRows((prev) => prev.map((row) => (batch.some((b) => b.key === row.key) ? { ...row, error: message } : row)));
        }
      }
      setRunning(false);
      onDone();
    },
    [onDone],
  );

  /** „Dodaj mimo to” dla pliku rozpoznanego jako duplikat. */
  const forceAdd = useCallback(
    async (key: string) => {
      const row = rows.find((r) => r.key === key);
      if (!row) throw new Error(`Nie ma wiersza importu ${key}`);
      const [result] = await api.importGraphics([row.file], true);
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, result: result ?? null } : r)));
      onDone();
    },
    [rows, onDone],
  );

  const skip = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  return { rows, running, open, setOpen, start, forceAdd, skip };
}
