import { useEffect, useRef } from 'react';
import type { ServerEvent } from '@moniuszko/shared';

type Listener = (e: ServerEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connected = false;
const statusListeners = new Set<(connected: boolean) => void>();

function setConnected(value: boolean) {
  connected = value;
  statusListeners.forEach((fn) => fn(value));
}

/** Jedno połączenie SSE na kartę; EventSource sam wznawia połączenie po przerwie. */
function ensureSource() {
  if (source) return;
  source = new EventSource('/api/events');
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
  source.onmessage = (msg) => {
    let event: ServerEvent;
    try {
      event = JSON.parse(msg.data as string) as ServerEvent;
    } catch (e) {
      console.error('Niepoprawne zdarzenie serwera', msg.data, e);
      return;
    }
    listeners.forEach((fn) => fn(event));
  };
}

export function useServerEvents(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensureSource();
    const fn: Listener = (e) => ref.current(e);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
}

export function onConnectionChange(fn: (connected: boolean) => void): () => void {
  ensureSource();
  statusListeners.add(fn);
  fn(connected);
  return () => {
    statusListeners.delete(fn);
  };
}
