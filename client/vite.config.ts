import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const SERVER = 'http://localhost:4400';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Klient korzysta ze źródeł pakietu shared; Vite kompiluje je razem z aplikacją.
    alias: { '@moniuszko/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/mcp': SERVER,
    },
  },
  test: {
    environment: 'jsdom',
  },
});
