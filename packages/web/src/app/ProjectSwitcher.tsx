import { Folder } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useProjects } from './ProjectsContext.js'

/**
 * The project switcher as a card: name and path, pinned at the top of the
 * sidebar. Still the shadcn `Select` underneath — the `combobox` role and the
 * "Project" accessible name are what the shell test drives by hand.
 */
export function ProjectSwitcher() {
  const { projects, selectedId, selected, select } = useProjects()
  if (projects === null || projects.length === 0) return null
  return (
    <Select value={selectedId ?? undefined} onValueChange={(id) => select(id)}>
      <SelectTrigger
        aria-label="Project"
        className="h-auto w-full rounded-xl border-0 bg-card px-2.5 py-2 ring-1 ring-foreground/10 hover:ring-foreground/20"
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <Folder className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-[13px] leading-tight font-medium">
            <SelectValue placeholder="Project" />
          </span>
          {selected !== null && (
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {selected.repoPath}
            </span>
          )}
        </span>
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
