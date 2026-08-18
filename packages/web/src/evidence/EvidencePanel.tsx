import { type Aggregate, api } from '../api.js'
import { DiffList } from './DiffList.js'
import { type EvidenceRow, groupEvidence } from './group.js'

const GLYPH: Record<EvidenceRow['status'], string> = {
  pass: '✅',
  fail: '❌',
  warn: '⚠️',
  info: 'ℹ️',
}

function Row({
  row,
  onCommand,
  readOnly,
  expectFailing,
}: {
  row: EvidenceRow
  onCommand: (body: Record<string, unknown>) => void
  readOnly: boolean
  /** Amendment A11: the current task's declared expectFailing ids, if any. */
  expectFailing: string[]
}) {
  const tickable = !readOnly && row.kind === 'check' && row.commandId !== null
  const expected =
    row.status === 'fail' && row.commandId !== null && expectFailing.includes(row.commandId)
  return (
    <li className={`py-2 ${row.status === 'warn' ? 'text-amber-700' : ''}`}>
      <div className="flex items-baseline gap-2">
        {tickable ? (
          <input
            type="checkbox"
            aria-label={row.headline}
            checked={row.status === 'pass'}
            onChange={() =>
              onCommand({
                type: 'tick_check',
                checkId: row.commandId,
                // An untick posts a superseding failing row rather than a
                // delete, so the panel keeps the history.
                satisfied: row.status !== 'pass',
              })
            }
          />
        ) : (
          <span aria-hidden>{GLYPH[row.status]}</span>
        )}
        <span className="font-medium">{row.headline}</span>
        {expected && <span className="text-xs text-amber-700">expected</span>}
        {/* A7: a manual tick must never be mistaken for a command VADD ran. */}
        {row.decidedBy === 'user' && <span className="text-xs text-gray-600">ticked by you</span>}
        {row.artifactPath !== null && (
          <a className="text-xs underline" href={api.artifactUrl(row.id)}>
            log
          </a>
        )}
      </div>
      {row.summary.length > 0 && (
        <ul className="ml-6 text-sm text-gray-600">
          {row.summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Spec §8's Evidence Panel. Three groups, because they mean three different
 * things: **required** rows carry a `commandId` and are what the
 * `evidenceComplete` guard reads — they decide whether `done` is reachable at
 * all; **advisory** rows are agent-emitted and never counted; **warnings** are
 * amber.
 */
export function EvidencePanel({
  aggregate,
  onCommand,
  readOnly = false,
}: {
  aggregate: Aggregate
  onCommand: (body: Record<string, unknown>) => void
  readOnly?: boolean
}) {
  const { required, advisory, warnings } = groupEvidence(aggregate.evidence)

  const expectFailingFor = (row: EvidenceRow): string[] => {
    const task = aggregate.tasks.find((t) => t.id === row.taskId)
    return task?.expectFailing ?? []
  }

  const group = (label: string, rows: EvidenceRow[]) =>
    rows.length === 0 ? null : (
      <section aria-label={label} className="mt-4">
        <h3 className="text-sm font-medium">{label}</h3>
        <ul className="divide-y">
          {rows.map((r) => (
            <Row
              key={r.id}
              row={r}
              onCommand={onCommand}
              readOnly={readOnly}
              expectFailing={expectFailingFor(r)}
            />
          ))}
        </ul>
      </section>
    )

  return (
    <div>
      {group('Required', required)}
      {group('Advisory', advisory)}
      {group('Warnings', warnings)}
      {required.length === 0 && advisory.length === 0 && warnings.length === 0 && (
        <p className="text-sm text-gray-600">No evidence yet.</p>
      )}
      <DiffList objectiveId={aggregate.objective.id} />
    </div>
  )
}
