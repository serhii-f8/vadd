import { render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { FakeEventSource, mockFetch } from './setup.js'

function Probe() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const es = new EventSource('/api/events?objectiveId=o1')
    es.onmessage = () => setN((prev) => prev + 1)
    return () => es.close()
  }, [])
  return <div data-testid="count">{n}</div>
}

describe('web test harness', () => {
  it('renders React into jsdom', () => {
    render(<div data-testid="hello">hi</div>)
    expect(screen.getByTestId('hello').textContent).toBe('hi')
  })

  it('gives a component a fake EventSource a test can push into', async () => {
    render(<Probe />)
    const es = FakeEventSource.instances[0]
    expect(es?.url).toContain('objectiveId=o1')
    es?.push({ id: 1, type: 'status' })
    expect((await screen.findByTestId('count')).textContent).toBe('1')
  })

  it('answers fetch from a route table and records the call', async () => {
    const { calls } = mockFetch({ 'GET /api/objectives/o1': { body: { state: 'idle' } } })
    const res = await fetch('/api/objectives/o1')
    expect(await res.json()).toEqual({ state: 'idle' })
    expect(calls).toEqual([{ method: 'GET', url: '/api/objectives/o1', body: undefined }])
  })

  it('fails loudly on an unrouted fetch', async () => {
    mockFetch({})
    await expect(fetch('/api/nope')).rejects.toThrow('No mock route')
  })
})
