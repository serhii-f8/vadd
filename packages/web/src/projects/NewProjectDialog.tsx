import { useEffect, useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '../api.js'
import { useProjects } from '../app/ProjectsContext.js'
import { FolderBrowser } from './FolderBrowser.js'

const AGENTS = [
  { value: 'claude-code', label: 'Claude Code', detail: 'Drives Claude Code over ACP.' },
  { value: 'codex', label: 'Codex', detail: 'Drives OpenAI Codex over ACP (amendment A14).' },
] as const

/**
 * Identical in both tabs — cloning and opening register into the same
 * `projects` table with the same field — so both tabs render one definition
 * rather than two copies that could drift.
 */
function AgentPicker({
  agentKind,
  onChange,
}: {
  agentKind: 'claude-code' | 'codex'
  onChange: (value: 'claude-code' | 'codex') => void
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">Agent</legend>
      <RadioGroup
        value={agentKind}
        onValueChange={(v) => onChange(v as 'claude-code' | 'codex')}
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
  )
}

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
  const [browsing, setBrowsing] = useState(false)

  const [mode, setMode] = useState<'open' | 'clone'>('open')
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneParent, setCloneParent] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [cloneNameEdited, setCloneNameEdited] = useState(false)
  const [cloneBrowsing, setCloneBrowsing] = useState(false)

  // Every open starts clean: the dialog instance is mounted unconditionally in
  // AppShell (Radix needs it mounted to animate the close transition), so its
  // state would otherwise survive a Cancel-and-reopen — a stale error sitting
  // above a blank form, or a draft path silently reappearing.
  useEffect(() => {
    if (!open) return
    setError(null)
    setRepoPath('')
    setName('')
    setAgentKind('claude-code')
    setBrowsing(false)
    setMode('open')
    setCloneUrl('')
    setCloneParent('')
    setCloneName('')
    setCloneNameEdited(false)
    setCloneBrowsing(false)
  }, [open])

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
    } catch (e) {
      // The server's own message names the real cause — "Not a git repository:
      // <path>" from validateRepo, or "Repository is already registered". A
      // status code would tell the user nothing they could act on.
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deriveNameFromUrl = (url: string): string => {
    const trimmed = url.trim().replace(/\/+$/, '')
    const lastSegment = trimmed.split(/[/:]/).pop() ?? ''
    return lastSegment.replace(/\.git$/, '')
  }

  const handleCloneUrlChange = (value: string) => {
    setCloneUrl(value)
    if (!cloneNameEdited) setCloneName(deriveNameFromUrl(value))
  }

  const submitClone = async () => {
    if (cloneUrl.trim() === '' || cloneName.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const project = await api.cloneProject(
        cloneUrl.trim(),
        `${cloneParent}/${cloneName.trim()}`,
        agentKind,
        undefined,
      )
      addProject(project)
      select(project.id)
      onOpenChange(false)
    } catch (e) {
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

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'open' | 'clone')}>
          <TabsList className="w-full">
            <TabsTrigger value="open">Open existing</TabsTrigger>
            <TabsTrigger value="clone">Clone repository</TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-project-path">Repository path</Label>
              <div className="flex gap-2">
                <Input
                  id="new-project-path"
                  value={repoPath}
                  placeholder="/var/www/html/my-project"
                  onChange={(e) => setRepoPath(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => setBrowsing(true)}>
                  Browse…
                </Button>
              </div>
              {browsing && (
                <FolderBrowser
                  onSelect={(path) => {
                    setRepoPath(path)
                    setBrowsing(false)
                  }}
                  onClose={() => setBrowsing(false)}
                />
              )}
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

            <AgentPicker agentKind={agentKind} onChange={setAgentKind} />
          </TabsContent>

          <TabsContent value="clone" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clone-url">Repository URL</Label>
              <Input
                id="clone-url"
                value={cloneUrl}
                placeholder="https://github.com/user/repo.git"
                onChange={(e) => handleCloneUrlChange(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clone-parent">Parent directory</Label>
              <div className="flex gap-2">
                <Input
                  id="clone-parent"
                  value={cloneParent}
                  placeholder="/var/www/html"
                  onChange={(e) => setCloneParent(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => setCloneBrowsing(true)}>
                  Browse…
                </Button>
              </div>
              {cloneBrowsing && (
                <FolderBrowser
                  onSelect={(path) => {
                    setCloneParent(path)
                    setCloneBrowsing(false)
                  }}
                  onClose={() => setCloneBrowsing(false)}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clone-name">Directory name</Label>
              <Input
                id="clone-name"
                value={cloneName}
                onChange={(e) => {
                  setCloneName(e.target.value)
                  setCloneNameEdited(true)
                }}
              />
            </div>

            <AgentPicker agentKind={agentKind} onChange={setAgentKind} />
          </TabsContent>
        </Tabs>

        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void (mode === 'clone' ? submitClone() : submit())}
            disabled={busy}
          >
            {mode === 'clone' ? 'Clone' : 'Add project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
