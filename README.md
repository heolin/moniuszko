# Moniuszko

Biblioteka grafik SVG z metadanymi i edytor kompozycji, czyli pojedynczych plików SVG
złożonych z grafik z biblioteki, tekstów i prostych kształtów. Agent AI ma dostęp do
biblioteki i kompozycji przez MCP. Plan i decyzje projektowe są w [docs/PLAN.md](docs/PLAN.md),
a makiety w [docs/mockups/](docs/mockups/index.html).

## Wymagania

Node 22 i npm 10.

## Uruchomienie

```bash
npm install
cp moniuszko.config.example.json moniuszko.config.json   # opcjonalnie; bez pliku zostanie utworzony
npm run dev
```

`npm run dev` uruchamia trzy procesy: kompilację pakietu `shared` w trybie watch, serwer
(port 4400) i serwer deweloperski Vite (port 5173, przekazuje `/api` i `/mcp` do serwera).
Aplikacja jest pod <http://localhost:5173>.

Wersja produkcyjna:

```bash
npm run build
npm start          # serwer pod http://localhost:4400 podaje też zbudowanego klienta
```

## Konfiguracja

`moniuszko.config.json` (ścieżki względne liczą się od folderu tego pliku):

| Pole | Domyślnie | Opis |
|---|---|---|
| `workspace` | `./workspace` | baza `moniuszko.db`, miniatury, domyślne podfoldery |
| `libraryDir` | `<workspace>/library` | pliki grafik i `originals/` |
| `compositionsDir` | `<workspace>/compositions` | pliki kompozycji (`<id>.svg`) |
| `exportsDir` | `<workspace>/exports` | domyślny folder eksportu |
| `port` | `4400` | port serwera |
| `normalizeSvg` | `true` | normalizacja svgo przy imporcie |
| `warnDuplicates` | `true` | wykrywanie duplikatów przy imporcie |

Foldery można też zmienić w aplikacji na ekranie Ustawienia.

## MCP

Serwer MCP działa pod `/mcp` (Streamable HTTP, bez sesji). Dla Claude Code:

```bash
claude mcp add --transport http moniuszko http://localhost:4400/mcp
```

Narzędzia: `search_graphics`, `get_graphic`, `add_graphic`, `update_graphic_metadata`,
`list_untagged`, `get_library_overview`, `list_compositions`, `get_composition`,
`create_composition`, `apply_scene_ops`. Opis operacji sceny jest w opisie narzędzia
`apply_scene_ops` i w `shared/src/scene/ops.ts`.

## Testy

```bash
npm run typecheck
npm test            # vitest: shared, server, client
npm run test:e2e    # build, potem Playwright (Chrome z systemu, channel: 'chrome')
```

Testy e2e uruchamiają aplikację w procesie testu na losowym porcie 127.0.0.1 i świeżym
workspace w katalogu tymczasowym; po każdym teście serwer jest zamykany. Zmienna
`SHOTS_DIR` zapisuje zrzuty ekranów z kolejnych kroków.

## Układ repozytorium

- `shared/` — model sceny, komendy, zapis i odczyt pliku kompozycji, operacje sceny MCP, kształty.
- `server/` — Express, SQLite + Drizzle (migracje w `server/drizzle/`), import grafik, kompozycje, eksport, MCP, SSE.
- `client/` — React + Mantine: biblioteka, kompozycje, edytor (Moveable + Selecto), ustawienia.
- `e2e/` — testy Playwright.
- `samples/` — przykładowe grafiki do testów i ręcznego sprawdzania.
