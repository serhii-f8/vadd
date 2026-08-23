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
      navigate({ pathname: '/', search: id === null ? '' : `?project=${encodeURIComponent(id)}` })
    },
    [navigate],
  )

  const addProject = useCallback((p: Project) => {
    setProjects((rows) => [...(rows ?? []), p])
  }, [])

  const value = useMemo<ProjectsValue>(() => {
    // The URL wins when it names a project that exists; otherwise fall back to
    // the first, so a page never renders with no project at all while one is
    // available. An unknown id in the URL is treated as absent rather than as
    // an error — a stale bookmark should degrade, not break.
    const selected =
      (param !== null ? (projects ?? []).find((p) => p.id === param) : undefined) ??
      (projects ?? [])[0] ??
      null
    return {
      projects,
      selectedId: selected?.id ?? null,
      selected,
      select,
      error,
      addProject,
    }
  }, [projects, param, select, error, addProject])

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}
