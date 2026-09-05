import { Folder, Menu, Plus } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { NAV, navTo } from './nav.js'
import { useProjects } from './ProjectsContext.js'

/**
 * The `md`-to-`xl` layout: the same four destinations as icons with
 * tooltips, the project as a folder, and a menu button that opens the full
 * sidebar in a drawer for everything that needs words (switching project,
 * Working now, theme).
 */
export function IconRail({
  needsYou,
  onOpenMenu,
  onNewObjective,
}: {
  needsYou: number
  onOpenMenu: () => void
  onNewObjective: () => void
}) {
  const { projects, selected, selectedId } = useProjects()
  const hasProjects = projects !== null && projects.length > 0
  return (
    <TooltipProvider>
      <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-3">
        <span className="flex h-8 items-center text-sm font-semibold tracking-tight">VADD</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-lg"
              className="rounded-xl"
              aria-label={selected === null ? 'Open navigation' : `Project: ${selected.name}`}
              onClick={onOpenMenu}
            >
              <Folder />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{selected?.name ?? 'No project'}</TooltipContent>
        </Tooltip>
        <nav aria-label="Primary" className="mt-2 flex flex-col gap-1">
          {NAV.map(({ to, label, Icon }) => (
            <Tooltip key={to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={navTo(to, selectedId)}
                  end={to === '/'}
                  aria-label={label}
                  className={({ isActive }) =>
                    `relative flex size-10 items-center justify-center rounded-xl hover:no-underline ${
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`
                  }
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                  {to === '/' && needsYou > 0 && (
                    <Badge
                      className="absolute -top-1 -right-1 h-4 min-w-4 bg-status-attention/20 px-1 text-[10px] text-foreground"
                      aria-label={`${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you`}
                    >
                      {needsYou}
                    </Badge>
                  )}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                aria-label="New objective"
                disabled={!hasProjects}
                onClick={onNewObjective}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New objective</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={onOpenMenu}>
            <Menu />
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
