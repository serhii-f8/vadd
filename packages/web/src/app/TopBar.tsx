import { Menu, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjects } from './ProjectsContext.js'

/**
 * The narrowest layout's chrome: a 48px bar with the drawer trigger, the
 * project name, and New objective. Everything else lives in the drawer.
 * Graceful narrowing of the desktop app, not a phone design (spec §11).
 */
export function TopBar({
  onOpenMenu,
  onNewObjective,
}: {
  onOpenMenu: () => void
  onNewObjective: () => void
}) {
  const { projects, selected } = useProjects()
  const hasProjects = projects !== null && projects.length > 0
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2">
      <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={onOpenMenu}>
        <Menu />
      </Button>
      <span className="text-sm font-semibold tracking-tight">VADD</span>
      {selected !== null && (
        <span className="min-w-0 truncate text-sm text-muted-foreground">/ {selected.name}</span>
      )}
      <Button
        size="icon-sm"
        className="ml-auto"
        aria-label="New objective"
        disabled={!hasProjects}
        onClick={onNewObjective}
      >
        <Plus />
      </Button>
    </header>
  )
}
