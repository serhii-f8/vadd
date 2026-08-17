-- Hand-extended after `drizzle-kit generate`, which emitted only the CREATE
-- UNIQUE INDEX at the bottom of this file.
--
-- `plan_tasks.id` used to be written as the bare ordinal ('0', '1', '2', ...),
-- which is unique inside one objective and unique nowhere else: the second
-- objective in any database that ever reached `planning` failed its insert with
-- `UNIQUE constraint failed: plan_tasks.id`. Ids are objective-scoped from now
-- on (`<objective_id>:<ord>`), so the rows already on disk have to be rewritten
-- to the same convention or the table carries two.
--
-- `evidence_items.task_id` is a foreign key onto `plan_tasks.id`, so it is
-- remapped FIRST, while the old ids are still there to join on. Enforcement is
-- off for the whole batch (see `db/client.ts`), and `applyMigrations` runs
-- `PRAGMA foreign_key_check` afterwards, so a remap that missed a row would
-- refuse the boot rather than silently dangle.
UPDATE `evidence_items`
SET `task_id` = (
  SELECT `p`.`objective_id` || ':' || `p`.`ord`
  FROM `plan_tasks` `p`
  WHERE `p`.`id` = `evidence_items`.`task_id`
)
WHERE `task_id` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `plan_tasks` `p` WHERE `p`.`id` = `evidence_items`.`task_id`);
--> statement-breakpoint
UPDATE `plan_tasks` SET `id` = `objective_id` || ':' || `ord`;
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_tasks_objective_ord_unique` ON `plan_tasks` (`objective_id`,`ord`);
