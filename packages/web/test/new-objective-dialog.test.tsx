import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProjectsProvider } from '../src/app/ProjectsContext.js'
import { NewObjectiveDialog } from '../src/objectives/NewObjectiveDialog.js'
import { mockFetch } from './setup.js'

const projects = [
  {
    id: 'p1',
    name: 'flexpick.net',
    repoPath: '/var/www/flexpick',
    config: {},
    agentKind: 'claude-code',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]
const created = { id: 'o9', projectId: 'p1', title: 'Fix it', status: 'idle' }

async function renderDialog() {
  render(
    <MemoryRouter>
      <ProjectsProvider>
        <NewObjectiveDialog open onOpenChange={() => undefined} />
      </ProjectsProvider>
    </MemoryRouter>,
  )
  await screen.findByLabelText('Title')
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Title'), 'Fix the rounding')
  await userEvent.type(
    screen.getByLabelText('Goal'),
    'Totals are off by a cent on multi-item carts.',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Create objective' }))
}

describe('NewObjectiveDialog', () => {
  it('defaults to standard mode', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'POST /api/projects/p1/objectives': { status: 201, body: created },
    })
    await renderDialog()
    await fillAndSubmit()
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toEqual({
      title: 'Fix the rounding',
      goalText: 'Totals are off by a cent on multi-item carts.',
      mode: 'standard',
    })
  })

  it('sends fastfix when chosen', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'POST /api/projects/p1/objectives': { status: 201, body: created },
    })
    await renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: /Fast Fix/ }))
    await fillAndSubmit()
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')
    expect((post?.body as { mode: string } | undefined)?.mode).toBe('fastfix')
  })

  /**
   * The regression test for the finding this whole plan exists to close:
   * `api.createObjective` had no `mode` parameter, so A15's investigation
   * workflow could not be created from a browser at all.
   */
  it('sends investigation when chosen', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'POST /api/projects/p1/objectives': { status: 201, body: created },
    })
    await renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: /Investigation/ }))
    await fillAndSubmit()
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')
    expect((post?.body as { mode: string } | undefined)?.mode).toBe('investigation')
  })

  it('does not submit without a title', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'POST /api/projects/p1/objectives': { status: 201, body: created },
    })
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Goal'), 'Something')
    await userEvent.click(screen.getByRole('button', { name: 'Create objective' }))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('does not submit without a goal', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'POST /api/projects/p1/objectives': { status: 201, body: created },
    })
    await renderDialog()
    await userEvent.type(screen.getByLabelText('Title'), 'Something')
    await userEvent.click(screen.getByRole('button', { name: 'Create objective' }))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('surfaces a server refusal', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'POST /api/projects/p1/objectives': {
        status: 400,
        body: { error: 'No verification spec could be resolved' },
      },
    })
    await renderDialog()
    await fillAndSubmit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No verification spec')
  })

  /**
   * Both dialogs are mounted unconditionally in AppShell so Radix can animate
   * the close, which means the component instance never unmounts and its
   * `useState` persists across open/close cycles. Without a reset, a failed
   * submit leaves a stale error Alert showing the next time the dialog opens,
   * above a blank form — the same defect NewProjectDialog already fixed.
   */
  it('resets error and fields when reopened after a failed submit', async () => {
    mockFetch({
      'GET /api/projects': { body: projects },
      'POST /api/projects/p1/objectives': {
        status: 400,
        body: { error: 'No verification spec could be resolved' },
      },
    })
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <ProjectsProvider>
          <NewObjectiveDialog open onOpenChange={onOpenChange} />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    await screen.findByLabelText('Title')
    await fillAndSubmit()
    await screen.findByRole('alert')

    // Close, then reopen — same mounted instance, matching AppShell's
    // unconditional-mount pattern.
    rerender(
      <MemoryRouter>
        <ProjectsProvider>
          <NewObjectiveDialog open={false} onOpenChange={onOpenChange} />
        </ProjectsProvider>
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter>
        <ProjectsProvider>
          <NewObjectiveDialog open onOpenChange={onOpenChange} />
        </ProjectsProvider>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('')
  })
})

describe('NewObjectiveDialog with a seed', () => {
  it('pre-fills title and a recap goal from the continuation-seed route, and hides the project picker', async () => {
    // Two registered projects, so a passing "hides the project picker" assertion
    // is actually proving something: without the seed gate this dialog would
    // show the picker (the pre-existing behavior below already covers
    // `projects.length <= 1`).
    const twoProjects = [
      ...projects,
      {
        id: 'p2',
        name: 'another-repo',
        repoPath: '/var/www/another',
        config: {},
        agentKind: 'claude-code',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]
    const { calls } = mockFetch({
      'GET /api/projects': { body: twoProjects },
      'GET /api/objectives/prior-1/continuation-seed': {
        body: {
          projectId: 'p1',
          title: 'Fix rounding',
          goalText: 'Totals are a cent off',
          status: 'done',
          lastClaim: 'Fixed the rounding bug',
          verifiedCount: 2,
          totalCount: 2,
        },
      },
      'POST /api/projects/p1/objectives': { status: 201, body: { id: 'new-1' } },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <NewObjectiveDialog
            open
            onOpenChange={() => undefined}
            seed={{ continuedFromId: 'prior-1' }}
          />
        </ProjectsProvider>
      </MemoryRouter>,
    )

    const title = await screen.findByLabelText('Title')
    await waitFor(() => expect((title as HTMLInputElement).value).toBe('Fix rounding'))
    const goal = screen.getByLabelText('Goal') as HTMLTextAreaElement
    expect(goal.value).toContain('Totals are a cent off')
    expect(goal.value).toContain('Fixed the rounding bug')
    expect(screen.queryByLabelText('Project')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Create objective' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        title: 'Fix rounding',
        goalText: goal.value,
        mode: 'standard',
        continuedFromId: 'prior-1',
      }),
    )
  })

  it('does not double a sentence-ending period when the prior claim already carries one', async () => {
    // A real `task_result.claim` is agent-authored free text and, unlike the
    // no-period example in `execute-task.md`, often ends in its own full
    // stop — found live in this task's own browser pass, where a seeded
    // claim ending in "." rendered as "..." before "Final claim:"'s own
    // trailing period.
    mockFetch({
      'GET /api/objectives/prior-1/continuation-seed': {
        body: {
          projectId: 'p1',
          title: 'Fix rounding',
          goalText: 'Totals are a cent off',
          status: 'done',
          lastClaim: 'Fixed the rounding bug.',
          verifiedCount: 1,
          totalCount: 1,
        },
      },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <NewObjectiveDialog
            open
            onOpenChange={() => undefined}
            seed={{ continuedFromId: 'prior-1' }}
          />
        </ProjectsProvider>
      </MemoryRouter>,
    )

    const goal = (await screen.findByLabelText('Goal')) as HTMLTextAreaElement
    await waitFor(() => expect(goal.value).toContain('Fixed the rounding bug.'))
    expect(goal.value).not.toContain('Fixed the rounding bug..')
  })

  /**
   * `target = projectId ?? selectedId` silently falls back to whatever
   * project happens to be selected in the sidebar when the seed fetch
   * hasn't resolved `projectId`. Without the guard in `submit()`, a user who
   * doesn't notice the error alert — and, as here, types a title/goal by
   * hand anyway — could create the continuation in the wrong project.
   */
  it('refuses to submit when the continuation-seed fetch fails, even with a project selected in the sidebar', async () => {
    const { calls } = mockFetch({
      'GET /api/projects': { body: projects },
      'GET /api/objectives/prior-1/continuation-seed': {
        status: 404,
        body: { error: 'Objective not found' },
      },
    })
    render(
      <MemoryRouter>
        <ProjectsProvider>
          <NewObjectiveDialog
            open
            onOpenChange={() => undefined}
            seed={{ continuedFromId: 'prior-1' }}
          />
        </ProjectsProvider>
      </MemoryRouter>,
    )

    await screen.findByRole('alert')
    await userEvent.type(screen.getByLabelText('Title'), 'Follow-up')
    await userEvent.type(
      screen.getByLabelText('Goal'),
      'Whatever the sidebar project happens to be.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create objective' }))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
