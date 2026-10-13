# Rozwój

## Uruchomienie w trybie deweloperskim

```bash
npm install
npm run dev
```

`npm run dev` buduje pakiet `shared`, a potem uruchamia trzy procesy:

| Proces | Co robi |
|---|---|
| `shared` | `tsc --watch`; serwer korzysta ze zbudowanego `shared/dist` |
| `server` | `tsx watch` na porcie 4400, konfiguracja z `moniuszko.config.json` |
| `client` | Vite na porcie 5173; `/api` i `/mcp` przekazuje do serwera |

Aplikacja: <http://localhost:5173>. Plik konfiguracji opisuje [README](../README.md);
domyślny workspace to `./workspace` (w `.gitignore`).

Do ręcznego sprawdzania przydają się grafiki z `samples/`: upuść je na ekran Biblioteka.
Te same grafiki, ich metadane (`samples/library.json`) i przykładową kompozycję
(`samples/composition.json`) wczytuje w testach funkcja `loadSamples` z
`server/src/samples.ts`.

## Struktura

```
shared/   model sceny, komendy, zapis i odczyt pliku kompozycji, operacje MCP, kształty
server/   Express, SQLite + Drizzle, import grafik, kompozycje, eksport, MCP, SSE
client/   React + Mantine; edytor na natywnym SVG z Moveable i Selecto
e2e/      Playwright: testy i skrypt zrzutów ekranów
samples/  przykładowe grafiki, ich metadane i przykładowa kompozycja
docs/     dokumentacja, makiety, zrzuty ekranów (docs/images)
```

### shared

| Plik | Zawartość |
|---|---|
| `scene/types.ts` | typy sceny: `Scene`, `Layer`, węzły `asset`, `text`, `shape`, `group` |
| `scene/commands.ts` | **wszystkie zmiany sceny**: czyste funkcje `(scene, …) → scene` |
| `scene/serialize.ts`, `scene/parse.ts` | plik kompozycji ↔ scena; wzajemnie odwrotne |
| `scene/ops.ts` | operacje MCP (`apply_scene_ops`): schemat zod i tłumaczenie na komendy |
| `scene/matrix.ts`, `scene/bounds.ts`, `scene/tree.ts` | macierze transformacji, granice, przeszukiwanie drzewa |
| `scene/shapes.ts` | geometria i element SVG kształtów |
| `svg/assetSvg.ts` | przygotowanie grafiki do wklejenia (wymiary, prefiksy identyfikatorów) |
| `api.ts` | typy wymieniane przez REST, SSE i MCP |

Klient importuje `shared` ze źródeł (alias w `vite.config.ts`), serwer ze zbudowanego
`shared/dist`. Typy w obu przypadkach pochodzą ze źródeł.

### server

| Plik | Zawartość |
|---|---|
| `context.ts` | `AppContext`: konfiguracja, otwarty workspace, usługi; zmiana ustawień otwiera nowy workspace |
| `library/` | import (sanityzacja DOMPurify, svgo, kolory, miniatury), repozytorium z FTS5 |
| `compositions/` | indeks odtwarzany z plików, zapis z kontrolą rewizji (409), eksport |
| `mcp/` | narzędzia MCP i opis sceny dla agenta |
| `routes/` | REST API |
| `events.ts` | SSE: `composition-changed`, `library-changed`, … |
| `samples.ts` | wczytanie danych przykładowych |

### client

| Plik | Zawartość |
|---|---|
| `editor/store.ts` | stan edytora (zustand) z historią (zundo); gesty jako jeden wpis historii |
| `editor/actions.ts` | rejestr akcji: pasek narzędzi, skróty klawiszowe, inspektor |
| `editor/Canvas.tsx` | płótno, Moveable i Selecto, zoom, przewijanie, upuszczanie z panelu |
| `editor/SceneView.tsx` | renderowanie sceny |
| `editor/EditorPage.tsx` | wczytanie, zapis automatyczny, zmiany z serwera |

## Zasady

- **Plik kompozycji jest źródłem prawdy.** Baza przechowuje tylko indeks kompozycji i jest
  odtwarzana z plików przy starcie. Metadane grafik są w bazie.
- **Każda zmiana sceny przechodzi przez `shared/scene/commands.ts`.** Edytor i MCP używają
  tych samych komend. Nowe polecenie edytora to nowa komenda plus akcja w
  `client/src/editor/actions.ts`; nowe polecenie agenta to komenda plus operacja w
  `shared/src/scene/ops.ts`.
- **Serializacja jest deterministyczna.** Ten sam model daje ten sam tekst pliku;
  `serialize.test.ts` to sprawdza.
- **Błędy są zgłaszane, nie pomijane.** Nieznany element w pliku, brak grafiki, zła operacja
  kończą się błędem z nazwą elementu.

### Nowy typ węzła

Wzorem jest `shape`: typ w `types.ts`, zapis i odczyt w `serialize.ts` i `parse.ts`,
granice w `bounds.ts`, renderowanie w `client/src/editor/SceneView.tsx`, sekcja w
`Inspector.tsx`, ikona w `LayersPanel.tsx`, operacja w `ops.ts`, opis w
`server/src/mcp/describe.ts`. Kompilator wskazuje brakujące miejsca, bo każdy `switch` po
typie węzła ma gałąź `never`.

## Baza i migracje

Schemat jest w `server/src/db/schema.ts`. Migracje generuje drizzle-kit:

```bash
cd server
npx drizzle-kit generate --name <opis>
```

Migracje uruchamiają się przy otwarciu workspace. Indeks pełnotekstowy (`graphics_fts`,
FTS5) jest w migracji `0001_graphics_fts.sql`, wygenerowanej przez
`drizzle-kit generate --custom`, bo Drizzle nie opisuje tabel wirtualnych.

## Testy

```bash
npm run typecheck
npm test            # vitest w shared, server, client
npm run test:e2e    # build + Playwright
```

- Testy jednostkowe leżą obok modułów (`*.test.ts`). Testy serwera używają supertest i
  świeżego workspace w katalogu tymczasowym (`server/src/test/helpers.ts`). Testy MCP łączą
  się klientem z SDK przez transport w pamięci.
- Testy e2e (`e2e/app.spec.ts`) uruchamiają aplikację w procesie testu na losowym porcie
  127.0.0.1 (`e2e/harness.ts`) i zamykają ją po każdym teście. Używają Chrome z systemu
  (`channel: 'chrome'`). `connect(page, { samples: true })` wczytuje dane przykładowe.
- `SHOTS_DIR=<folder> npx playwright test` zapisuje zrzuty z kroków testów.

## Zrzuty ekranów do dokumentacji

```bash
npm run screenshots
```

Skrypt `e2e/screenshots.ts` buduje aplikację, wczytuje dane przykładowe i zapisuje zrzuty
w `docs/images/`. Po zmianach w interfejsie wystarczy go uruchomić ponownie i zatwierdzić
nowe pliki. Ścieżki widoczne na zrzucie Ustawień pochodzą z katalogu tymczasowego testu.

## Wersja produkcyjna

```bash
npm run build
npm start
```

Serwer podaje zbudowanego klienta z `client/dist`. Przed wdrożeniem poza maszynę lokalną
trzeba dodać uwierzytelnianie (zob. [PLAN.md](PLAN.md) i [TODO.md](../TODO.md)).
