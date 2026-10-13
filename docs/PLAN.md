# Moniuszko — plan

Moniuszko to aplikacja do prowadzenia biblioteki grafik wektorowych (SVG) i składania z nich
kompozycji, czyli pojedynczych plików SVG. Działa lokalnie, a w przyszłości ma być
uruchamiana także na serwerze. Agent AI ma dostęp do biblioteki i kompozycji przez MCP.

Inspiracją jest projekt `revealeditor`. Przejmujemy z niego zasadę „plik jest źródłem prawdy”,
jedną ścieżkę mutacji dokumentu (command layer), rejestr akcji oraz układ monorepo.

## 1. Dwa tryby aplikacji

**Biblioteka.** Zbiór grafik SVG z metadanymi opisującymi, co przedstawiają. Grafiki
dodaje się przez upuszczenie jednego lub wielu plików. Metadane uzupełnia agent AI przez
MCP albo człowiek w panelu szczegółów.

**Kompozycje.** Lista kompozycji i edytor WYSIWYG. W edytorze wstawia się grafiki z
biblioteki, przesuwa je, obraca, skaluje, grupuje, układa w warstwy i dodaje teksty.
Agent może utworzyć szkic kompozycji z biblioteki, a człowiek poprawia go w edytorze.
Agentowi wydaje się polecenia w kliencie MCP (np. Claude Code). Aplikacja nie ma własnego
pola na prompt.

## 2. Stack

| Obszar | Wybór | Powód |
|---|---|---|
| Monorepo | npm workspaces: `server/`, `client/` | Ten sam układ co w revealeditor. |
| Język | TypeScript | Wspólne typy modelu sceny dla klienta, serwera i MCP. |
| Klient | React 19, Vite, Mantine, Tabler Icons | Znane z revealeditor. |
| Stan i historia | zustand + zundo | Undo/redo na migawkach modelu sceny. |
| Import plików | react-dropzone | Upuszczanie wielu plików naraz. |
| Canvas | natywny SVG renderowany przez React | Wejście i wyjście to SVG. Biblioteki canvasowe (Fabric.js, Konva) gubią przy imporcie i eksporcie gradienty, maski, filtry i CSS. |
| Uchwyty transformacji | Moveable + Selecto | Przesuwanie, obrót, skalowanie, przyciąganie i zaznaczanie prostokątem na elementach SVG. |
| Serwer | Node + Express | Jeden proces serwuje klienta, REST API i MCP. |
| Baza | SQLite (better-sqlite3) + Drizzle ORM | Plik bazy w workspace. Drizzle pozwala później przejść na Postgresa. |
| Wyszukiwanie | SQLite FTS5 | Pełnotekstowe wyszukiwanie po tytule, opisie i tagach. |
| Sanityzacja SVG | DOMPurify (profil SVG) + svgo | Usunięcie skryptów, handlerów `on*` i zewnętrznych referencji. Normalizacja jest opcjonalna, a oryginał zostaje zachowany. |
| Rasteryzacja | @resvg/resvg-js | Miniatury oraz podglądy PNG dla agenta. |
| MCP | @modelcontextprotocol/sdk, Streamable HTTP pod `/mcp` | Ten sam proces i ta sama baza co aplikacja. |
| Testy | vitest, Playwright | Jak w revealeditor. |

## 3. Workspace i pliki

Workspace to folder wskazany w konfiguracji (`moniuszko.config.json`) i zmieniany w
ustawieniach aplikacji. Każdy z podfolderów można przenieść osobno.

```
<workspace>/
  moniuszko.db              baza SQLite: metadane, indeks FTS
  library/<id>.svg          grafiki po sanityzacji
  library/originals/<id>.svg  pliki w postaci, w jakiej zostały zaimportowane
  thumbnails/<id>.png       miniatury generowane przez resvg
  compositions/<slug>.svg   pliki robocze kompozycji
  exports/                  domyślny folder eksportu
```

## 4. Model danych

### Grafika w bibliotece

| Pole | Opis |
|---|---|
| `id` | identyfikator (nanoid) |
| `title` | krótka nazwa |
| `description` | opis tego, co jest na grafice |
| `tags` | lista tagów |
| `category` | kategoria (np. postać, budynek, roślina, tło) |
| `colors` | dominujące kolory, wyliczane przy imporcie |
| `width`, `height`, `viewBox` | wymiary |
| `source` | skąd pochodzi plik (nazwa pliku, autor, licencja) |
| `tagStatus` | `untagged`, `ai` (otagowana przez agenta), `reviewed` (sprawdzona przez człowieka) |
| `sha256` | skrót treści; służy do wykrywania duplikatów przy imporcie |
| `createdAt`, `updatedAt` | daty |

### Kompozycja

Plik roboczy kompozycji to samodzielny SVG. Edytor odtwarza z niego scenę na podstawie
atrybutów `data-mz-*`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"
     data-mz-composition="1" data-mz-version="1">
  <g data-mz-layer="tlo" data-mz-name="Tło">
    <g data-mz-asset="a1b2c3" data-mz-node="n1" transform="translate(0 0)">
      <!-- wklejona treść grafiki a1b2c3; id wewnątrz z prefiksem n1- -->
    </g>
  </g>
  <g data-mz-layer="obiekty" data-mz-name="Obiekty">
    <g data-mz-group="g1" data-mz-name="Domek z drzewem">
      <g data-mz-asset="d4e5f6" data-mz-node="n2" transform="translate(420 310) rotate(-4) scale(0.8)">…</g>
    </g>
    <text data-mz-node="n3" x="80" y="120" font-family="Lato" font-size="64">Tytuł</text>
  </g>
</svg>
```

- Instancja grafiki to `<g data-mz-asset="<id>">` z wklejoną kopią treści. Identyfikatory
  wewnątrz kopii dostają prefiks węzła, żeby dwie instancje tej samej grafiki nie
  kolidowały (gradienty, maski, clipPath).
- Warstwy to elementy `<g data-mz-layer>` najwyższego poziomu. Grupy to `<g data-mz-group>`.
- Tekst to element `<text>`. Zamiana tekstu na krzywe jest opisana w `TODO.md`.
- W bazie kompozycja ma rekord z nazwą, datami, autorem (`human` / `agent`), statusem
  (`draft`, `reviewed`) i listą użytych grafik.

### Eksport kompozycji

Eksport ma dwa tryby:

1. **Samodzielny plik.** Treść grafik jest wklejona, a atrybuty `data-mz-*` są usunięte.
   Plik nie zależy od niczego poza fontami.
2. **Z referencjami.** Każda instancja grafiki to `<use href="…/library/<id>.svg#root">`
   albo `<image href="…">` wskazujące na plik biblioteki. Zmiana grafiki w bibliotece
   jest widoczna w wyeksportowanym pliku. Plik wymaga dostępu do folderu biblioteki.

W trybie z referencjami instancja to `<image href>` ze ścieżką względną od folderu
eksportu. `<use>` do zewnętrznego pliku nie działa w części przeglądarek przy otwieraniu
z `file://`. W obu trybach ukryte warstwy i obiekty są pomijane. Pobieranie z przeglądarki
obsługuje tylko plik samodzielny, bo ścieżki względne zależą od miejsca zapisu.

### Kształty

Poza grafikami z biblioteki i tekstami kompozycja może zawierać prymitywy: prostokąt
(i kwadrat), elipsę (i koło), wielokąt foremny (np. trójkąt), gwiazdę i linię. Węzeł
`shape` ma wymiary, wypełnienie, obrys, zaokrąglenie narożników, liczbę boków lub ramion
i wcięcie gwiazdy. W pliku jest to `<g data-mz-shape="…">` z parametrami w atrybutach
`data-mz-*` i elementem SVG wyrenderowanym z nich (`shared/src/scene/shapes.ts`).
Agent dodaje kształty operacją `add_shape`.

## 5. Edytor

Edytor powtarza architekturę revealeditor w uproszczonej postaci:

- **Model sceny** — drzewo: kompozycja → warstwy → węzły (`asset`, `group`, `text`, `shape`).
  Każdy węzeł ma `transform` (x, y, obrót, skala), `opacity`, `locked`, `hidden`.
- **Command layer** — każda zmiana sceny przechodzi przez nazwane komendy
  (`moveNodes`, `rotateNodes`, `groupNodes`, `insertAsset`, `setText`, `reorder`…).
  Te same komendy wykonuje serwer dla operacji MCP `apply_scene_ops`.
- **Rejestr akcji** — skróty klawiszowe, pasek narzędzi i menu kontekstowe korzystają
  z jednej listy akcji.
- **Historia** — zundo na migawkach modelu sceny.
- **Serializacja** — deterministyczna: ten sam model daje ten sam plik, więc zapis
  bez zmian nie zmienia pliku.

Funkcje edytora w pierwszej wersji: zaznaczanie (klik, Shift, prostokąt), przesuwanie,
obracanie, skalowanie z zachowaniem proporcji, grupowanie i rozgrupowanie, warstwy
(dodawanie, zmiana nazwy, kolejność, ukrywanie, blokowanie), kolejność w warstwie,
wyrównywanie, teksty, wstawianie z panelu biblioteki przez przeciągnięcie, zoom i
przesuwanie widoku, rozmiar płótna, undo/redo, zapis, eksport.

## 6. MCP

Serwer MCP działa w tym samym procesie co aplikacja, pod `/mcp`.

**Biblioteka**

| Narzędzie | Działanie |
|---|---|
| `search_graphics` | wyszukiwanie po tekście, tagach, kategorii, statusie; zwraca listę z miniaturami |
| `get_graphic` | metadane, treść SVG i podgląd PNG |
| `add_graphic` | dodanie grafiki (treść SVG + opcjonalne metadane) |
| `update_graphic_metadata` | zmiana tytułu, opisu, tagów, kategorii; ustawia `tagStatus = ai` |
| `list_untagged` | grafiki ze statusem `untagged`, z podglądami |

**Kompozycje**

| Narzędzie | Działanie |
|---|---|
| `list_compositions` | lista kompozycji |
| `get_composition` | struktura sceny (warstwy, węzły, transformacje) i render PNG |
| `create_composition` | nowa kompozycja o zadanym rozmiarze płótna |
| `apply_scene_ops` | lista operacji: wstaw grafikę, przesuń, obróć, skaluj, grupuj, dodaj tekst, zmień warstwę i kolejność |

Kompozycja utworzona przez agenta ma `author = agent` i status `draft`. Gdy agent zmieni
kompozycję otwartą w edytorze, serwer wysyła powiadomienie przez SSE, a edytor przeładowuje
scenę. Jeśli w edytorze są niezapisane zmiany, edytor pyta, którą wersję zachować.

## 7. Wdrożenie na serwer (później)

Ten sam proces Node z innym workspace. Do dodania: uwierzytelnianie dla UI i dla MCP
(token), limity rozmiaru uploadu, ewentualnie Postgres zamiast SQLite.

## 8. Etapy

1. Szkielet monorepo, konfiguracja workspace, baza i migracje Drizzle.
2. Biblioteka: import przez upuszczanie (sanityzacja, duplikaty, miniatury), siatka,
   wyszukiwanie i filtry, panel metadanych.
3. MCP dla biblioteki.
4. Lista kompozycji i edytor: model sceny, komendy, canvas, uchwyty, warstwy, grupy,
   teksty, historia, zapis.
5. Eksport w dwóch trybach.
6. MCP dla kompozycji, powiadomienia SSE, oznaczanie szkiców agenta.

## 9. Makiety

Statyczne makiety HTML są w `docs/mockups/`. Spis jest w `docs/mockups/index.html`.
