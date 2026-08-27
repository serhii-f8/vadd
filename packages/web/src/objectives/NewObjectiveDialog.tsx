import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'

type Mode = 'standard' | 'fastfix' | 'investigation'

/**
 * Consequences spelled out per option, the way `IntegrationChooser` already
 * does for integrate actions: a user cannot be expected to know which mode
 * skips the proposal step or which one can never produce a commit.
 */
const MODES: Array<{ value: Mode; label: string; detail: string }> = [
  {
    value: 'standard',
    label: 'Standard',
    detail: 'Explore, propose options, plan, execute, verify.',
  },
  {
    value: 'fastfix',
    label: 'Fast Fix',
    detail: 'Skip the proposal step and go straight to a plan. Verification still runs.',
  },
  {
    value: 'investigation',
    label: 'Investigation',
    detail: 'Read-only. Produces findings, not a diff, and can never be committed.',
  },
]

export function NewObjectiveDialog({
  open,
  onOpenChange,
  seed,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  /** A "Continue" follow-up: pre-fills from a prior objective and hides the project picker. */
  seed?: { continuedFromId: string }
}) {
  const { projects, selectedId } = useProjects()
  const navigate = useNavigate()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [goalText, setGoalText] = useState('')
  const [mode, setMode] = useState<Mode>('standard')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Every open starts clean: this dialog is mounted unconditionally in
  // AppShell (Radix needs it mounted to animate the close transition), so its
  // state would otherwise survive a Cancel-and-reopen — a stale error sitting
  // above a blank form, or a mode choice from a previous objective silently
  // carrying over. Same fix as NewProjectDialog.
  useEffect(() => {
    if (!open) return
    setError(null)
    setTitle('')
    setGoalText('')
    setMode('standard')
    setProjectId(null)
    if (!seed) return
    api
      .getContinuationSeed(seed.continuedFromId)
      .then((s) => {
        setProjectId(s.projectId)
        setTitle(s.title)
        setGoalText(
          `${s.goalText}\n\n— Continuing "${s.title}" (${s.status}).` +
            (s.lastClaim ? ` Final claim: ${s.lastClaim}.` : '') +
            (s.totalCount > 0 ? ` ${s.verifiedCount}/${s.totalCount} evidence checks passed.` : ''),
        )
      })
      .catch((e: Error) => setError(e.message))
  }, [open, seed])

  const target = projectId ?? selectedId

  const submit = async () => {
    if (target === null || title.trim() === '' || goalText.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const objective = await api.createObjective(
        target,
        title.trim(),
        goalText.trim(),
        mode,
        seed?.continuedFromId,
      )
      onOpenChange(false)
      navigate(`/o/${objective.id}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New objective</DialogTitle>
          <DialogDescription>
            Describe a bug or a feature in plain language. VADD works in an isolated worktree.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {seed === undefined && projects !== null && projects.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-objective-project">Project</Label>
              <Select value={target ?? undefined} onValueChange={setProjectId}>
                <SelectTrigger id="new-objective-project">
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
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-objective-title">Title</Label>
            <Input
              id="new-objective-title"
              value={title}
              maxLength={120}
              placeholder="Fix the checkout total rounding"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-objective-goal">Goal</Label>
            <Textarea
              id="new-objective-goal"
              value={goalText}
              maxLength={4000}
              rows={4}
              placeholder="Totals are a cent off on carts with more than one item."
              onChange={(e) => setGoalText(e.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Mode</legend>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="flex flex-col gap-2"
            >
              {MODES.map((m) => (
                <Label
                  key={m.value}
                  htmlFor={`mode-${m.value}`}
                  className="flex items-start gap-2 font-normal"
                >
                  <RadioGroupItem id={`mode-${m.value}`} value={m.value} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.detail}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>

          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            Create objective
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
