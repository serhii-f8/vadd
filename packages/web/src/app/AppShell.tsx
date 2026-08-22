import { FolderPlus, Plus } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ProjectsProvider, useProjects } from './ProjectsContext.js'
import { ThemeToggle } from './ThemeToggle.js'

const NAV = [
  { to: '/', label: 'Objectives' },
  { to: '/today', label: 'Today' },
] as const

function Sidebar() {
  const { projects, selectedId, select, error } = useProjects()
  const hasProjects = projects !== null && projects.length > 0

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-3 border-r border-border bg-sidebar p-4">
      <Link to="/" className="text-base font-semibold tracking-tight">
        VADD
      </Link>

      {hasProjects && (
        <Select value={selectedId ?? undefined} onValueChange={(id) => select(id)}>
          <SelectTrigger aria-label="Project" className="w-full">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="mt-1 flex flex-col gap-0.5">
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `rounded-md px-2 py-1.5 text-sm ${
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>

      <div className="mt-2 flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" disabled={!hasProjects}>
          <Plus />
          New objective
        </Button>
        <Button variant="ghost" size="sm">
          <FolderPlus />
          Add project
        </Button>
      </div>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-auto flex flex-col items-start gap-1">
        <Separator className="mb-1" />
        <ThemeToggle />
        <Link to="/debug" className="px-2 py-1 text-xs text-muted-foreground hover:underline">
          Debug
        </Link>
      </div>
    </nav>
  )
}

export function AppShell() {
  return (
    <ProjectsProvider>
      <div className="flex min-h-screen bg-background text-foreground">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <div className="mx-auto max-w-3xl p-8">
            <Outlet />
          </div>
        </div>
      </div>
    </ProjectsProvider>
  )
}
