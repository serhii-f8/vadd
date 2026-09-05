import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Project } from '../api.js'

type ProjectsValue = {
  projects: Project[] | null
  selectedId: string | null
  selected: Project | null
  select: (id: string | null) => void
  /**
   * Registers the project a screen belongs to, so the shell follows the
   * screen rather than the URL. `null` withdraws it. Prefer `useDerivedProject`.
   */
  setDerived: (id: string | null) => void
  error: string | null
  /** Lets a successful New Project dialog add its row without a refetch. */
  addProject: (p: Project) => void
}

const ProjectsContext = createContext<ProjectsValue | null>(null)

export function useProjects(): ProjectsValue {
  const ctx = useContext(ProjectsContext)
  if (ctx === null) throw new Error('useProjects must be used inside a ProjectsProvider')
  return ctx
}

/**
 * Browser-local view preference, exactly like `vadd.theme`: which project the
 * user last looked at. Not application state — nothing in `~/.vadd/`.
 */
export const PROJECT_STORAGE_KEY = 'vadd.project'

/** Every `localStorage` access is guarded, for the reason `ThemeProvider` gives. */
export function readStoredProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeProject(id: string): void {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, id)
  } catch {
    // Preference is lost on reload; the session still honours the choice.
  }
}

/**
 * For a screen that belongs to exactly one project — the Focus View, whose
 * objective has a `projectId`. While it is mounted the shell's switcher, its
 * links and the Back link all name that project, whatever the URL says;
 * on unmount the registration is withdrawn.
 *
 * Found in a browser on 2026-09-05: with nothing deriving it, viewing a
 * `flexpick.net` objective showed `vadd-demo-repo` in the sidebar and Back
 * went there.
 */
export function useDerivedProject(id: string | null | undefined): void {
  const { setDerived } = useProjects()
  useEffect(() => {
    if (id == null) return
    setDerived(id)
    return () => setDerived(null)
  }, [id, setDerived])
}

/**
 * One fetch, one selection, for the whole app.
 *
 * Both `/` and `/today` used to carry their own `<select>` and their own
 * `?project=` handling. Two selection paths is what produced the
 * "stale summary survives a project switch" bug class the daily-summary plan
 * had to fix; one path cannot have it.
 */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [derived, setDerivedState] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const param = searchParams.get('project')

  useEffect(() => {
    api
      .listProjects()
      .then((rows) => {
        setProjects(rows)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  /**
   * Selecting a project navigates to the objective list, it does not merely
   * rewrite `?project=`.
   *
   * Every detail screen belongs to one project: the Focus View is scoped to a
   * single objective, and an objective belongs to a single project. Rewriting
   * the query string in place left the user on a screen belonging to the
   * project they had just navigated away from, which made the switcher look
   * broken — it appeared to do nothing at all.
   *
   * Only `project` is carried across. The other params a detail route may hold
   * are scoped to that route and mean nothing on the list.
   */
  const select = useCallback(
    (id: string | null) => {
      if (id !== null) storeProject(id)
      navigate({ pathname: '/', search: id === null ? '' : `?project=${encodeURIComponent(id)}` })
    },
    [navigate],
  )

  // Looking at an objective is as clear a statement of "this is my project"
  // as picking it from the switcher, so it is remembered the same way.
  const setDerived = useCallback((id: string | null) => {
    if (id !== null) storeProject(id)
    setDerivedState(id)
  }, [])

  const addProject = useCallback((p: Project) => {
    setProjects((rows) => [...(rows ?? []), p])
  }, [])

  const value = useMemo<ProjectsValue>(() => {
    // Resolution order, first match wins: the screen's own project, then the
    // URL, then the remembered one, then the first registered — so a page
    // never renders with no project while one is available. An id that names
    // no project (a stale bookmark, a deleted project in storage) is treated
    // as absent rather than as an error: it should degrade, not break.
    const find = (id: string | null) =>
      id === null ? undefined : (projects ?? []).find((p) => p.id === id)
    const selected =
      find(derived) ?? find(param) ?? find(readStoredProject()) ?? (projects ?? [])[0] ?? null
    return {
      projects,
      selectedId: selected?.id ?? null,
      selected,
      select,
      setDerived,
      error,
      addProject,
    }
  }, [projects, derived, param, select, setDerived, error, addProject])

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}
