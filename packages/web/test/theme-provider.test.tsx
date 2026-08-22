import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from '../src/app/ThemeProvider.js'

/**
 * jsdom implements no `matchMedia` at all, so the provider — whose whole job is
 * reading `prefers-color-scheme` — would throw on mount without this. The
 * listener set is real, so a test can fire a change and assert the provider
 * re-resolves, which is the "OS flips at sunset" requirement.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }))
  return {
    fire: () => {
      for (const cb of listeners) cb()
    },
    listeners,
  }
}

function Probe() {
  const { theme, setTheme } = useTheme()
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        go dark
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        go light
      </button>
    </>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to system and follows a dark OS preference', () => {
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme').textContent).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('defaults to system and follows a light OS preference', () => {
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('an explicit dark choice beats a light OS preference, and persists', async () => {
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    await userEvent.click(screen.getByText('go dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('an explicit light choice beats a dark OS preference', async () => {
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    await userEvent.click(screen.getByText('go light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('reads a stored choice on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('re-resolves when the OS preference changes under system', () => {
    const mq = stubMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    // The OS flipped. Nothing re-rendered; only the media listener fired.
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    mq.fire()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('survives localStorage throwing, as it does in some privacy modes', () => {
    stubMatchMedia(false)
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() =>
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      ),
    ).not.toThrow()
    getItem.mockRestore()
  })
})
