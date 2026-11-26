CREATE TABLE `channel_state` (
	`channel` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`channel`, `key`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `subject` text;