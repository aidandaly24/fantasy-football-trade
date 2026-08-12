CREATE TABLE `trade_roster_contexts` (
	`league_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`roster_id` integer NOT NULL,
	`captured_at` text NOT NULL,
	`context_kind` text NOT NULL,
	`context_json` text NOT NULL,
	PRIMARY KEY(`league_id`, `transaction_id`, `roster_id`)
);
