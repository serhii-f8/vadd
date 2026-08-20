import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FocusView } from '../src/routes/FocusView.js'
import { FakeEventSource, mockFetch } from './setup.js'

function aggregate(over: Record<string, unknown> = {}) {
  return {
    state: 'idle',
    tasks: [],
    decisions: [],
    evidence: [],
    lastAutoApproval: null,
    ...over,
    // `objective` is assigned last, deliberately after `...over`: `over` may
    // itself carry an `objective` key (every existing caller that overrides
    // a field on it does), and an object literal's later key always wins —
    // spreading `over` first and merging `objective` after is what makes the
    // merge below actually apply instead of being silently replaced by
    // whatever partial `over.objective` a caller passed.
    objective: {
      id: 'o1',
      projectId: 'p1',
      title: 'Fix the login redirect',
      goalText: 'g',
      status: 'idle',
      worktreePath: '/tmp/wt',
      branchName: 'vadd/abc12345',
      baseSha: 'deadbeef',
      integrateAction: null,
      lowEnergy: false,
      mode: 'standard',
      ...(over.objective as Record<string, unknown> | undefined),
    },
  }
}

function renderFocus() {
  return render(
    <MemoryRouter initialEntries={['/o/o1']}>
      <Routes>
        <Route path="/o/:id" element={<FocusView />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('FocusView mirroring (spec §7: no client-side transitions)', () => {
  it('refetches the aggregate on an SSE event and shows the new state', async () => {
    let state = 'planning'
    mockFetch({ 'GET /api/objectives/o1': () => ({ body: aggregate({ state }) }) })
    renderFocus()
    expect(await screen.findByText(/planning/)).toBeTruthy()

    state = 'awaitingPlanApproval'
    FakeEventSource.instances[0]?.push({ id: 1, objectiveId: 'o1', type: 'agent_event' })
    await waitFor(() => expect(screen.getByText(/awaitingPlanApproval/)).toBeTruthy())
  })

  it('opens the SSE stream scoped to this objective', async () => {
    mockFetch({ 'GET /api/objectives/o1': { body: aggregate() } })
    renderFocus()
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(FakeEventSource.instances[0]?.url).toContain('objectiveId=o1')
  })

  it('shows a refused command and does NOT advance the view', async () => {
    mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'executing' }) },
      'POST /api/objectives/o1/events': {
        status: 409,
        body: { error: 'Command "pause" is not accepted in state "executing"' },
      },
    })
    renderFocus()
    await screen.findByText(/executing/)
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('is not accepted in state'),
    )
    // The refusal is visible AND names the state, verbatim from the server —
    // the view mirrors the server, it does not predict it.
    expect(within(screen.getByRole('alert')).getByText(/executing/)).toBeTruthy()
  })

  it('clears the stream banner once the stream recovers', async () => {
    mockFetch({ 'GET /api/objectives/o1': { body: aggregate({ state: 'executing' }) } })
    renderFocus()
    await screen.findByText(/executing/)

    // `EventSource` reconnects natively, so a banner that outlives the blip is
    // a permanent lie about a connection that is fine.
    FakeEventSource.instances[0]?.onerror?.()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('SSE connection lost'),
    )

    FakeEventSource.instances[0]?.push({ id: 1, objectiveId: 'o1', type: 'agent_event' })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('FocusView primary element by state', () => {
  it('shows the decision options as a radio list in awaitingDecision', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [
            {
              id: 'd1',
              question: 'Which fix?',
              recommendedId: 'b',
              chosenId: null,
              options: [
                {
                  id: 'a',
                  label: 'Patch the guard',
                  pros: ['small'],
                  cons: ['narrow'],
                  reversibility: 'high',
                  verification: 'run the suite',
                },
                {
                  id: 'b',
                  label: 'Rework the middleware',
                  pros: ['general'],
                  cons: ['bigger'],
                  reversibility: 'medium',
                  verification: 'run the suite',
                },
              ],
            },
          ],
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText('Which fix?')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    // §4's only mandatory analysis field is always visible.
    expect(screen.getByText(/high/)).toBeTruthy()
    expect(screen.getByText(/medium/)).toBeTruthy()
  })

  it('preselects the recommended option', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [
            {
              id: 'd1',
              question: 'Which fix?',
              recommendedId: 'b',
              chosenId: null,
              options: [
                {
                  id: 'a',
                  label: 'A',
                  pros: [],
                  cons: [],
                  reversibility: 'high',
                  verification: 'v',
                },
                {
                  id: 'b',
                  label: 'B',
                  pros: [],
                  cons: [],
                  reversibility: 'low',
                  verification: 'v',
                },
              ],
            },
          ],
        }),
      },
    })
    renderFocus()
    const radios = await screen.findAllByRole('radio')
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true')
  })

  it('posts decide with the chosen option', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingDecision',
          decisions: [
            {
              id: 'd1',
              question: 'Which fix?',
              recommendedId: 'b',
              chosenId: null,
              options: [
                {
                  id: 'a',
                  label: 'A',
                  pros: [],
                  cons: [],
                  reversibility: 'high',
                  verification: 'v',
                },
                {
                  id: 'b',
                  label: 'B',
                  pros: [],
                  cons: [],
                  reversibility: 'low',
                  verification: 'v',
                },
              ],
            },
          ],
        }),
      },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('radio', { name: /A/ }))
    await userEvent.click(screen.getByRole('button', { name: /choose/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'decide',
      decisionId: 'd1',
      optionId: 'a',
    })
  })

  it('shows the plan as an editable list in awaitingPlanApproval', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'awaitingPlanApproval',
          tasks: [
            {
              id: 't1',
              ord: 0,
              title: 'Write the failing test',
              description: 'd',
              status: 'pending',
            },
            { id: 't2', ord: 1, title: 'Fix the guard', description: 'd', status: 'pending' },
          ],
        }),
      },
    })
    renderFocus()
    expect(await screen.findByDisplayValue('Write the failing test')).toBeTruthy()
    expect(screen.getByRole('button', { name: /approve plan/i })).toBeTruthy()
  })

  it('shows a live card with no log stream while the agent works', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'executing',
          tasks: [
            { id: 't1', ord: 0, title: 'Fix the guard', description: 'd', status: 'running' },
          ],
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText('Fix the guard')).toBeTruthy()
    expect(screen.queryByTestId('log-stream')).toBeNull()
  })

  it('offers the integration chooser only in integrating', async () => {
    mockFetch({ 'GET /api/objectives/o1': { body: aggregate({ state: 'integrating' }) } })
    renderFocus()
    for (const name of [/commit/i, /keep/i, /discard/i]) {
      expect(await screen.findByRole('button', { name })).toBeTruthy()
    }
  })

  it('hides Commit for an investigation-mode objective at integrating', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({ state: 'integrating', objective: { mode: 'investigation' } }),
      },
    })
    renderFocus()
    expect(await screen.findByRole('button', { name: /keep/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /commit/i })).toBeNull()
  })

  it('posts the chosen integration action', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'integrating' }) },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('button', { name: /^commit/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'integrate',
      action: 'commit',
    })
  })

  it('offers abandon, not the machine-less cancel, in the header', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'executing' }) },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('button', { name: /abandon/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ type: 'abandon' })
  })

  // Neither of these is a machine state: both come from the `objectives.status`
  // column the aggregate falls back to when no actor is live. Rendering nothing
  // (or throwing) would hide the setup log `setup_failed` exists to preserve.
  it('renders a setting-up element in creating rather than throwing', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'creating',
          objective: { ...aggregate().objective, status: 'creating' },
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText(/setting up/i)).toBeTruthy()
  })

  it('renders the failure evidence read-only in setup_failed', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'setup_failed',
          objective: { ...aggregate().objective, status: 'setup_failed' },
          evidence: [
            {
              id: 'e1',
              commandId: null,
              kind: 'build',
              status: 'fail',
              headline: 'composer install failed',
              summary: [],
              artifactPath: '/tmp/setup.log',
              decidedBy: null,
              createdAt: '2026-08-16T10:00:00.000Z',
            },
          ],
        }),
      },
      'GET /api/objectives/o1/diff': {
        body: { files: [], totals: { files: 0, added: 0, removed: 0 } },
      },
    })
    renderFocus()
    expect(await screen.findByText('composer install failed')).toBeTruthy()
  })

  it('shows the pending clarification and posts the typed answer', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'clarifying',
          pendingClarification: 'Which environment does the redirect break in?',
        }),
      },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    expect(await screen.findByText(/Which environment does the redirect break in\?/)).toBeTruthy()

    await userEvent.type(screen.getByRole('textbox'), 'staging')
    await userEvent.click(screen.getByRole('button', { name: /answer/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'answer_clarification',
      answer: 'staging',
    })
  })

  it('shows the outcome read-only in a terminal state', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'done',
          objective: { ...aggregate().objective, status: 'done', integrateAction: 'commit' },
        }),
      },
    })
    renderFocus()
    expect(await screen.findByText(/commit/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /abandon/i })).toBeNull()
  })
})

describe('FocusView: no header actions while setup runs', () => {
  it('offers neither Pause nor Abandon in creating', async () => {
    mockFetch({ 'GET /api/objectives/o1': { body: aggregate({ state: 'creating' }) } })
    renderFocus()
    // The setup element is what confirms the page rendered rather than threw.
    // Scoped to the heading: a bare /setting up|installing/ matches both it and
    // the body copy below it.
    expect(await screen.findByRole('heading', { name: /setting up/i })).toBeTruthy()
    // `runSetup` is fire-and-forget in the worktree Abandon would remove, and
    // it writes the status again when it finishes — so an Abandon here races a
    // running `composer install` and then has its `cancelled` overwritten.
    expect(screen.queryByRole('button', { name: /abandon/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull()
  })

  it('still offers them in a live state', async () => {
    mockFetch({ 'GET /api/objectives/o1': { body: aggregate({ state: 'executing' }) } })
    renderFocus()
    expect(await screen.findByRole('button', { name: /abandon/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /pause/i })).toBeTruthy()
  })
})

describe('FocusView: paused shows the evidence that paused it', () => {
  const redSet = [
    {
      id: 'e1',
      commandId: 'check-0',
      kind: 'check' as const,
      status: 'fail' as const,
      headline: 'Looks right in the UI',
      summary: [],
      artifactPath: null,
      decidedBy: null,
      createdAt: '2026-08-16T10:00:00.000Z',
    },
  ]

  it('renders the evidence panel alongside resume', async () => {
    mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'paused', evidence: redSet }) },
      'GET /api/objectives/o1/diff': { status: 409, body: { error: 'no worktree' } },
    })
    renderFocus()
    // A red set is exactly why `verifying` drops to `paused` — without the
    // panel the user cannot see which check failed, only that something did.
    expect(await screen.findByText('Looks right in the UI')).toBeTruthy()
    expect(screen.getByRole('button', { name: /resume/i })).toBeTruthy()
  })

  it('lets a check be ticked from paused, which is the only rescue path', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'paused', evidence: redSet }) },
      'GET /api/objectives/o1/diff': { status: 409, body: { error: 'no worktree' } },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Looks right in the UI/ }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      type: 'tick_check',
      checkId: 'check-0',
      satisfied: true,
    })
  })

  it('offers Roll back from paused when a plan exists', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'paused',
          evidence: redSet,
          tasks: [
            {
              id: 't1',
              ord: 0,
              title: 'A task',
              description: 'd',
              status: 'running',
              expectFailing: null,
            },
          ],
        }),
      },
      'GET /api/objectives/o1/diff': { status: 409, body: { error: 'no worktree' } },
      'POST /api/objectives/o1/events': { status: 202, body: { ok: true } },
    })
    renderFocus()
    await userEvent.click(await screen.findByRole('button', { name: /roll back/i }))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ type: 'rollback' })
  })

  it('does not offer Roll back from paused before any plan exists', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({ state: 'paused', evidence: redSet, tasks: [] }),
      },
      'GET /api/objectives/o1/diff': { status: 409, body: { error: 'no worktree' } },
    })
    renderFocus()
    await screen.findByRole('button', { name: /resume/i })
    expect(screen.queryByRole('button', { name: /roll back/i })).toBeNull()
  })

  it('keeps the panel read-only once terminal', async () => {
    mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'cancelled', evidence: redSet }) },
      'GET /api/objectives/o1/diff': { status: 409, body: { error: 'no worktree' } },
    })
    renderFocus()
    expect(await screen.findByText('Looks right in the UI')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

describe('Low Energy Mode (amendment A12)', () => {
  it('toggling the header control sends set_low_energy with the flipped value', async () => {
    const { calls } = mockFetch({
      'GET /api/objectives/o1': { body: aggregate({ state: 'executing' }) },
      'POST /api/objectives/o1/events': { body: { ok: true } },
    })
    renderFocus()
    await screen.findByText(/executing/)
    await userEvent.click(screen.getByRole('button', { name: /low energy/i }))
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'POST' && (c.body as { type?: string }).type === 'set_low_energy',
        ),
      ).toBe(true),
    )
    const sent = calls.find(
      (c) => c.method === 'POST' && (c.body as { type?: string }).type === 'set_low_energy',
    )
    expect(sent?.body).toEqual({ type: 'set_low_energy', value: true })
  })

  it('hides the secondary task strip while lowEnergy is on', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          objective: { lowEnergy: true },
          state: 'executing',
          tasks: [
            {
              id: 't1',
              ord: 0,
              title: 'A',
              description: '',
              status: 'running',
              expectFailing: null,
            },
          ],
        }),
      },
    })
    renderFocus()
    await screen.findByText(/executing/)
    expect(screen.queryByLabelText('Tasks')).toBeNull()
  })

  it('shows the secondary task strip while lowEnergy is off', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'executing',
          tasks: [
            {
              id: 't1',
              ord: 0,
              title: 'A',
              description: '',
              status: 'running',
              expectFailing: null,
            },
          ],
        }),
      },
    })
    renderFocus()
    await screen.findByText(/executing/)
    expect(screen.getByLabelText('Tasks')).toBeTruthy()
  })

  it('renders the auto-approval banner from the aggregate, not from the SSE payload', async () => {
    mockFetch({
      'GET /api/objectives/o1': {
        body: aggregate({
          state: 'integrating',
          lastAutoApproval: { kind: 'task', taskOrd: 0, at: '2026-08-18T00:00:00Z' },
        }),
      },
    })
    renderFocus()
    await screen.findByRole('status')
    expect(screen.getByRole('status').textContent).toMatch(/Good stopping point/i)
  })
})
