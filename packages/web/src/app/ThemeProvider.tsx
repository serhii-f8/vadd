import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'vadd.theme'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * Every `localStorage` access is guarded. A browser in a privacy mode throws
 * on the property access itself, not just on write, and a theme preference is
 * never worth taking the whole app down for.
 */
export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

type ThemeContextValue = { theme: Theme; setTheme: (t: Theme) => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx === null) throw new Error('useTheme must be used inside a ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    // Re-read `mq.matches` on every call rather than closing over it: under
    // `system` the OS can flip while this effect is still mounted, and that
    // change event is the only signal we get.
    const sync = () => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Preference is lost on reload; the session still honours the choice.
    }
    setThemeState(next)
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
