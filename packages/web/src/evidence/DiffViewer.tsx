import { Diff, Hunk, parseDiff } from 'react-diff-view'
import 'react-diff-view/style/index.css'

/** Lazy-loaded by DiffList — never imported eagerly. */
export default function DiffViewer({ diffText }: { diffText: string }) {
  const files = parseDiff(diffText)
  const file = files[0]
  if (!file) return <p className="mt-1 text-xs text-muted-foreground">No diff.</p>

  return (
    <div data-testid="file-diff" className="mt-1 overflow-x-auto text-xs">
      <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
        {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
      </Diff>
    </div>
  )
}
