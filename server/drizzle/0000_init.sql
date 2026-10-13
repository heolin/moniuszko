CREATE TABLE `composition_assets` (
	`composition_id` text NOT NULL,
	`graphic_id` text NOT NULL,
	PRIMARY KEY(`composition_id`, `graphic_id`),
	FOREIGN KEY (`composition_id`) REFERENCES `compositions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `composition_assets_graphic_idx` ON `composition_assets` (`graphic_id`);--> statement-breakpoint
CREATE TABLE `compositions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`author` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graphic_tags` (
	`graphic_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`graphic_id`, `tag`),
	FOREIGN KEY (`graphic_id`) REFERENCES `graphics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graphic_tags_tag_idx` ON `graphic_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `graphics` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text,
	`colors` text NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`view_box` text NOT NULL,
	`source_name` text,
	`author` text,
	`license` text,
	`tag_status` text DEFAULT 'untagged' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE INDEX `graphics_sha256_idx` ON `graphics` (`sha256`);--> statement-breakpoint
CREATE INDEX `graphics_tag_status_idx` ON `graphics` (`tag_status`);--> statement-breakpoint
CREATE INDEX `graphics_category_idx` ON `graphics` (`category`);