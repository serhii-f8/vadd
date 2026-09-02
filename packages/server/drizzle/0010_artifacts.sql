CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`state` text NOT NULL,
	`cards` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE no action
);
