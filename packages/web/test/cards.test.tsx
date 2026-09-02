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
