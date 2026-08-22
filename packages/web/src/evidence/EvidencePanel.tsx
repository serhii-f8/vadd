import { CheckCircle2, CircleAlert, Info, XCircle } from 'lucide-react'
import { type Aggregate, api } from '../api.js'
import { Badge } from '../components/ui/badge.js'
import { DiffList } from './DiffList.js'
import { type EvidenceRow, groupEvidence } from './group.js'

const ICON: Record<EvidenceRow['status'], { Icon: typeof Info; className: string; label: string }> =
  {
    pass: { Icon: CheckCircle2, className: 'text-status-done', label: 'passed' },
    fail: { Icon: XCircle, className: 'text-status-failed', label: 'failed' },
    warn: { Icon: CircleAlert, className: 'text-status-attention', label: 'warning' },
    info: { Icon: Info, className: 'text-status-idle', label: 'info' },
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
    <li className={`py-2 ${row.status === 'warn' ? 'text-status-attention' : ''}`}>
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
          (() => {
            const { Icon, className, label } = ICON[row.status]
            return <Icon className={`size-4 shrink-0 ${className}`} aria-label={label} />
          })()
        )}
        <span className="font-medium">{row.headline}</span>
        {expected && <Badge variant="outline">expected</Badge>}
        {/* A7: a manual tick must never be mistaken for a command VADD ran. */}
        {row.decidedBy === 'user' && <Badge variant="secondary">ticked by you</Badge>}
        {row.artifactPath !== null && (
          <a className="text-xs underline" href={api.artifactUrl(row.id)}>
            log
          </a>
        )}
      </div>
      {row.summary.length > 0 && (
        <ul className="ml-6 text-sm text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">No evidence yet.</p>
      )}
      <DiffList objectiveId={aggregate.objective.id} />
    </div>
  )
}
