import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../src/components/ui/collapsible.js'
import { Progress } from '../src/components/ui/progress.js'
import { Sheet, SheetContent, SheetTitle } from '../src/components/ui/sheet.js'
import { Switch } from '../src/components/ui/switch.js'

describe('Switch', () => {
  it('is a switch that reports its next value', async () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onChange} aria-label="Low Energy" />)
    const sw = screen.getByRole('switch', { name: 'Low Energy' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Progress', () => {
  it('exposes value and max to assistive technology', () => {
    render(<Progress value={2} max={8} aria-label="Plan progress" />)
    const bar = screen.getByRole('progressbar', { name: 'Plan progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('2')
    expect(bar.getAttribute('aria-valuemax')).toBe('8')
  })

  it('treats an empty plan as zero rather than dividing by it', () => {
    render(<Progress value={0} max={0} aria-label="Plan progress" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
  })
})

describe('Sheet', () => {
  it('renders its content only while open', async () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="left">
              <SheetTitle>Navigation</SheetTitle>
              <p>drawer body</p>
            </SheetContent>
          </Sheet>
        </>
      )
    }
    render(<Host />)
    expect(screen.queryByText('drawer body')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(await screen.findByText('drawer body')).toBeTruthy()
  })
})

describe('Collapsible', () => {
  it('hides its content until opened', async () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Project memory</CollapsibleTrigger>
        <CollapsibleContent>two notes</CollapsibleContent>
      </Collapsible>,
    )
    expect(screen.queryByText('two notes')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Project memory' }))
    expect(screen.getByText('two notes')).toBeTruthy()
  })
})
