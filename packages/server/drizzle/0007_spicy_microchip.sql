CREATE TABLE `git_undo` (
	`worktree_path` text PRIMARY KEY NOT NULL,
	`objective_id` text,
	`branch` text,
	`before_sha` text NOT NULL,
	`describes` text NOT NULL,
	`at` text NOT NULL
);
