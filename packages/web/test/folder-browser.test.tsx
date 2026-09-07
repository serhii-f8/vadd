import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FolderBrowser } from '../src/projects/FolderBrowser.js'
import { mockFetch } from './setup.js'

const home = {
  path: '/home/alice',
  parent: '/home',
  entries: [
    { name: 'projects', path: '/home/alice/projects', isGitRepo: false },
    { name: 'flexpick.net', path: '/home/alice/flexpick.net', isGitRepo: true },
  ],
}

describe('FolderBrowser', () => {
  it('lists entries at the default path on mount', async () => {
    mockFetch({ 'GET /api/fs/browse': { body: home } })
    render(<FolderBrowser onSelect={() => undefined} onClose={() => undefined} />)
    await screen.findByText('projects')
    expect(screen.getByText('flexpick.net').textContent).toBe('flexpick.net')
  })

  it('navigates into a directory on click', async () => {
    const nested = { path: '/home/alice/projects', parent: '/home/alice', entries: [] }
    mockFetch({
      'GET /api/fs/browse': { body: home },
      'GET /api/fs/browse?path=%2Fhome%2Falice%2Fprojects': { body: nested },
    })
    render(<FolderBrowser onSelect={() => undefined} onClose={() => undefined} />)
    await userEvent.click(await screen.findByText('projects'))
    await screen.findByText('/home/alice/projects')
  })

  it('navigates up via Up, and disables Up once there is no parent', async () => {
    const homeListing = { path: '/home', parent: null, entries: [] }
    mockFetch({
      'GET /api/fs/browse': { body: home },
      'GET /api/fs/browse?path=%2Fhome': { body: homeListing },
    })
    render(<FolderBrowser onSelect={() => undefined} onClose={() => undefined} />)
    await screen.findByText('projects')
    await userEvent.click(screen.getByRole('button', { name: /Up/ }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Up/ }) as HTMLButtonElement).disabled).toBe(true),
    )
  })

  it('selects the current path', async () => {
    mockFetch({ 'GET /api/fs/browse': { body: home } })
    const onSelect = vi.fn()
    render(<FolderBrowser onSelect={onSelect} onClose={() => undefined} />)
    await screen.findByText('projects')
    await userEvent.click(screen.getByRole('button', { name: 'Select this folder' }))
    expect(onSelect).toHaveBeenCalledWith('/home/alice')
  })

  it('closes on Cancel', async () => {
    mockFetch({ 'GET /api/fs/browse': { body: home } })
    const onClose = vi.fn()
    render(<FolderBrowser onSelect={() => undefined} onClose={onClose} />)
    await screen.findByText('projects')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces a fetch error rather than a blank list', async () => {
    mockFetch({
      'GET /api/fs/browse': { status: 400, body: { error: 'path must be absolute' } },
    })
    render(<FolderBrowser onSelect={() => undefined} onClose={() => undefined} />)
    const message = await screen.findByText('path must be absolute')
    expect(message.textContent).toBe('path must be absolute')
  })
})
