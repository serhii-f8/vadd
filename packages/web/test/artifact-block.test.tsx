import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Artifact } from '../src/api.js'
import { ArtifactBlock } from '../src/cards/ArtifactBlock.js'

const art = (id: string, state: string, createdAt: string, title = 'T'): Artifact => ({
  id,
  state,
  createdAt,
  cards: [
    { id: `${id}-text`, kind: 'text', title, body: `Body of ${id}` },
    {
      id: `${id}-table`,
      kind: 'table',
      title: 'Costs',
      columns: ['a', 'b'],
      rows: [['1', '2']],
    },
    { id: `${id}-code`, kind: 'code', title: 'Code', language: 'ts', code: 'x' },
  ],
})

describe('ArtifactBlock', () => {
  it('renders nothing at all when no artifact matches the state', () => {
    const { container } = render(
      <ArtifactBlock
        artifacts={[art('p', 'proposing', '2026-09-02T10:00:00.000Z')]}
        state="awaitingReview"
        lowEnergy={false}
      />,
    )
    // No jest-dom matchers in this project's web setup — assert on the DOM itself.
    expect(container.innerHTML).toBe('')
  })

  it('renders every card of the newest matching artifact, in order', () => {
    const list = [
      art('old', 'proposing', '2026-09-02T10:00:00.000Z', 'Old'),
      art('new', 'proposing', '2026-09-02T10:05:00.000Z', 'New'),
    ]
    render(<ArtifactBlock artifacts={list} state="awaitingDecision" lowEnergy={false} />)
    expect(screen.getByRole('region', { name: /supporting material/i })).toBeTruthy()
    expect(screen.getByText('Body of new')).toBeTruthy()
    expect(screen.queryByText('Body of old')).toBeNull()
    const kinds = [...document.querySelectorAll('[data-kind]')].map((el) =>
      el.getAttribute('data-kind'),
    )
    expect(kinds).toEqual(['text', 'table', 'code'])
  })

  it('collapses every card to its title row in Low Energy Mode', () => {
    render(
      <ArtifactBlock
        artifacts={[art('p', 'planning', '2026-09-02T10:00:00.000Z')]}
        state="awaitingPlanApproval"
        lowEnergy
      />,
    )
    expect(screen.getByText('T')).toBeTruthy()
    expect(screen.queryByText('Body of p')).toBeNull()
    expect(screen.getAllByRole('button', { name: /show/i })).toHaveLength(3)
  })
})
