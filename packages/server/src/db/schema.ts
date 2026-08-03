import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repoPath: text('repo_path').notNull().unique(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull(),
})

/**
 * Reduced for M0 (design §1.2 B1). M1 adds `mode`, `verificationSpec`, and
 * `lowEnergy` by migration, and constrains `status` to the machine's states.
 *
 * `worktreePath` and `branchName` are nullable because a row is inserted with
 * status 'creating' *before* `git worktree add` runs (design §5).
 */
export const objectives = sqliteTable('objectives', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  goalText: text('goal_text').notNull(),
  worktreePath: text('worktree_path'),
  branchName: text('branch_name'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

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
