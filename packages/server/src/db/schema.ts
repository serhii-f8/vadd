import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repoPath: text('repo_path').notNull().unique(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull(),
})

/**
 * Spec §5's seventeen states, plus two pre-machine ones.
 *
 * `creating` is not a machine state: a row is inserted with it *before*
 * `git worktree add` runs, and `reconcileOnBoot` deletes exactly those rows. No
 * actor ever observes it, but the CHECK has to allow it or objective creation
 * fails at the first insert. `setup_failed` (phase 4) is the same kind of thing
 * for a worktree whose A1 `setup` commands failed.
 */
export const OBJECTIVE_STATUSES = [
  'creating',
  /**
   * Pre-machine, like `creating`: amendment A1's `setup` commands failed, so
   * the worktree is unusable and no actor is ever started. Deliberately *not*
   * swept by `reconcileOnBoot` — unlike `creating`, this row owns an
   * `evidence_items` row carrying the failure log, and deleting it would both
   * lose the diagnostic and trip the same foreign key that broke
   * `integrate: discard` in phase 3.
   */
  'setup_failed',
  'idle',
  'exploring',
  'clarifying',
  'proposing',
  'awaitingDecision',
  'planning',
  'awaitingPlanApproval',
  'executing',
  'verifying',
  'awaitingReview',
  'revising',
  'rollingBack',
  'integrating',
  'done',
  'paused',
  'cancelled',
  'failed',
] as const

/**
 * Reduced for M0 (design §1.2 B1). M1 adds `mode`, `verificationSpec`, and
 * `lowEnergy` by migration, and constrains `status` to the machine's states.
 *
 * `worktreePath` and `branchName` are nullable because a row is inserted with
 * status 'creating' *before* `git worktree add` runs (design §5).
 */
export const objectives = sqliteTable(
  'objectives',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    goalText: text('goal_text').notNull(),
    worktreePath: text('worktree_path'),
    branchName: text('branch_name'),
    status: text('status').notNull(),
    /** D1's two paths. Fast Fix skips proposing/awaitingDecision, never verification. */
    mode: text('mode', { enum: ['standard', 'fastfix'] })
      .notNull()
      .default('standard'),
    /** Spec §6, resolved at objective creation in phase 4. Null = not yet resolved. */
    verificationSpec: text('verification_spec', { mode: 'json' }).$type<Record<
      string,
      unknown
    > | null>(),
    lowEnergy: integer('low_energy', { mode: 'boolean' }).notNull().default(false),
    /** ISO timestamp of the one-shot `setup` run for this worktree (A1, §7.3). */
    setupAt: text('setup_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check(
      'objectives_status_check',
      sql`${t.status} in (${sql.join(
        OBJECTIVE_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    ),
  ],
)

export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  objectiveId: text('objective_id')
    .notNull()
    .references(() => objectives.id),
  acpSessionId: text('acp_session_id').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
})

/** Append-only. `id` is the SSE event id and the resume cursor (design §4.2). */
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  objectiveId: text('objective_id'),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull(),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
})

/** Latest snapshot only — history lives in `events` (spec §3). */
export const machineSnapshots = sqliteTable('machine_snapshots', {
  objectiveId: text('objective_id')
    .primaryKey()
    .references(() => objectives.id),
  snapshot: text('snapshot', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const decisions = sqliteTable('decisions', {
  id: text('id').primaryKey(),
  objectiveId: text('objective_id')
    .notNull()
    .references(() => objectives.id),
  question: text('question').notNull(),
  options: text('options', { mode: 'json' }).$type<unknown>().notNull(),
  recommendedId: text('recommended_id').notNull(),
  chosenId: text('chosen_id'),
  decidedAt: text('decided_at'),
  decidedBy: text('decided_by', { enum: ['user', 'policy'] }),
  createdAt: text('created_at').notNull(),
})

export const planTasks = sqliteTable('plan_tasks', {
  id: text('id').primaryKey(),
  objectiveId: text('objective_id')
    .notNull()
    .references(() => objectives.id),
  ord: integer('ord').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'verifying', 'verified', 'failed', 'skipped'],
  }).notNull(),
  /** The `vadd-checkpoint:` commit made before this task's first `executing` entry. */
  checkpointRef: text('checkpoint_ref'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
})

export const evidenceItems = sqliteTable('evidence_items', {
  id: text('id').primaryKey(),
  objectiveId: text('objective_id')
    .notNull()
    .references(() => objectives.id),
  taskId: text('task_id').references(() => planTasks.id),
  /**
   * Amendment A5: the `verify.commands[].id` or derived `check-<index>` this row
   * satisfies. Null for agent-emitted evidence, which is displayed but never
   * closes a required verification item.
   */
  commandId: text('command_id'),
  kind: text('kind', {
    enum: ['test', 'diff', 'lint', 'build', 'check', 'artifact', 'warning'],
  }).notNull(),
  status: text('status', { enum: ['pass', 'fail', 'warn', 'info'] }).notNull(),
  headline: text('headline').notNull(),
  summary: text('summary', { mode: 'json' }).$type<string[]>().notNull(),
  artifactPath: text('artifact_path'),
  /**
   * Amendment A7. `'user'` for a manual tick in the Evidence Panel (spec §6);
   * null for everything VADD or the agent produces.
   */
  decidedBy: text('decided_by', { enum: ['user', 'policy'] }),
  createdAt: text('created_at').notNull(),
})
