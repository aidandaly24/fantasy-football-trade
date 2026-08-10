CREATE TABLE `edge_model_runs` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`run_date` text NOT NULL,
	`model_version` text NOT NULL,
	`trained_at` text NOT NULL,
	`status` text NOT NULL,
	`report_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `league_id`, `run_date`, `model_version`)
);
--> statement-breakpoint
CREATE INDEX `idx_edge_model_runs_latest` ON `edge_model_runs` (`user_id`,`league_id`,`trained_at`);--> statement-breakpoint
CREATE TABLE `market_tape_configs` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`num_qbs` integer NOT NULL,
	`tep` integer NOT NULL,
	`num_teams` integer NOT NULL,
	`source_version` text NOT NULL,
	`seeded_at` text NOT NULL,
	`last_client_refresh_at` text NOT NULL,
	`last_auto_refresh_at` text,
	`last_auto_refresh_error` text,
	PRIMARY KEY(`user_id`, `league_id`)
);
--> statement-breakpoint
CREATE TABLE `market_value_snapshots` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`asset_id` text NOT NULL,
	`asset_name` text NOT NULL,
	`kind` text NOT NULL,
	`position` text NOT NULL,
	`owner_roster_id` integer NOT NULL,
	`current_value` integer NOT NULL,
	`projection_30` integer NOT NULL,
	`confidence` integer NOT NULL,
	`event_type` text NOT NULL,
	`news_direction` text NOT NULL,
	`features_json` text NOT NULL,
	`metadata_json` text NOT NULL,
	`source` text NOT NULL,
	`source_version` text NOT NULL,
	`captured_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `league_id`, `snapshot_date`, `asset_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_market_snapshots_asset_date` ON `market_value_snapshots` (`user_id`,`league_id`,`asset_id`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `idx_market_snapshots_league_date` ON `market_value_snapshots` (`user_id`,`league_id`,`snapshot_date`);