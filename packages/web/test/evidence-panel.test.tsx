import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Aggregate } from '../src/api.js'
import { EvidencePanel } from '../src/evidence/EvidencePanel.js'
import { mockFetch } from './setup.js'

function evidence(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    commandId: 'test',
    kind: 'test',
    status: 'pass',
    headline: 'PHPUnit: 42 passed',
    summary: ['3 skipped'],
    artifactPath: null,
    decidedBy: null,
    createdAt: '2026-08-16T10:00:00.000Z',
    ...over,
  }
}

function agg(evidenceRows: unknown[], over: Record<string, unknown> = {}): Aggregate {
  return {
    objective: {
      id: 'o1',
      projectId: 'p1',
      title: 't',
      goalText: 'g',
      status: 'awaitingReview',
      worktreePath: '/tmp/wt',
      branchName: 'vadd/abc12345',
      baseSha: 'deadbeef',
      integrateAction: null,
      lowEnergy: false,
    },
    state: 'awaitingReview',
    tasks: [],
    decisions: [],
    evidence: evidenceRows,
    pendingClarification: null,
    lastAutoApproval: null,
    ...over,
  } as Aggregate
}

const noDiff = {
  'GET /api/objectives/o1/diff': {
    body: { files: [], totals: { files: 0, added: 0, removed: 0 } },
  },
}

describe('EvidencePanel', () => {
  it('shows a required row with its headline and summary', async () => {
    mockFetch(noDiff)
    render(<EvidencePanel aggregate={agg([evidence()])} onCommand={() => undefined} />)
    expect(screen.getByText('PHPUnit: 42 passed')).toBeTruthy()
    expect(screen.getByText(/3 skipped/)).toBeTruthy()
  })

  it('separates advisory rows from required ones', async () => {
    mockFetch(noDiff)
    render(
      <EvidencePanel
        aggregate={agg([
          evidence({ id: 'r', commandId: 'test', headline: 'required row' }),
          evidence({ id: 'a', commandId: null, headline: 'advisory row' }),
        ])}
        onCommand={() => undefined}
      />,
    )
    const required = screen.getByRole('region', { name: /required/i })
    expect(required.textContent).toContain('required row')
    expect(required.textContent).not.toContain('advisory row')
  })

  it('renders a warning in its own group', async () => {
    mockFetch(noDiff)
    render(
      <EvidencePanel
        aggregate={agg([evidence({ id: 'w', status: 'warn', headline: 'deprecation notice' })])}
        onCommand={() => undefined}
      />,
    )
    expect(screen.getByRole('region', { name: /warning/i }).textContent).toContain(
      'deprecation notice',
    )
  })

  it('labels a manually ticked row so it is never mistaken for a real run', async () => {
    mockFetch(noDiff)
    render(
      <EvidencePanel
        aggregate={agg([
          evidence({ id: 'c', kind: 'check', commandId: 'check-0', decidedBy: 'user' }),
        ])}
        onCommand={() => undefined}
      />,
    )
    expect(screen.getByText(/ticked by you/i)).toBeTruthy()
  })

  it('links to the artifact where one exists', async () => {
    mockFetch(noDiff)
    render(
      <EvidencePanel
        aggregate={agg([
          evidence({ id: 'e9', artifactPath: '/home/u/.vadd/artifacts/o1/r1/t.log' }),
        ])}
        onCommand={() => undefined}
      />,
    )
    expect(screen.getByRole('link', { name: /log/i }).getAttribute('href')).toBe(
      '/api/evidence/e9/artifact',
    )
  })

  it('offers no artifact link where there is none', async () => {
    mockFetch(noDiff)
    render(<EvidencePanel aggregate={agg([evidence()])} onCommand={() => undefined} />)
    expect(screen.queryByRole('link', { name: /log/i })).toBeNull()
  })

  it('ticks an unsatisfied check', async () => {
    mockFetch(noDiff)
    const sent: unknown[] = []
    render(
      <EvidencePanel
        aggregate={agg([
          evidence({
            id: 'c',
            kind: 'check',
            commandId: 'check-0',
            status: 'fail',
            headline: 'Looks right in the UI',
          }),
        ])}
        onCommand={(b) => sent.push(b)}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: /Looks right in the UI/ }))
    expect(sent).toEqual([{ type: 'tick_check', checkId: 'check-0', satisfied: true }])
  })

  it('unticks a satisfied check, superseding rather than deleting', async () => {
    mockFetch(noDiff)
    const sent: unknown[] = []
    render(
      <EvidencePanel
        aggregate={agg([
          evidence({
            id: 'c',
            kind: 'check',
            commandId: 'check-0',
            status: 'pass',
            headline: 'Looks right',
          }),
        ])}
        onCommand={(b) => sent.push(b)}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: /Looks right/ }))
    expect(sent).toEqual([{ type: 'tick_check', checkId: 'check-0', satisfied: false }])
  })

  it('offers no tick control when read-only', async () => {
    mockFetch(noDiff)
    render(
      <EvidencePanel
        aggregate={agg([
          evidence({ id: 'c', kind: 'check', commandId: 'check-0', status: 'fail' }),
        ])}
        onCommand={() => undefined}
        readOnly
      />,
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('A11: badges a failing row as expected when its task declared it', async () => {
    const rows = [evidence({ id: 'e1', commandId: 'test', status: 'fail', taskId: 't1' })]
    const tasks = [
      {
        id: 't1',
        ord: 0,
        title: 'Write a failing test',
        description: 'repro',
        status: 'pending' as const,
        expectFailing: ['test'],
      },
    ]
    render(<EvidencePanel aggregate={agg(rows, { tasks })} onCommand={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/expected/i)).toBeTruthy())
  })

  it('A11: does NOT badge a failing row the current task did not declare', async () => {
    const rows = [evidence({ id: 'e1', commandId: 'lint', status: 'fail', taskId: 't1' })]
    const tasks = [
      {
        id: 't1',
        ord: 0,
        title: 'Write a failing test',
        description: 'repro',
        status: 'pending' as const,
        expectFailing: ['test'],
      },
    ]
    render(<EvidencePanel aggregate={agg(rows, { tasks })} onCommand={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('PHPUnit: 42 passed')).toBeTruthy())
    expect(screen.queryByText(/expected/i)).toBeNull()
  })
})

describe('DiffList inside the panel', () => {
  it('lists changed files with their counts, collapsed', async () => {
    mockFetch({
      'GET /api/objectives/o1/diff': {
        body: {
          files: [{ path: 'app/Auth.php', added: 12, removed: 3, committed: true, dirty: false }],
          totals: { files: 1, added: 12, removed: 3 },
        },
      },
    })
    render(<EvidencePanel aggregate={agg([])} onCommand={() => undefined} />)
    expect(await screen.findByText('app/Auth.php')).toBeTruthy()
    expect(screen.getByText(/\+12/)).toBeTruthy()
    expect(screen.getByText(/−3|-3/)).toBeTruthy()
    expect(screen.queryByTestId('file-diff')).toBeNull()
  })

  it('says "1 file changed", not "1 files changed"', async () => {
    mockFetch({
      'GET /api/objectives/o1/diff': {
        body: {
          files: [{ path: 'app/Auth.php', added: 12, removed: 3, committed: true, dirty: false }],
          totals: { files: 1, added: 12, removed: 3 },
        },
      },
    })
    render(<EvidencePanel aggregate={agg([])} onCommand={() => undefined} />)
    expect(await screen.findByText(/1 file changed/)).toBeTruthy()
  })

  it('fetches and shows a file diff on click, with real added/removed lines', async () => {
    const unifiedDiff = [
      'diff --git a/app/Auth.php b/app/Auth.php',
      'index 1111111..2222222 100644',
      '--- a/app/Auth.php',
      '+++ b/app/Auth.php',
      '@@ -1,3 +1,3 @@',
      ' function login() {',
      '-    return false;',
      '+    return true;',
      ' }',
      '',
    ].join('\n')

    mockFetch({
      'GET /api/objectives/o1/diff': () => ({
        body: {
          files: [{ path: 'app/Auth.php', added: 1, removed: 1, committed: true, dirty: false }],
          totals: { files: 1, added: 1, removed: 1 },
        },
      }),
      'GET /api/objectives/o1/diff?file=app%2FAuth.php': {
        body: unifiedDiff,
        contentType: 'text/plain',
      },
    })
    const { container } = render(<EvidencePanel aggregate={agg([])} onCommand={() => undefined} />)
    await userEvent.click(await screen.findByRole('button', { name: /app\/Auth.php/ }))
    await screen.findByTestId('file-diff')

    // Substring text alone would also pass against the old `<pre>{diffText}</pre>`
    // blob — assert on `react-diff-view`'s real per-line classes instead, which
    // only its own `Diff`/`Hunk` rendering can produce (verified directly
    // against the installed library's `UnifiedChange.tsx`: it applies
    // `diff-code-${type}` per row). A plain text dump has neither class.
    const deleted = container.querySelector('.diff-code-delete')
    const inserted = container.querySelector('.diff-code-insert')
    expect(deleted?.textContent).toContain('return false;')
    expect(inserted?.textContent).toContain('return true;')
    expect(deleted).not.toBe(inserted)
  })

  it('shows the fetch error instead of a blank panel when the file diff fails to load', async () => {
    mockFetch({
      'GET /api/objectives/o1/diff': () => ({
        body: {
          files: [{ path: 'app/Auth.php', added: 1, removed: 1, committed: true, dirty: false }],
          totals: { files: 1, added: 1, removed: 1 },
        },
      }),
      'GET /api/objectives/o1/diff?file=app%2FAuth.php': { status: 500, body: 'boom' },
    })
    render(<EvidencePanel aggregate={agg([])} onCommand={() => undefined} />)
    await userEvent.click(await screen.findByRole('button', { name: /app\/Auth.php/ }))
    expect(await screen.findByText(/Could not load diff/)).toBeTruthy()
    expect(screen.queryByTestId('file-diff')).toBeNull()
  })
})
