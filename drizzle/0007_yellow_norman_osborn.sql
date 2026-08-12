CREATE TABLE `fantasycalc_trade_tape` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`trade_at` text NOT NULL,
	`source_league_id` text NOT NULL,
	`num_qbs` integer NOT NULL,
	`num_teams` integer NOT NULL,
	`ppr` real NOT NULL,
	`te_premium` real NOT NULL,
	`side1_count` integer NOT NULL,
	`side2_count` integer NOT NULL,
	`raw_json` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fantasycalc_trade_tape_date` ON `fantasycalc_trade_tape` (`trade_at`);--> statement-breakpoint
CREATE INDEX `idx_fantasycalc_trade_tape_league` ON `fantasycalc_trade_tape` (`source_league_id`);--> statement-breakpoint
CREATE TABLE `fantasycalc_trade_tape_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`initiated_by_user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`anchors_attempted` integer DEFAULT 0 NOT NULL,
	`anchors_succeeded` integer DEFAULT 0 NOT NULL,
	`trades_discovered` integer DEFAULT 0 NOT NULL,
	`new_trade_count` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fantasycalc_trade_tape_runs_started` ON `fantasycalc_trade_tape_runs` (`started_at`);