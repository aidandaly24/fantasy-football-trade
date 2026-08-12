CREATE TABLE `trade_decisions` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`decision_id` text NOT NULL,
	`status` text NOT NULL,
	`my_roster_id` integer NOT NULL,
	`counterpart_roster_id` integer NOT NULL,
	`send_assets_json` text NOT NULL,
	`receive_assets_json` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`thesis` text NOT NULL,
	`hold_period` text NOT NULL,
	`exit_condition` text NOT NULL,
	`catalysts_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`offered_at` text,
	`resolved_at` text,
	PRIMARY KEY(`user_id`, `league_id`, `decision_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_trade_decisions_user_league` ON `trade_decisions` (`user_id`,`league_id`,`updated_at`);