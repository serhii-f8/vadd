import { CheckCircle2, CircleAlert, Info, XCircle } from 'lucide-react'
import { type Aggregate, api } from '../api.js'
import { Badge } from '../components/ui/badge.js'
import { DiffList } from './DiffList.js'
import { EvidenceTiles } from './EvidenceTiles.js'
import { type EvidenceRow, groupEvidence } from './group.js'

const ICON: Record<EvidenceRow['status'], { Icon: typeof Info; className: string; label: string }> =
  {
    pass: { Icon: CheckCircle2, className: 'text-status-done', label: 'passed' },
    fail: { Icon: XCircle, className: 'text-status-failed', label: 'failed' },
    warn: { Icon: CircleAlert, className: 'text-status-attention', label: 'warning' },
    info: { Icon: Info, className: 'text-status-idle', label: 'info' },
  }

const STATUS_BADGE: Record<EvidenceRow['status'], string> = {
  pass: 'bg-status-done/15',
  fail: 'bg-status-failed/15',
  warn: 'bg-status-attention/15',
  info: 'bg-muted',
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
  const { Icon, className, label } = ICON[row.status]
  return (
    <li className="flex gap-2.5 py-2.5">
      {tickable ? (
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
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
        <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-label={label} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.headline}</span>
          {expected && <Badge variant="outline">expected</Badge>}
          {/* A7: a manual tick must never be mistaken for a command VADD ran. */}
          {row.decidedBy === 'user' && <Badge variant="secondary">ticked by you</Badge>}
        </div>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{row.kind}</span>
          {row.artifactPath !== null && (
            <>
              <span aria-hidden="true">·</span>
              <a className="underline" href={api.artifactUrl(row.id)}>
                log
              </a>
            </>
          )}
        </div>
        {row.summary.length > 0 && (
          <ul className="mt-0.5 text-sm text-muted-foreground">
            {row.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
      </div>
      <Badge
        className={`shrink-0 self-start font-normal text-foreground ${STATUS_BADGE[row.status]}`}
      >
        {row.status}
      </Badge>
    </li>
  )
}

/**
 * Spec §8's Evidence Panel. Three groups, because they mean three different
 * things: **required** rows carry a `commandId` and are what the
 * `evidenceComplete` guard reads — they decide whether `done` is reachable at
 * all; **advisory** rows are agent-emitted and never counted; **warnings** are
 * amber. Above them, three tiles with the counts.
 */
export function EvidencePanel({
  aggregate,
  onCommand,
  readOnly = false,
  tiles = true,
}: {
  aggregate: Aggregate
  onCommand: (body: Record<string, unknown>) => void
  readOnly?: boolean
  /** The summary tiles; off where the panel is secondary (a paused objective's reason). */
  tiles?: boolean
}) {
  const grouped = groupEvidence(aggregate.evidence)
  const { required, advisory, warnings } = grouped
  const empty = required.length === 0 && advisory.length === 0 && warnings.length === 0

  const expectFailingFor = (row: EvidenceRow): string[] => {
    const task = aggregate.tasks.find((t) => t.id === row.taskId)
    return task?.expectFailing ?? []
  }

  const group = (label: string, rows: EvidenceRow[]) =>
    rows.length === 0 ? null : (
      <section aria-label={label} className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{label}</h3>
        <ul className="divide-y divide-border">
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
    <div className="flex flex-col gap-4">
      {tiles && !empty && <EvidenceTiles grouped={grouped} />}
      {empty ? (
        <p className="text-sm text-muted-foreground">No evidence yet.</p>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
          {group('Required', required)}
          {group('Advisory', advisory)}
          {group('Warnings', warnings)}
        </div>
      )}
      <DiffList objectiveId={aggregate.objective.id} />
    </div>
  )
}
