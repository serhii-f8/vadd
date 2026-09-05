import { FolderPlus, Plus } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { ObjectiveListRow } from '../api.js'
import type { ViewStateName } from '../focus/primary.js'
import { statusFor } from '../routes/stateColor.js'
import { NAV, navTo } from './nav.js'
import { ProjectSwitcher } from './ProjectSwitcher.js'
import { useProjects } from './ProjectsContext.js'
import { ThemeToggle } from './ThemeToggle.js'
import { WorkingNow } from './WorkingNow.js'

export type SidebarContentProps = {
  objectives: ObjectiveListRow[] | null
  /** Whether the live stream is connected — the dot beside the wordmark. */
  connected: boolean
  onNewObjective: () => void
  onAddProject: () => void
  /** Fired on every navigation, so a drawer can close itself. */
  onNavigate?: () => void
}

/**
 * The sidebar's body, rendered in two places: the sticky column at `xl` and
 * the drawer below it. One component, so the two cannot drift.
 */
export function SidebarContent({
  objectives,
  connected,
  onNewObjective,
  onAddProject,
  onNavigate,
}: SidebarContentProps) {
  const { projects, selectedId, error } = useProjects()
  const hasProjects = projects !== null && projects.length > 0
  const needsYou = (objectives ?? []).filter(
    (o) => statusFor(o.status as ViewStateName).tone === 'attention',
  ).length

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center justify-between px-2">
        <Link
          to={navTo('/', selectedId)}
          onClick={onNavigate}
          className="text-[15px] font-semibold tracking-tight"
        >
          VADD
        </Link>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${connected ? 'bg-status-done' : 'bg-status-idle'}`}
          />
          {connected ? 'Live' : 'Reconnecting'}
        </span>
      </div>

      <ProjectSwitcher />

      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={navTo(to, selectedId)}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm hover:no-underline ${
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
            {to === '/' && needsYou > 0 && (
              <Badge
                className="ml-auto bg-status-attention/15 text-foreground"
                aria-label={`${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you`}
              >
                {needsYou}
              </Badge>
            )}
          </NavLink>
        ))}
      </nav>

      <WorkingNow objectives={objectives} onNavigate={onNavigate} />

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-auto flex flex-col gap-1.5">
        <Button className="w-full justify-start" disabled={!hasProjects} onClick={onNewObjective}>
          <Plus />
          New objective
        </Button>
        <Button variant="ghost" className="w-full justify-start" onClick={onAddProject}>
          <FolderPlus />
          Add project
        </Button>
        <Separator className="my-1" />
        <div className="flex items-center justify-between">
          <ThemeToggle />
          <Link to="/debug" className="px-2 py-1 text-xs text-muted-foreground hover:underline">
            Debug
          </Link>
        </div>
      </div>
    </div>
  )
}
