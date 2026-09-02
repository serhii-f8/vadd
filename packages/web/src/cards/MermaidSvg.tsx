import mermaid from 'mermaid'
import { useEffect, useRef, useState } from 'react'

/** Whether `ThemeProvider` has put the `dark` class on the document. */
function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * The chunk that actually imports `mermaid` — loaded through `React.lazy` by
 * `DiagramCard` so the main bundle never pays for it (the `DiffViewer`
 * pattern). Default export because `lazy()` wants one.
 *
 * Theme follows the document's `dark` class through a `MutationObserver`
 * rather than `useTheme()`: under the `system` setting the OS can flip while
 * this is mounted, and the class is the one signal `ThemeProvider` updates
 * for that; it also keeps this component mountable outside the provider.
 *
 * The SVG is inserted through `DOMParser` + `replaceChildren`, not
 * `dangerouslySetInnerHTML` (Biome's recommended rules refuse it); with
 * `securityLevel: 'strict'` mermaid has already sanitised the output.
 */
export default function MermaidSvg({
  id,
  source,
  onError,
}: {
  id: string
  source: string
  onError: (message: string) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const [dark, setDark] = useState(isDark)

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
    })
    // Ids must be unique per render or mermaid reuses a stale element.
    const renderId = `vadd-mermaid-${id}-${dark ? 'dark' : 'light'}-${Date.now()}`
    mermaid
      .render(renderId, source)
      .then(({ svg }) => {
        if (cancelled || host.current === null) return
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        const root = doc.documentElement
        if (root.nodeName === 'parsererror') throw new Error('mermaid returned invalid SVG')
        host.current.replaceChildren(root)
      })
      .catch((err: unknown) => {
        if (!cancelled) onError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [id, source, dark, onError])

  return <div ref={host} className="overflow-x-auto [&>svg]:max-w-full" />
}
