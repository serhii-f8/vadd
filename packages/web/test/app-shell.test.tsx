import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app/AppShell.js'
import { useProjects } from '../src/app/ProjectsContext.js'
import { ThemeProvider } from '../src/app/ThemeProvider.js'
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
  {
    id: 'p2',
    name: 'vadd',
    repoPath: '/var/www/vadd',
    config: {},
    agentKind: 'codex',
    createdAt: '2026-08-02T00:00:00.000Z',
  },
]

function Probe() {
  const { selected } = useProjects()
  return <span data-testid="selected">{selected?.name ?? 'none'}</span>
}

function renderShell(initial = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Probe />} />
            <Route path="/today" element={<p>today page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  })

  it('renders navigation to both destinations', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    expect(await screen.findByRole('link', { name: 'Objectives' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Today' })).toBeTruthy()
  })

  it('marks the active route', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell('/today')
    const today = await screen.findByRole('link', { name: 'Today' })
    expect(today.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Objectives' }).getAttribute('aria-current')).toBe(null)
  })

  it('defaults the selection to the first project', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    expect((await screen.findByTestId('selected')).textContent).toBe('flexpick.net')
  })

  it('honours ?project= over the default', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell('/?project=p2')
    expect((await screen.findByTestId('selected')).textContent).toBe('vadd')
  })

  it('renders the shell even when the project fetch fails', async () => {
    mockFetch({ 'GET /api/projects': { status: 500, body: { error: 'db is down' } } })
    renderShell()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Objectives' })).toBeTruthy()
  })

  it('disables New objective until a project exists', async () => {
    mockFetch({ 'GET /api/projects': { body: [] } })
    renderShell()
    const button = await screen.findByRole('button', { name: /New objective/ })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('enables New objective once a project exists', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    const button = await screen.findByRole('button', { name: /New objective/ })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('mounts the theme control', async () => {
    mockFetch({ 'GET /api/projects': { body: projects } })
    renderShell()
    expect(await screen.findByRole('button', { name: /Theme:/ })).toBeTruthy()
  })
})
