UPDATE `objectives` SET `status` = 'idle' WHERE `status` = 'ready';
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`recommended_id` text NOT NULL,
	`chosen_id` text,
	`decided_at` text,
	`decided_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence_items` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`task_id` text,
	`command_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`headline` text NOT NULL,
	`summary` text NOT NULL,
	`artifact_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `plan_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `machine_snapshots` (
	`objective_id` text PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plan_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`ord` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`checkpoint_ref` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
	CONSTRAINT "objectives_status_check" CHECK("__new_objectives"."status" in ('creating', 'idle', 'exploring', 'clarifying', 'proposing', 'awaitingDecision', 'planning', 'awaitingPlanApproval', 'executing', 'verifying', 'awaitingReview', 'revising', 'rollingBack', 'integrating', 'done', 'paused', 'cancelled', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_objectives`("id", "project_id", "title", "goal_text", "worktree_path", "branch_name", "status", "mode", "verification_spec", "low_energy", "setup_at", "created_at", "updated_at") SELECT "id", "project_id", "title", "goal_text", "worktree_path", "branch_name", "status", 'standard', NULL, 0, NULL, "created_at", "updated_at" FROM `objectives`;--> statement-breakpoint
DROP TABLE `objectives`;--> statement-breakpoint
ALTER TABLE `__new_objectives` RENAME TO `objectives`;--> statement-breakpoint
PRAGMA foreign_keys=ON;