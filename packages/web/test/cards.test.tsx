import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CodeCard } from '../src/cards/CodeCard.js'
import { TableCard } from '../src/cards/TableCard.js'
import { TextCard } from '../src/cards/TextCard.js'

describe('TextCard', () => {
  it('renders the title, a role badge, and one paragraph per blank-line block', () => {
    render(
      <TextCard
        card={{ id: 'a', kind: 'text', title: 'Why a queue', role: 'note', body: 'One.\n\nTwo.' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Why a queue' })).toBeTruthy()
    expect(screen.getByText('note')).toBeTruthy()
    const ps = screen.getAllByText(/^(One|Two)\.$/)
    expect(ps).toHaveLength(2)
    expect(ps.every((p) => p.tagName === 'P')).toBe(true)
  })

  it('renders no role badge when role is absent', () => {
    render(<TextCard card={{ id: 'a', kind: 'text', title: 'T', body: 'b' }} />)
    expect(screen.queryByTestId('card-role')).toBeNull()
  })

  it('collapses to its title row and expands on click', async () => {
    render(
      <TextCard
        defaultCollapsed
        card={{ id: 'a', kind: 'text', title: 'T', body: 'Hidden body' }}
      />,
    )
    expect(screen.queryByText('Hidden body')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /show/i }))
    expect(screen.getByText('Hidden body')).toBeTruthy()
  })

  // Found by the browser pass (2026-09-02): toggling Low Energy Mode on an
  // objective whose Decision Card is already showing does not re-render the
  // route from scratch — `ArtifactBlock`'s already-mounted cards receive a
  // new `defaultCollapsed` prop, not a fresh mount. A collapse toggle backed
  // only by `useState(defaultCollapsed)` reads that prop once, at mount, and
  // never again, so a live Low Energy toggle had no visible effect at all on
  // any card already on screen — confirmed live before this test was written.
  it('collapses when defaultCollapsed flips from false to true after mount, without unmounting', () => {
    const card = { id: 'a', kind: 'text' as const, title: 'T', body: 'Visible body' }
    const { rerender } = render(<TextCard card={card} defaultCollapsed={false} />)
    expect(screen.getByText('Visible body')).toBeTruthy()
    rerender(<TextCard card={card} defaultCollapsed={true} />)
    expect(screen.queryByText('Visible body')).toBeNull()
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy()
  })

  it('expands when defaultCollapsed flips from true to false after mount (Low Energy toggled off)', () => {
    const card = { id: 'a', kind: 'text' as const, title: 'T', body: 'Visible body' }
    const { rerender } = render(<TextCard card={card} defaultCollapsed={true} />)
    expect(screen.queryByText('Visible body')).toBeNull()
    rerender(<TextCard card={card} defaultCollapsed={false} />)
    expect(screen.getByText('Visible body')).toBeTruthy()
  })
})

describe('TableCard', () => {
  it('renders a semantic table with headers and cells inside a scroll container', () => {
    render(
      <TableCard
        card={{
          id: 't',
          kind: 'table',
          title: 'Costs',
          columns: ['', 'Queue', 'Inline'],
          rows: [
            ['Moving parts', 'Worker', 'None'],
            ['Timeout', 'None', 'Past 30s'],
          ],
        }}
      />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3)
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('Past 30s')).toBeTruthy()
    expect(table.parentElement?.className).toMatch(/overflow-x-auto/)
  })
})

describe('CodeCard', () => {
  it('renders the code in a pre, preserving newlines, with language and caption on one line', () => {
    render(
      <CodeCard
        card={{
          id: 'c',
          kind: 'code',
          title: 'Job row',
          language: 'ts',
          code: 'type Job = {\n  id: string\n}',
          caption: 'Two fields',
        }}
      />,
    )
    const pre = screen.getByText(/type Job/).closest('pre')
    expect(pre?.textContent).toBe('type Job = {\n  id: string\n}')
    expect(screen.getByText(/ts · Two fields/)).toBeTruthy()
  })

  it('shows only the language when there is no caption', () => {
    render(<CodeCard card={{ id: 'c', kind: 'code', title: 'T', language: 'sh', code: 'ls' }} />)
    expect(screen.getByText('sh')).toBeTruthy()
  })
})
