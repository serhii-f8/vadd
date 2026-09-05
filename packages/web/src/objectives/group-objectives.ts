import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { type StatusTone, statusFor } from '../routes/stateColor.js'

export type GroupKey = 'attention' | 'active' | 'idle' | 'finished'

export type ObjectiveGroup = {
  key: GroupKey
  label: string
  tone: StatusTone
  rows: ObjectiveListRow[]
}

const GROUPS: Array<{ key: GroupKey; label: string; tone: StatusTone; tones: StatusTone[] }> = [
  { key: 'attention', label: 'Needs you', tone: 'attention', tones: ['attention'] },
  { key: 'active', label: 'Working', tone: 'active', tones: ['active'] },
  // `paused` is an attention tone (M2 visual pass §3: you are the blocker),
  // so it lands under Needs you; this group is what has not started yet.
  { key: 'idle', label: 'Not started', tone: 'idle', tones: ['idle'] },
  { key: 'finished', label: 'Finished', tone: 'done', tones: ['done', 'failed'] },
]

/**
 * The board's reading order: what needs you first, then what is running,
 * then what has not started, then what is over. Groups with nothing in them are
 * omitted rather than shown empty; within a group, newest first.
 *
 * Reads `statusFor`, the same five-tone mapping the dot uses, so the two
 * cannot disagree about which objectives need attention.
 */
export function groupObjectives(rows: ObjectiveListRow[]): ObjectiveGroup[] {
  const byTone = new Map<StatusTone, ObjectiveListRow[]>()
  for (const row of rows) {
    const tone = statusFor(row.status as ViewStateName).tone
    const list = byTone.get(tone) ?? []
    list.push(row)
    byTone.set(tone, list)
  }
  return GROUPS.flatMap(({ key, label, tone, tones }) => {
    const members = tones.flatMap((t) => byTone.get(t) ?? [])
    if (members.length === 0) return []
    members.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return [{ key, label, tone, rows: members }]
  })
}
