import {
  ArrowLeft,
  BatteryLow,
  Check,
  Copy,
  FileText,
  GitBranch,
  MoreHorizontal,
  Pause,
  Search,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import type { Aggregate } from '../api.js'
import { statusFor } from '../routes/stateColor.js'
import { AbandonDialog } from './AbandonButton.js'
import type { ViewStateName } from './primary.js'
import { stateLabel } from './state-label.js'

/** Static so Tailwind can see every class; a template literal would generate none of them. */
const TONE_BG = {
  idle: 'bg-status-idle/15',
  active: 'bg-status-active/15',
  attention: 'bg-status-attention/15',
  done: 'bg-status-done/15',
  failed: 'bg-status-failed/15',
} as const

const MODE = {
  standard: { label: 'Standard', Icon: Workflow },
  fastfix: { label: 'Fast Fix', Icon: Zap },
  investigation: { label: 'Investigation', Icon: Search },
} as const

/**
 * The Focus View's sticky header. Wraps instead of overflowing: the previous
 * header put the worktree path in a `<code>` that never truncated, so at
 * 1440px the page already grew a horizontal scrollbar and Pause / Abandon /
 * Raw fell off the right edge (seen 2026-09-05).
 *
 * `showActions` is the caller's gating — the outcome and setup states offer
 * neither Pause nor Abandon, for the reasons `FocusView` records.
 */
export function FocusHeader({
  aggregate,
  projectName,
  showActions,
  onCommand,
}: {
  aggregate: Aggregate
  projectName: string | null
  showActions: boolean
  onCommand: (body: Record<string, unknown>) => void
}) {
  const { objective } = aggregate
  const state = aggregate.state as ViewStateName
  const status = statusFor(state)
  const mode = MODE[objective.mode]
  const [abandoning, setAbandoning] = useState(false)
  const [copied, setCopied] = useState(false)
  const boardHref = `/?project=${encodeURIComponent(objective.projectId)}`
  const gitHref = `/git?project=${encodeURIComponent(objective.projectId)}${
    objective.branchName !== null ? `&ref=${encodeURIComponent(objective.branchName)}` : ''
  }`

  const copyPath = () => {
    if (objective.worktreePath === null) return
    void navigator.clipboard?.writeText(objective.worktreePath).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-8">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link to={boardHref} className="flex items-center gap-1">
          <ArrowLeft className="size-3" aria-hidden="true" />
          {projectName ?? 'Project'}
        </Link>
        <span aria-hidden="true">/</span>
        <Link to={boardHref}>Objectives</Link>
        <span aria-hidden="true">/</span>
        <span className="min-w-0 truncate text-foreground">{objective.title}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-2">
          <h1 className="truncate text-[22px] leading-tight font-semibold tracking-tight">
            {objective.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={`gap-1.5 text-foreground ${TONE_BG[status.tone]}`}
              data-tone={status.tone}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${status.dot} ${
                  status.tone === 'active' ? 'animate-pulse-dot' : ''
                }`}
              />
              {stateLabel(state)}
              <span className="font-mono font-normal text-muted-foreground">{state}</span>
            </Badge>
            <Badge variant="outline">
              <mode.Icon aria-hidden="true" />
              {mode.label}
            </Badge>
            {objective.branchName !== null && (
              <Badge variant="outline" className="font-mono font-normal" asChild>
                <Link to={gitHref}>
                  <GitBranch aria-hidden="true" />
                  {objective.branchName}
                </Link>
              </Badge>
            )}
            {objective.worktreePath !== null && (
              <span className="flex min-w-0 max-w-90 items-center gap-1 font-mono text-xs text-muted-foreground">
                <code className="min-w-0 truncate" title={objective.worktreePath}>
                  {objective.worktreePath}
                </code>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Copy worktree path"
                  onClick={copyPath}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showActions && (
            <>
              {/* htmlFor/id: Biome's noLabelWithoutControl can't see through
                  Switch to the button it renders, but an explicit pairing
                  passes and keeps the real label→control association. */}
              <label
                htmlFor="low-energy-switch"
                className="flex items-center gap-2 text-[13px] text-muted-foreground"
              >
                <BatteryLow className="size-3.5" aria-hidden="true" />
                Low Energy
                <Switch
                  id="low-energy-switch"
                  aria-label="Low Energy Mode"
                  checked={objective.lowEnergy}
                  onCheckedChange={(value) => onCommand({ type: 'set_low_energy', value })}
                />
              </label>
              <Button variant="outline" size="sm" onClick={() => onCommand({ type: 'pause' })}>
                <Pause />
                Pause
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem asChild>
                <a href={`/api/objectives/${objective.id}/raw`}>
                  <FileText />
                  Raw transcript
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={gitHref}>
                  <GitBranch />
                  Open in git console
                </Link>
              </DropdownMenuItem>
              {showActions && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setAbandoning(true)}>
                    <X />
                    Abandon objective…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showActions && (
        <AbandonDialog
          open={abandoning}
          onOpenChange={setAbandoning}
          title={objective.title}
          onConfirm={() => onCommand({ type: 'abandon' })}
        />
      )}
    </header>
  )
}
