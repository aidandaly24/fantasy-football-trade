CREATE TABLE `user_league_preferences` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`league_name` text NOT NULL,
	`my_roster_id` integer,
	`watchlist_json` text DEFAULT '[]' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `league_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_user_league_preferences_recent` ON `user_league_preferences` (`user_id`,`updated_at`);