CREATE TABLE `forum_wakes` (
	`poster_id` text NOT NULL,
	`account_id` text NOT NULL,
	`wakes` integer NOT NULL,
	`counted_since` integer NOT NULL,
	PRIMARY KEY(`poster_id`, `account_id`),
	FOREIGN KEY (`poster_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topic_participants` (
	`topic_id` integer NOT NULL,
	`account_id` text NOT NULL,
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
