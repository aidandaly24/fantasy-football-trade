CREATE TABLE `intel_events` (
	`event_key` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`normalized_title` text NOT NULL,
	`display_title` text NOT NULL,
	`event_type` text NOT NULL,
	`direction` text NOT NULL,
	`impact_weight` integer NOT NULL,
	`published_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`sources_json` text NOT NULL,
	`corroboration_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_intel_events_active` ON `intel_events` (`player_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `intel_refresh_runs` (
	`scope` text PRIMARY KEY NOT NULL,
	`started_at` text,
	`completed_at` text,
	`last_success_at` text,
	`source_status_json` text DEFAULT '{}' NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `league_roots` (
	`root_league_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`last_sync_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `league_seasons` (
	`league_id` text PRIMARY KEY NOT NULL,
	`root_league_id` text NOT NULL,
	`season` text NOT NULL,
	`name` text NOT NULL,
	`previous_league_id` text,
	`total_rosters` integer NOT NULL,
	`discovered_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_league_seasons_root` ON `league_seasons` (`root_league_id`,`season`);--> statement-breakpoint
CREATE TABLE `season_rosters` (
	`league_id` text NOT NULL,
	`roster_id` integer NOT NULL,
	`owner_user_id` text,
	`team_name` text NOT NULL,
	`avatar` text,
	`roster_json` text NOT NULL,
	PRIMARY KEY(`league_id`, `roster_id`)
);
--> statement-breakpoint
CREATE TABLE `season_users` (
	`league_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`league_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`root_league_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`seasons_found` integer DEFAULT 0 NOT NULL,
	`targets_attempted` integer DEFAULT 0 NOT NULL,
	`targets_succeeded` integer DEFAULT 0 NOT NULL,
	`trade_count` integer DEFAULT 0 NOT NULL,
	`new_trade_count` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_runs_root_started` ON `sync_runs` (`root_league_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `trade_outcomes` (
	`league_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`checkpoint_days` integer NOT NULL,
	`due_at` text NOT NULL,
	`evaluated_at` text,
	`status` text NOT NULL,
	`grade` text,
	`method_version` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`league_id`, `transaction_id`, `checkpoint_days`)
);
--> statement-breakpoint
CREATE INDEX `idx_trade_outcomes_due` ON `trade_outcomes` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `trade_snapshots` (
	`league_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`snapshot_kind` text NOT NULL,
	`captured_at` text NOT NULL,
	`source` text NOT NULL,
	`source_version` text NOT NULL,
	`values_json` text NOT NULL,
	`is_retrospective` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`league_id`, `transaction_id`, `snapshot_kind`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`league_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`root_league_id` text NOT NULL,
	`season` text NOT NULL,
	`week` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`status_updated_at_ms` integer NOT NULL,
	`creator_user_id` text,
	`roster_ids_json` text NOT NULL,
	`raw_json` text NOT NULL,
	`ingested_at` text NOT NULL,
	PRIMARY KEY(`league_id`, `transaction_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_trades_root_created` ON `trades` (`root_league_id`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `user_intel_alerts` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`event_key` text NOT NULL,
	`player_id` text NOT NULL,
	`created_at` text NOT NULL,
	`seen_at` text,
	`read_at` text,
	`dismissed_at` text,
	PRIMARY KEY(`user_id`, `league_id`, `event_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_user_intel_alerts_inbox` ON `user_intel_alerts` (`user_id`,`league_id`,`dismissed_at`,`read_at`,`created_at`);