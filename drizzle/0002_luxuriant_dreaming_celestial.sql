CREATE TABLE `edge_opportunity_snapshots` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`snapshot_key` text NOT NULL,
	`asset_id` text NOT NULL,
	`asset_name` text NOT NULL,
	`owner_roster_id` integer NOT NULL,
	`captured_at` text NOT NULL,
	`current_value` integer NOT NULL,
	`projection_30` integer NOT NULL,
	`projection_90` integer NOT NULL,
	`projection_180` integer NOT NULL,
	`edge_score` integer NOT NULL,
	`lineup_delta` real NOT NULL,
	`confidence` integer NOT NULL,
	`categories_json` text NOT NULL,
	`catalyst` text NOT NULL,
	`status` text DEFAULT 'tracking' NOT NULL,
	PRIMARY KEY(`user_id`, `league_id`, `snapshot_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_edge_opportunities_user_league` ON `edge_opportunity_snapshots` (`user_id`,`league_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `user_trade_offers` (
	`user_id` text NOT NULL,
	`league_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`counterpart_roster_id` integer NOT NULL,
	`target_asset_id` text NOT NULL,
	`target_asset_name` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`sent_assets_json` text NOT NULL,
	`receive_assets_json` text NOT NULL,
	`market_delta` integer NOT NULL,
	`lineup_delta` real NOT NULL,
	`thesis` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `league_id`, `offer_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_trade_offers_user_league` ON `user_trade_offers` (`user_id`,`league_id`,`updated_at`);