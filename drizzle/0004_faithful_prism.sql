CREATE TABLE `historical_market_observations` (
	`provider` text NOT NULL,
	`format_key` text NOT NULL,
	`scale_key` text NOT NULL,
	`asset_id` text NOT NULL,
	`asset_name` text NOT NULL,
	`position` text NOT NULL,
	`observed_at` text NOT NULL,
	`provider_value` real NOT NULL,
	`raw_value` real,
	`source_version` text NOT NULL,
	`provenance_json` text NOT NULL,
	`ingested_at` text NOT NULL,
	PRIMARY KEY(`provider`, `format_key`, `scale_key`, `asset_id`, `observed_at`)
);
--> statement-breakpoint
CREATE INDEX `idx_historical_market_asset_date` ON `historical_market_observations` (`provider`,`format_key`,`scale_key`,`asset_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `historical_tape_assets` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`provider` text NOT NULL,
	`asset_id` text NOT NULL,
	`asset_name` text NOT NULL,
	`position` text NOT NULL,
	`current_composite` integer NOT NULL,
	`slug` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`error_message` text,
	`observation_count` integer DEFAULT 0 NOT NULL,
	`label_count` integer DEFAULT 0 NOT NULL,
	`first_observed_at` text,
	`last_observed_at` text,
	`span_days` integer DEFAULT 0 NOT NULL,
	`median_gap_days` real DEFAULT 0 NOT NULL,
	`scale_status` text DEFAULT 'unknown' NOT NULL,
	`scale_gap` real,
	`source_version` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`user_id`, `league_id`, `provider`, `asset_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_historical_tape_assets_pending` ON `historical_tape_assets` (`user_id`,`league_id`,`provider`,`status`);--> statement-breakpoint
CREATE TABLE `historical_tape_configs` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`format_key` text NOT NULL,
	`num_qbs` integer NOT NULL,
	`tep` integer NOT NULL,
	`num_teams` integer NOT NULL,
	`queued_at` text NOT NULL,
	`started_at` text,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`report_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`user_id`, `league_id`, `provider`)
);
--> statement-breakpoint
CREATE INDEX `idx_historical_tape_configs_status` ON `historical_tape_configs` (`status`,`updated_at`);