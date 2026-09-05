import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { ViewStateName } from '../focus/primary.js'
import { useMediaQuery } from '../lib/use-media-query.js'
import { NewObjectiveDialog } from '../objectives/NewObjectiveDialog.js'
import { NewProjectDialog } from '../projects/NewProjectDialog.js'
import { statusFor } from '../routes/stateColor.js'
import { IconRail } from './IconRail.js'
import { ProjectsProvider, useProjects } from './ProjectsContext.js'
import { SidebarContent } from './SidebarContent.js'
import { TopBar } from './TopBar.js'
import { useLiveObjectives } from './useLiveObjectives.js'

/** Routes that want the whole width: the git console's two columns, the map's canvas. */
function isWide(pathname: string): boolean {
  return pathname.startsWith('/git') || pathname.startsWith('/map')
}

function Shell() {
  const { selectedId } = useProjects()
  const { objectives, connected } = useLiveObjectives(selectedId)
  const md = useMediaQuery('(min-width: 768px)')
  const xl = useMediaQuery('(min-width: 1280px)')
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addingProject, setAddingProject] = useState(false)
  const [addingObjective, setAddingObjective] = useState(false)
  const needsYou = (objectives ?? []).filter(
    (o) => statusFor(o.status as ViewStateName).tone === 'attention',
  ).length

  const sidebar = (
    <SidebarContent
      objectives={objectives}
      connected={connected}
      onNewObjective={() => {
        setDrawerOpen(false)
        setAddingObjective(true)
      }}
      onAddProject={() => {
        setDrawerOpen(false)
        setAddingProject(true)
      }}
      onNavigate={() => setDrawerOpen(false)}
    />
  )

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Three layouts, one body: the sidebar is sticky at xl, an icon rail
          from md, and a drawer below that. `sticky top-0 h-screen` is the
          whole fix for "the project selector isn't pinned" — the old
          sidebar was a plain flex child that scrolled away with the page. */}
      {xl ? (
        <aside className="sticky top-0 h-screen w-60 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar">
          {sidebar}
        </aside>
      ) : md ? (
        <IconRail
          needsYou={needsYou}
          onOpenMenu={() => setDrawerOpen(true)}
          onNewObjective={() => setAddingObjective(true)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {!md && (
          <TopBar
            onOpenMenu={() => setDrawerOpen(true)}
            onNewObjective={() => setAddingObjective(true)}
          />
        )}
        <div className={isWide(pathname) ? 'w-full' : 'mx-auto w-full max-w-4xl'}>
          <Outlet />
        </div>
      </div>

      {!xl && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
      )}

      <NewProjectDialog open={addingProject} onOpenChange={setAddingProject} />
      <NewObjectiveDialog open={addingObjective} onOpenChange={setAddingObjective} />
    </div>
  )
}

export function AppShell() {
  return (
    <ProjectsProvider>
      <Shell />
    </ProjectsProvider>
  )
}
