import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

describe('openBrowser', () => {
  afterEach(() => {
    spawnMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('spawns the platform opener detached and unreferenced', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    spawnMock.mockReturnValue(child)

    const { openBrowser } = await import('../src/boot/open-browser.js')
    openBrowser('http://127.0.0.1:4319/')

    expect(spawnMock).toHaveBeenCalledWith('xdg-open', ['http://127.0.0.1:4319/'], {
      detached: true,
      stdio: 'ignore',
    })
    expect(child.unref).toHaveBeenCalled()
  })

  it('never throws even if spawn itself throws', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    spawnMock.mockImplementation(() => {
      throw new Error('no such command')
    })

    const { openBrowser } = await import('../src/boot/open-browser.js')
    expect(() => openBrowser('http://127.0.0.1:4319/')).not.toThrow()
  })

  it('survives an async spawn ENOENT without an unhandled error event', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    spawnMock.mockReturnValue(child)

    const { openBrowser } = await import('../src/boot/open-browser.js')
    expect(() => openBrowser('http://127.0.0.1:4319/')).not.toThrow()

    // spawn does not throw synchronously on ENOENT; it emits this async
    // 'error' event on the returned ChildProcess instead. With no listener
    // registered, EventEmitter re-throws it, crashing the process. Asserting
    // this emit doesn't throw proves openBrowser registered a listener.
    expect(() =>
      child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    ).not.toThrow()
  })
})
