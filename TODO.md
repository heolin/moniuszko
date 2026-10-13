# TODO

Rzeczy odłożone poza pierwszą wersję.

- **Tagowanie AI z poziomu aplikacji.** Przycisk „Otaguj” w bibliotece (dla jednej grafiki
  i dla zaznaczonych), który wywołuje Claude API bezpośrednio z serwera, bez zewnętrznego
  agenta. W pierwszej wersji tagowanie AI odbywa się tylko przez MCP.
- **Zamiana tekstu na krzywe przy eksporcie.** Opcja eksportu, która zamienia elementy
  `<text>` na ścieżki (np. przez opentype.js), żeby plik nie zależał od fontów
  zainstalowanych u odbiorcy. W pierwszej wersji tekst zostaje elementem `<text>`.

Nie zrobione w pierwszej wersji edytora:

- **Przyciąganie (snapping)** do krawędzi płótna i innych obiektów przy przesuwaniu.
  Moveable je ma, ale przy przyciąganiu trzeba brać przesunięcie z jego zdarzeń zamiast
  z pozycji kursora; to wymaga sprawdzenia, jak Moveable liczy przesunięcie dla elementów
  SVG w płótnie skalowanym przez viewBox.
- **Przeciąganie w panelu warstw** (zmiana kolejności i przenoszenie między warstwami).
  Teraz służą do tego przyciski kolejności i menu warstwy „Przenieś zaznaczone tutaj”.
- **Menu kontekstowe** na płótnie.
- **Domyślna aktywna warstwa** to najwyższa odblokowana, czyli w nowej kompozycji
  „Teksty”. Grafiki wstawione bez wybrania warstwy trafiają więc do „Teksty”.
- **Edycja tekstu w miejscu** nie uwzględnia obrotu ani skali grupy nadrzędnej (pole edycji
  jest prostokątem otaczającym tekst na ekranie).
