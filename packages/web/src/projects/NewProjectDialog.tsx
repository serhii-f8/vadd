import { useState } from 'react'
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
import { api } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'

const AGENTS = [
  { value: 'claude-code', label: 'Claude Code', detail: 'Drives Claude Code over ACP.' },
  { value: 'codex', label: 'Codex', detail: 'Drives OpenAI Codex over ACP (amendment A14).' },
] as const

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const { addProject, select } = useProjects()
  const [repoPath, setRepoPath] = useState('')
  const [name, setName] = useState('')
  const [agentKind, setAgentKind] = useState<'claude-code' | 'codex'>('claude-code')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (repoPath.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const project = await api.registerProject(
        repoPath.trim(),
        agentKind,
        name.trim() === '' ? undefined : name.trim(),
      )
      addProject(project)
      select(project.id)
      onOpenChange(false)
      setRepoPath('')
      setName('')
    } catch (e) {
      // The server's own message names the real cause — "Not a git repository:
      // <path>" from validateRepo, or "Repository is already registered". A
      // status code would tell the user nothing they could act on.
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>
            Point VADD at a local git repository. Work happens in a worktree, never in your
            checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-project-path">Repository path</Label>
            <Input
              id="new-project-path"
              value={repoPath}
              placeholder="/var/www/html/my-project"
              onChange={(e) => setRepoPath(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-project-name">Name (optional)</Label>
            <Input
              id="new-project-name"
              value={name}
              placeholder="Defaults to the folder name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Agent</legend>
            <RadioGroup
              value={agentKind}
              onValueChange={(v) => setAgentKind(v as 'claude-code' | 'codex')}
              className="flex flex-col gap-2"
            >
              {AGENTS.map((a) => (
                <Label
                  key={a.value}
                  htmlFor={`agent-${a.value}`}
                  className="flex items-start gap-2 font-normal"
                >
                  <RadioGroupItem id={`agent-${a.value}`} value={a.value} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="block text-xs text-muted-foreground">{a.detail}</span>
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
            Add project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
