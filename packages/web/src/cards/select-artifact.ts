import type { Artifact } from '../api.js'

/**
 * Which turn's artifact a waiting state shows. `awaitingDecision` was reached
 * from a `proposing` turn, `awaitingPlanApproval` from a `planning` one; no
 * other state renders an artifact (spec §3.7 — beneath the Decision Card and
 * Plan Approval only).
 */
export function artifactStateFor(viewState: string): 'proposing' | 'planning' | null {
  switch (viewState) {
    case 'awaitingDecision':
      return 'proposing'
    case 'awaitingPlanApproval':
      return 'planning'
    default:
      return null
  }
}

/** The newest artifact whose `state` matches what `viewState` shows, or null. */
export function latestArtifactFor(artifacts: Artifact[], viewState: string): Artifact | null {
  const state = artifactStateFor(viewState)
  if (state === null) return null
  let best: Artifact | null = null
  for (const a of artifacts) {
    if (a.state !== state) continue
    if (best === null || a.createdAt > best.createdAt) best = a
  }
  return best
}
