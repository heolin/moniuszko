import { defineConfig } from '@playwright/test';

// Testy e2e nie uruchamiają serwera: aplikacja Express działa w procesie testu, a przeglądarka
// dostaje odpowiedzi przez page.route (zob. e2e/harness.ts). Wymagają zbudowanego klienta
// i serwera (npm run build).
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  use: {
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  },
});
