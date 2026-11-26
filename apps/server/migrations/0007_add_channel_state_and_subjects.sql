CREATE TABLE `channel_state` (
	`channel` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`channel`, `key`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `subject` text;--> statement-breakpoint
CREATE INDEX `messages_channel_created_at_idx` ON `messages` (`channel`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_client_thread_idx` ON `messages` (`address_id`,`created_at`) WHERE "messages"."client_thread" is not null;