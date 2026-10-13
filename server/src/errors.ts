import type { ErrorRequestHandler } from 'express';
import { CommandError, CompositionParseError, SceneOpError } from '@moniuszko/shared';
import { ZodError, z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `Nie znaleziono: ${what}`);
export const badRequest = (msg: string) => new HttpError(400, msg);

/** Błąd, który powinien trafić do klienta jako 400, a nie 500. */
export function isClientError(e: unknown): boolean {
  return e instanceof CommandError || e instanceof SceneOpError || e instanceof CompositionParseError || e instanceof ZodError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ZodError) return z.prettifyError(e);
  return e instanceof Error ? e.message : String(e);
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (isClientError(err)) {
    res.status(400).json({ error: errorMessage(err) });
    return;
  }
  console.error(err);
  res.status(500).json({ error: errorMessage(err) });
};
