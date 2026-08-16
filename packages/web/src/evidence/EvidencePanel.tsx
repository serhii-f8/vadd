import type { Aggregate } from '../api.js'

/**
 * Stub — Task 15 replaces this wholesale. The props shape is fixed by that
 * task's interface (`EvidencePanel({ aggregate, onCommand, readOnly? })`) so
 * Task 14's Focus View can already call it with the real contract.
 */
export function EvidencePanel(_props: {
  aggregate: Aggregate
  onCommand: (body: Record<string, unknown>) => void
  readOnly?: boolean
}) {
  return null
}
