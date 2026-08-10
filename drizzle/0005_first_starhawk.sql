CREATE TABLE `league_week_states` (
	`root_league_id` text NOT NULL,
	`league_id` text NOT NULL,
	`season` text NOT NULL,
	`week` integer NOT NULL,
	`roster_id` integer NOT NULL,
	`owner_user_id` text,
	`players_json` text NOT NULL,
	`starters_json` text NOT NULL,
	`points` real NOT NULL,
	`points_against` real NOT NULL,
	`wins` integer NOT NULL,
	`losses` integer NOT NULL,
	`ties` integer NOT NULL,
	`source_version` text NOT NULL,
	`captured_at` text NOT NULL,
	PRIMARY KEY(`league_id`, `week`, `roster_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_league_week_states_root` ON `league_week_states` (`root_league_id`,`season`,`week`,`roster_id`);--> statement-breakpoint
CREATE TABLE `manager_behavior_snapshots` (
	`root_league_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`as_of_date` text NOT NULL,
	`trade_count` integer NOT NULL,
	`initiated_count` integer NOT NULL,
	`received_players` integer NOT NULL,
	`received_picks` integer NOT NULL,
	`sent_players` integer NOT NULL,
	`sent_picks` integer NOT NULL,
	`pick_affinity` real NOT NULL,
	`consolidation_index` real NOT NULL,
	`sample_weight` real NOT NULL,
	`evidence_json` text NOT NULL,
	PRIMARY KEY(`root_league_id`, `owner_user_id`, `as_of_date`)
);
--> statement-breakpoint
CREATE INDEX `idx_manager_behavior_root` ON `manager_behavior_snapshots` (`root_league_id`,`as_of_date`);--> statement-breakpoint
CREATE TABLE `objective_player_observations` (
	`asset_id` text NOT NULL,
	`observed_date` text NOT NULL,
	`observed_at` text NOT NULL,
	`name` text NOT NULL,
	`position` text,
	`team` text,
	`age` real,
	`active` integer,
	`status` text,
	`injury_status` text,
	`depth_chart_order` integer,
	`depth_chart_position` text,
	`source` text NOT NULL,
	`source_version` text NOT NULL,
	PRIMARY KEY(`asset_id`, `observed_date`)
);
--> statement-breakpoint
CREATE INDEX `idx_objective_player_observations_date` ON `objective_player_observations` (`asset_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `research_pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`root_league_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`seasons` integer DEFAULT 0 NOT NULL,
	`expected_roster_weeks` integer DEFAULT 0 NOT NULL,
	`roster_weeks` integer DEFAULT 0 NOT NULL,
	`identity_parties` integer DEFAULT 0 NOT NULL,
	`mapped_identity_parties` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_pipeline_runs_root` ON `research_pipeline_runs` (`root_league_id`,`started_at`);