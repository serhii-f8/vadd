import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { projectMemory } from '../db/schema.js'

const MAX_PER_KIND = 5

/**
 * Capped, formatted project memory for prompt injection — deliberately not
 * the same query the read-only UI route uses (design §3.4 vs §3.6): this
 * one bounds prompt size as notes accumulate across many objectives, the
 * UI route shows everything.
 */
export function buildProjectMemoryPromptBlock(db: Db, projectId: string): string {
  const architecture = db
    .select()
    .from(projectMemory)
    .where(and(eq(projectMemory.projectId, projectId), eq(projectMemory.kind, 'architecture')))
    .orderBy(desc(projectMemory.createdAt))
    .limit(MAX_PER_KIND)
    .all()
  const knownIssues = db
    .select()
    .from(projectMemory)
    .where(and(eq(projectMemory.projectId, projectId), eq(projectMemory.kind, 'known_issue')))
    .orderBy(desc(projectMemory.createdAt))
    .limit(MAX_PER_KIND)
    .all()

  if (architecture.length === 0 && knownIssues.length === 0) {
    return 'No project memory recorded yet.'
  }

  const section = (title: string, rows: typeof architecture) =>
    rows.length === 0
      ? ''
      : `${title}:\n${rows.map((r) => `- ${r.headline}: ${r.content}`).join('\n')}`

  return [section('Known project structure', architecture), section('Known issues', knownIssues)]
    .filter((s) => s !== '')
    .join('\n\n')
}
