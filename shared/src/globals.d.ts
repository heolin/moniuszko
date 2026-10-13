// Funkcje globalne dostępne w przeglądarkach i w Node ≥ 17, których nie ma w lib ES2022.
// Pakiet shared nie dołącza typów DOM ani Node, bo działa w obu środowiskach.

declare function structuredClone<T>(value: T): T;

declare var crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T;
};
