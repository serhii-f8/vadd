import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query currently matches, kept current.
 *
 * `false` when `matchMedia` is unavailable (an old jsdom, a headless
 * capture): the layouts that read this treat `false` as the narrowest case,
 * which still renders everything, just inside a drawer.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    try {
      return window.matchMedia(query).matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(query)
    } catch {
      return
    }
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return matches
}
