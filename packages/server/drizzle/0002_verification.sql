PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`goal_text` text NOT NULL,
	`worktree_path` text,
	`branch_name` text,
	`status` text NOT NULL,
	`mode` text DEFAULT 'standard' NOT NULL,
	`verification_spec` text,
	`low_energy` integer DEFAULT false NOT NULL,
	`setup_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "objectives_status_check" CHECK("__new_objectives"."status" in ('creating', 'setup_failed', 'idle', 'exploring', 'clarifying', 'proposing', 'awaitingDecision', 'planning', 'awaitingPlanApproval', 'executing', 'verifying', 'awaitingReview', 'revising', 'rollingBack', 'integrating', 'done', 'paused', 'cancelled', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_objectives`("id", "project_id", "title", "goal_text", "worktree_path", "branch_name", "status", "mode", "verification_spec", "low_energy", "setup_at", "created_at", "updated_at") SELECT "id", "project_id", "title", "goal_text", "worktree_path", "branch_name", "status", "mode", "verification_spec", "low_energy", "setup_at", "created_at", "updated_at" FROM `objectives`;--> statement-breakpoint
DROP TABLE `objectives`;--> statement-breakpoint
ALTER TABLE `__new_objectives` RENAME TO `objectives`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `evidence_items` ADD `decided_by` text;