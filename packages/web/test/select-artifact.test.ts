import { expect, test } from 'vitest'
import type { Artifact } from '../src/api.js'
import { artifactStateFor, latestArtifactFor } from '../src/cards/select-artifact.js'

const art = (id: string, state: string, createdAt: string): Artifact => ({
  id,
  state,
  createdAt,
  cards: [{ id: 'c', kind: 'text', title: 'T', body: 'b' }],
})

test('maps the two waiting states to the turn that produced their artifact', () => {
  expect(artifactStateFor('awaitingDecision')).toBe('proposing')
  expect(artifactStateFor('awaitingPlanApproval')).toBe('planning')
  for (const s of ['clarifying', 'executing', 'awaitingReview', 'done', 'idle']) {
    expect(artifactStateFor(s), s).toBeNull()
  }
})

test('picks the newest artifact of the matching state', () => {
  const list = [
    art('p-old', 'proposing', '2026-09-02T10:00:00.000Z'),
    art('plan', 'planning', '2026-09-02T10:07:00.000Z'),
    art('p-new', 'proposing', '2026-09-02T10:05:00.000Z'),
  ]
  expect(latestArtifactFor(list, 'awaitingDecision')?.id).toBe('p-new')
  expect(latestArtifactFor(list, 'awaitingPlanApproval')?.id).toBe('plan')
})

test('returns null when nothing matches, or the state has no artifact', () => {
  expect(latestArtifactFor([], 'awaitingDecision')).toBeNull()
  expect(
    latestArtifactFor([art('x', 'planning', '2026-09-02T10:00:00.000Z')], 'awaitingDecision'),
  ).toBeNull()
  expect(
    latestArtifactFor([art('x', 'proposing', '2026-09-02T10:00:00.000Z')], 'executing'),
  ).toBeNull()
})
