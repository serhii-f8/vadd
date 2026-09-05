import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLiveObjectives } from '../src/app/useLiveObjectives.js'
import { FakeEventSource, mockFetch } from './setup.js'

function Probe({ projectId }: { projectId: string | null }) {
  const { objectives, connected } = useLiveObjectives(projectId)
  return (
    <span data-testid="p">{`${objectives?.length ?? 'none'}:${connected ? 'live' : 'off'}`}</span>
  )
}

const row = (id: string) => ({
  id,
  projectId: 'p1',
  title: id,
  status: 'executing',
  worktreePath: null,
  branchName: null,
  integrateAction: null,
  verifiedCount: 0,
  totalCount: 1,
})

const listCalls = (calls: Array<{ url: string }>) =>
  calls.filter((c) => c.url.includes('/api/objectives'))

describe('useLiveObjectives', () => {
  it('fetches the project list once and opens an unscoped stream', async () => {
    const { calls } = mockFetch({ 'GET /api/objectives': { body: [row('a')] } })
    render(<Probe projectId="p1" />)
    expect((await screen.findByTestId('p')).textContent).toBe('1:off')
    expect(listCalls(calls)).toHaveLength(1)
    expect(calls[0]?.url).toContain('projectId=p1')
    expect(FakeEventSource.instances[0]?.url).toBe('/api/events')
  })

  /**
   * Spec §7: the stream is a change signal. Two events in quick succession
   * cost one refetch, and the payload is never read into state.
   */
  it('refetches on an event, debounced', async () => {
    vi.useFakeTimers()
    try {
      let rows = [row('a')]
      const { calls } = mockFetch({ 'GET /api/objectives': () => ({ body: rows }) })
      render(<Probe projectId="p1" />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      rows = [row('a'), row('b')]
      act(() => {
        FakeEventSource.instances[0]?.push({ id: 1, type: 'agent_event', payload: { x: 1 } })
        FakeEventSource.instances[0]?.push({ id: 2, type: 'agent_event', payload: { x: 2 } })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(listCalls(calls)).toHaveLength(2)
      expect(screen.getByTestId('p').textContent).toBe('2:live')
    } finally {
      vi.useRealTimers()
    }
  })

  it('refetches on window focus', async () => {
    const { calls } = mockFetch({ 'GET /api/objectives': { body: [] } })
    render(<Probe projectId="p1" />)
    await screen.findByTestId('p')
    await waitFor(() => expect(listCalls(calls)).toHaveLength(1))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(listCalls(calls)).toHaveLength(2))
  })

  it('fetches nothing and opens no stream without a project', async () => {
    const { calls } = mockFetch({})
    render(<Probe projectId={null} />)
    expect((await screen.findByTestId('p')).textContent).toBe('none:off')
    expect(calls).toHaveLength(0)
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('closes the stream on unmount', async () => {
    mockFetch({ 'GET /api/objectives': { body: [] } })
    const view = render(<Probe projectId="p1" />)
    await screen.findByTestId('p')
    view.unmount()
    expect(FakeEventSource.instances[0]?.closed).toBe(true)
  })
})
