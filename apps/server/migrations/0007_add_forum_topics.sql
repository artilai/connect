CREATE TABLE `topic_participants` (
	`topic_id` integer NOT NULL,
	`account_id` text NOT NULL,
	`wakes` integer DEFAULT 0 NOT NULL,
	`counted_since` integer,
	PRIMARY KEY(`topic_id`, `account_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
