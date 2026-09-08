import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { NODE_HEIGHT } from '../src/map/layout-objectives.js'
import { QuestMap } from '../src/map/QuestMap.js'
import { mockFetch } from './setup.js'

const objective = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  projectId: 'p1',
  title: 'Fix the login redirect',
  status: 'executing',
  worktreePath: null,
  branchName: null,
  integrateAction: null,
  updatedAt: '2026-08-22T10:00:00.000Z',
  verifiedCount: 1,
  totalCount: 3,
  ...over,
})

function renderMap() {
  return render(
    <MemoryRouter>
      <ProjectsProvider>
        <QuestMap />
      </ProjectsProvider>
    </MemoryRouter>,
  )
}

describe('QuestMap', () => {
  it('renders a node for each objective, showing its title and fraction', async () => {
    mockFetch({
      'GET /api/projects': { body: [] },
      'GET /api/objectives': { body: [objective()] },
    })
    renderMap()
    expect(await screen.findByText('Fix the login redirect')).toBeTruthy()
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('links a node to its Focus View', async () => {
    mockFetch({
      'GET /api/projects': { body: [] },
      'GET /api/objectives': { body: [objective()] },
    })
    renderMap()
    // Reached through the title rather than by role/name: React Flow marks a
    // node `visibility: hidden` until it has measured it, and jsdom's
    // `getBoundingClientRect` always reports zeros, so no node is ever measured
    // here — stub or no stub. That hides the anchor from role queries and
    // empties its computed accessible name, both of which are jsdom artifacts.
    // What the test actually cares about — the title sits inside a real
    // `<Link>` pointing at this objective's Focus View — is asserted directly.
    const title = await screen.findByText('Fix the login redirect')
    expect(title.closest('a')?.getAttribute('href')).toBe('/o/o1')
  })

  it('badges a discarded objective the same way the board does', async () => {
    mockFetch({
      'GET /api/projects': { body: [] },
      'GET /api/objectives': {
        body: [objective({ status: 'done', integrateAction: 'discard' })],
      },
    })
    renderMap()
    expect(await screen.findByText(/discard/)).toBeTruthy()
  })

  it('says so plainly when there are none', async () => {
    mockFetch({ 'GET /api/projects': { body: [] }, 'GET /api/objectives': { body: [] } })
    renderMap()
    expect(await screen.findByText(/No objectives yet/)).toBeTruthy()
  })

  it('shows the server error rather than an empty canvas', async () => {
    mockFetch({
      'GET /api/projects': { body: [] },
      'GET /api/objectives': { status: 500, body: { error: 'boom' } },
    })
    renderMap()
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('boom')
  })
})

it('names its five columns, so the layout means something', async () => {
  // Seen in a browser on 2026-08-25, the first render of /map ever: five
  // status columns with nothing naming any of them. With one column populated
  // — the common case — you cannot tell what the layout is sorted by at all.
  mockFetch({
    'GET /api/projects': { body: [] },
    'GET /api/objectives': { body: [objective()] },
  })
  renderMap()
  const header = await screen.findByRole('list', { name: /columns/i })
  const labels = within(header)
    .getAllByRole('listitem')
    .map((li) => li.textContent)
  expect(labels).toEqual(['Idle', 'Working', 'Needs you', 'Done', 'Failed'])
})

/**
 * The canvas positions nodes on a fixed pitch, so the card must not be free to
 * size itself: an investigation objective's chip row wraps to a second line and
 * measured 116px in Chrome against the 96px pitch this shipped with, covering
 * 20px of the node below. Asserting the card carries `NODE_HEIGHT` is what
 * makes the two constants one fact rather than two that happened to agree.
 */
describe('QuestMap node height', () => {
  it('pins every card to NODE_HEIGHT, whatever its chips wrap to', async () => {
    mockFetch({
      'GET /api/projects': { body: [] },
      'GET /api/objectives': {
        body: [objective({ mode: 'investigation', status: 'exploring' })],
      },
    })
    renderMap()
    const title = await screen.findByText('Fix the login redirect')
    const card = title.closest('div[style]') as HTMLElement | null
    expect(card?.style.height).toBe(`${NODE_HEIGHT}px`)
  })
})
