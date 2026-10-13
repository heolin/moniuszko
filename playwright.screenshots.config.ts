import { defineConfig } from '@playwright/test';

// Generowanie zrzutów ekranów do dokumentacji (docs/images). Uruchamiane przez
// `npm run screenshots`; wymaga zbudowanego klienta i serwera.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'screenshots.ts',
  timeout: 120_000,
  workers: 1,
  use: {
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
});
