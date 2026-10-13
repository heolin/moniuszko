import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Testy używają źródeł pakietu shared, żeby nie wymagały wcześniejszego buildu.
    alias: { '@moniuszko/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  test: {
    testTimeout: 30_000,
  },
});
