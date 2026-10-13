import type { Response } from 'express';
import type { ServerEvent } from '@moniuszko/shared';

/** Rozsyła zdarzenia serwera do przeglądarek przez Server-Sent Events. */
export class EventBus {
  private clients = new Set<Response>();
  private listeners = new Set<(e: ServerEvent) => void>();

  attach(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  /** Dla testów i dla kodu serwera, który reaguje na zdarzenia. */
  subscribe(fn: (e: ServerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: ServerEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) res.write(data);
    for (const fn of this.listeners) fn(event);
  }
}
