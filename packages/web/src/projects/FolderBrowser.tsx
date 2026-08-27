import { ChevronUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, type FsEntry } from '../api.js'

export function FolderBrowser({
  onSelect,
  onClose,
}: {
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = async (target?: string) => {
    setError(null)
    try {
      const result = await api.browseFs(target)
      setPath(result.path)
      setParent(result.parent)
      setEntries(result.entries)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount — navigation after that goes through load() directly
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={parent === null}
          onClick={() => parent !== null && void load(parent)}
        >
          <ChevronUp className="size-4" />
          Up
        </Button>
        {path !== null && <span className="truncate text-xs text-muted-foreground">{path}</span>}
      </div>

      {error !== null && <p className="text-xs text-destructive">{error}</p>}

      <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
        {entries.map((e) => (
          <li key={e.path}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={() => void load(e.path)}
            >
              <span>{e.name}</span>
              {e.isGitRepo && <span className="text-xs text-muted-foreground">git repo</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={path === null}
          onClick={() => path !== null && onSelect(path)}
        >
          Select this folder
        </Button>
      </div>
    </div>
  )
}
