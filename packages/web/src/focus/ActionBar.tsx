import type { ReactNode } from 'react'

/**
 * The primary element's actions, pinned to the bottom of the viewport while
 * its content scrolls: four long decision options or eight plan rows must
 * never push Approve out of reach. Negative margins let it span the content
 * column's padding.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center gap-2 border-t border-border bg-background/90 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
      {children}
    </div>
  )
}
