import type { ReactNode } from 'react'

/**
 * A titled card for one of the console's topology lists. `tone="attention"`
 * rings it amber — the strays section is the one thing on the page that
 * names a leak, and it should not look like the branches list beside it.
 */
export function TopologyPanel({
  title,
  count,
  tone = 'default',
  action,
  children,
}: {
  title: ReactNode
  count?: number
  tone?: 'default' | 'attention'
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      className={`flex flex-col rounded-xl bg-card ring-1 ${
        tone === 'attention' ? 'ring-status-attention/60' : 'ring-foreground/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-1.5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {title}
          {count !== undefined && (
            <span className="font-normal text-muted-foreground">{count}</span>
          )}
        </h2>
        {action}
      </div>
      <div className="px-1.5 pb-1.5">{children}</div>
    </section>
  )
}
