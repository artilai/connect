CREATE TABLE `access` (
	`account_id` text NOT NULL,
	`channel` text NOT NULL,
	`admit` text NOT NULL,
	`senders` text NOT NULL,
	PRIMARY KEY(`account_id`, `channel`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_name_idx` ON `accounts` (lower("name"));--> statement-breakpoint
CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`channel` text NOT NULL,
	`value` text NOT NULL,
	`credentials` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `addresses_channel_value_idx` ON `addresses` (`channel`,`value`) WHERE "addresses"."credentials" is not null;--> statement-breakpoint
CREATE INDEX `addresses_account_id_idx` ON `addresses` (`account_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`account_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`token_hash` text NOT NULL,
	`client` text NOT NULL,
	`machine` text,
	`starts_after` integer NOT NULL,
	`listened_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_hash`) REFERENCES `tokens`(`hash`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`channel` text NOT NULL,
	`message_id` text NOT NULL,
	`text` text,
	`sender` text,
	`thread` text,
	`to_thread` text,
	`client` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_account_id_id_idx` ON `events` (`account_id`,`id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`size` integer NOT NULL,
	`key` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_message_id_idx` ON `files` (`message_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`address_id` text NOT NULL,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`external_id` text,
	`counterpart` text NOT NULL,
	`counterpart_name` text,
	`to` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`refusal` text,
	`admission` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`address_id`) REFERENCES `addresses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_account_id_created_at_idx` ON `messages` (`account_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_address_id_external_id_idx` ON `messages` (`address_id`,`direction`,`external_id`) WHERE "messages"."external_id" is not null;--> statement-breakpoint
CREATE TABLE `sign_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`client_id` text,
	`client_name` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`challenge` text NOT NULL,
	`state` text,
	`account_id` text,
	`code_hash` text,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sign_ins_code_hash_unique` ON `sign_ins` (`code_hash`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_unique` ON `tokens` (`hash`);--> statement-breakpoint
CREATE INDEX `tokens_account_id_idx` ON `tokens` (`account_id`);