import { MoreHorizontal } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * A row's actions, behind one toggle.
 *
 * The console used to put every confirm button on every row — five to eight
 * per branch with two remotes — and the row's own name lost the fight for
 * space (seen at 1440px on 2026-09-05). This is an inline disclosure, not a
 * portal menu, on purpose: the children are the very same two-click
 * `ConfirmButton`s, rendered inside the row so their armed labels wrap
 * beneath it and every existing test keeps meaning with one extra click.
 */
export function RowActions({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Actions for ${name}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="shrink-0"
      >
        <MoreHorizontal />
      </Button>
      {open && (
        <fieldset
          aria-label={`${name} actions`}
          className="m-0 flex w-full min-w-0 flex-wrap items-center gap-2 border-0 p-0 pt-1 pl-5"
        >
          {children}
        </fieldset>
      )}
    </>
  )
}
