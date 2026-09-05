import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import type { GitOwner } from '../api.js'

/**
 * Who made this branch or worktree. `orphan` is the one that earns its place:
 * VADD created it and lost track of it, which is a leak, and until now no
 * surface in the app would have shown one.
 */
export function OwnerBadge({ owner }: { owner: GitOwner }) {
  if (owner.kind === 'vadd') {
    return (
      // Bounded: an objective title can be a whole sentence, and unbounded it
      // pushed the branch row — and the page — past the viewport (2026-09-05).
      <Badge variant="outline" className="max-w-40 font-normal" asChild>
        <Link to={`/o/${owner.objectiveId}`} title={owner.objectiveTitle}>
          <span className="truncate">{owner.objectiveTitle}</span>
        </Link>
      </Badge>
    )
  }
  if (owner.kind === 'orphan') {
    return <Badge variant="destructive">orphan</Badge>
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      yours
    </Badge>
  )
}
