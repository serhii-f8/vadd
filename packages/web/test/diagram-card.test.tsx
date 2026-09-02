import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` is hoisted above every other statement, so the fns it closes over
// must be hoisted too or the factory sees them before initialisation.
const { renderMock, initializeMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  initializeMock: vi.fn(),
}))
vi.mock('mermaid', () => ({
  default: { initialize: initializeMock, render: renderMock },
}))

import { DiagramCard } from '../src/cards/DiagramCard.js'

const card = {
  id: 'flow',
  kind: 'diagram' as const,
  title: 'Where the export runs',
  notation: 'mermaid' as const,
  source: 'flowchart LR\n  A --> B',
  caption: 'One new process',
}

describe('DiagramCard', () => {
  beforeEach(() => {
    renderMock.mockReset()
    initializeMock.mockReset()
    document.documentElement.classList.remove('dark')
  })

  it('renders the SVG mermaid returns, in the light theme by default', async () => {
    renderMock.mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"><title>ok</title></svg>' })
    render(<DiagramCard card={card} />)
    expect(await screen.findByTestId('mermaid-svg')).toBeTruthy()
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }),
    )
    expect(screen.getByText('One new process')).toBeTruthy()
  })

  it('uses the dark mermaid theme when the document carries the dark class', async () => {
    document.documentElement.classList.add('dark')
    renderMock.mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' })
    render(<DiagramCard card={card} />)
    await screen.findByTestId('mermaid-svg')
    expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }))
  })

  it('falls back to the source as code with the error as caption — never a blank', async () => {
    renderMock.mockRejectedValue(new Error('Parse error on line 2'))
    render(<DiagramCard card={card} />)
    expect(
      await screen.findByText(/mermaid · Diagram failed to render: Parse error on line 2/),
    ).toBeTruthy()
    expect(screen.getByText(/flowchart LR/)).toBeTruthy()
  })
})
