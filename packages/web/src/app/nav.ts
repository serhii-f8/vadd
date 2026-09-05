import { GitBranch, List, Map as MapIcon, Sun } from 'lucide-react'

/** The four destinations, shared by the full sidebar, the icon rail and the drawer. */
export const NAV = [
  { to: '/', label: 'Objectives', Icon: List },
  { to: '/today', label: 'Today', Icon: Sun },
  { to: '/map', label: 'Map', Icon: MapIcon },
  { to: '/git', label: 'Git', Icon: GitBranch },
] as const

/**
 * Every destination is scoped to one project, and the selection is read back
 * from this same `?project=` param, not carried across navigations on its
 * own — a plain `to` silently dropped the current selection back to the first
 * project the moment the user clicked Today/Map/Git.
 */
export function navTo(to: string, projectId: string | null): string {
  return projectId === null ? to : `${to}?project=${encodeURIComponent(projectId)}`
}
