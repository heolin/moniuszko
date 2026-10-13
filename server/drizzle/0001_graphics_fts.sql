-- Custom SQL migration file, put your code below! --
-- Indeks pełnotekstowy grafik. Drizzle nie opisuje tabel wirtualnych, więc ta migracja jest
-- wygenerowana przez `drizzle-kit generate --custom` i uzupełniona ręcznie. Wiersze utrzymuje
-- kod aplikacji (library/repository.ts) przy każdej zmianie metadanych.
-- remove_diacritics 2: wyszukiwanie „zolty” znajduje „żółty”.
CREATE VIRTUAL TABLE `graphics_fts` USING fts5(
	`graphic_id` UNINDEXED,
	`title`,
	`description`,
	`tags`,
	`category`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
