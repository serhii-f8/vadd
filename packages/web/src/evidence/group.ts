/** One `evidence_items` row, as the aggregate endpoint returns it. */
export type EvidenceRow = {
  id: string
  /**
   * Amendment A5: the `verify.commands[].id` or derived `check-<index>` this
   * row satisfies. Null for agent-emitted evidence, which is displayed but
   * never closes a required verification item.
   */
  commandId: string | null
  kind: 'test' | 'diff' | 'lint' | 'build' | 'check' | 'artifact' | 'warning'
  status: 'pass' | 'fail' | 'warn' | 'info'
  headline: string
  summary: string[]
  artifactPath: string | null
  /** Amendment A7: `'user'` for a manual tick in the panel. */
  decidedBy: 'user' | 'policy' | null
  createdAt: string
}

export type GroupedEvidence = {
  /** Rows the `evidenceComplete` guard reads. These decide whether `done` is reachable. */
  required: EvidenceRow[]
  /** Agent-emitted rows: shown, never counted. */
  advisory: EvidenceRow[]
  /** Amber. Spec §8. */
  warnings: EvidenceRow[]
}

function newestFirst(a: EvidenceRow, b: EvidenceRow): number {
  return b.createdAt.localeCompare(a.createdAt)
}

/**
 * Splits an objective's evidence into the three groups spec §8's panel shows.
 *
 * `check`-kind rows are deduplicated to the most recent per `commandId`,
 * mirroring `currentEvidence` on the server: an untick is recorded as a
 * superseding failing row rather than a delete, so showing both would show a
 * check as simultaneously satisfied and not. Every other kind is left intact —
 * two runs of the same test command are history, and collapsing them would
 * hide a suite that went red and then green.
 */
export function groupEvidence(rows: EvidenceRow[]): GroupedEvidence {
  const warnings: EvidenceRow[] = []
  const candidates: EvidenceRow[] = []
  for (const r of rows) {
    if (r.status === 'warn') warnings.push(r)
    else candidates.push(r)
  }

  const latestCheck = new Map<string, EvidenceRow>()
  const kept: EvidenceRow[] = []
  for (const r of candidates) {
    if (r.kind !== 'check' || r.commandId === null) {
      kept.push(r)
      continue
    }
    const seen = latestCheck.get(r.commandId)
    if (!seen || seen.createdAt <= r.createdAt) latestCheck.set(r.commandId, r)
  }
  kept.push(...latestCheck.values())

  return {
    required: kept.filter((r) => r.commandId !== null).sort(newestFirst),
    advisory: kept.filter((r) => r.commandId === null).sort(newestFirst),
    warnings: warnings.sort(newestFirst),
  }
}
