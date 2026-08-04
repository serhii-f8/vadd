import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_EVENT_TYPES, type AgentEventType } from '@vadd/core'
import { repoRoot, vaddHome } from '../paths.js'

export const PROMPT_PHASES = [
  'explore',
  'clarify',
  'propose',
  'plan',
  'execute-task',
  'verify',
  'review',
] as const
export type PromptPhase = (typeof PROMPT_PHASES)[number]

export type PromptTemplate = {
  version: number
  phase: string
  /** What this turn must produce. Fed straight to `pipeline.beginTurn`. */
  expects: AgentEventType[]
  body: string
  /** Absolute path the template was read from, for error messages. */
  source: string
}

/** `prompts/claude-code/v1/`, anchored to the repo root, not `process.cwd()`. */
export function bundledPromptDir(): string {
  return join(repoRoot(), 'prompts', 'claude-code', 'v1')
}

/** D11: user overrides live in `~/.vadd/prompts/`. */
export function userPromptDir(): string {
  return join(vaddHome(), 'prompts')
}

/**
 * Parses the front-matter subset the templates actually use: `key: scalar` and
 * `key: [a, b]`. A YAML dependency would buy nothing here and would put an
 * arbitrary-document parser on a path that reads user-supplied files.
 */
export function parseTemplate(raw: string, source: string): PromptTemplate {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) throw new Error(`Template ${source} has no front-matter block`)

  const fields: Record<string, string> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim())
    const key = kv?.[1]
    const value = kv?.[2]
    if (key !== undefined && value !== undefined) fields[key] = value.trim()
  }

  const list = (v: string | undefined): string[] =>
    v === undefined || v === '' || v === '[]'
      ? []
      : v
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

  const expects = list(fields.expects)
  for (const e of expects) {
    if (!(AGENT_EVENT_TYPES as readonly string[]).includes(e)) {
      throw new Error(`Template ${source} expects unknown event type "${e}"`)
    }
  }

  const version = Number(fields.version)
  if (!Number.isInteger(version)) throw new Error(`Template ${source} has no integer version`)
  if (!fields.phase) throw new Error(`Template ${source} has no phase`)

  return {
    version,
    phase: fields.phase,
    expects: expects as AgentEventType[],
    body: raw.slice(match[0].length),
    source,
  }
}

/**
 * User override → bundled default, resolved **per file** so overriding one
 * phase does not fork the whole set (D11).
 */
export function loadTemplate(phase: string): PromptTemplate {
  const override = join(userPromptDir(), `${phase}.md`)
  const file = existsSync(override) ? override : join(bundledPromptDir(), `${phase}.md`)
  if (!existsSync(file)) throw new Error(`No prompt template for phase "${phase}"`)
  return parseTemplate(readFileSync(file, 'utf8'), file)
}

/**
 * Replaces `{{name}}` with `vars.name`. An unknown placeholder is left in place
 * rather than blanked: a visibly broken prompt is debuggable, a silently empty
 * one is not.
 */
export function renderTemplate(t: PromptTemplate, vars: Record<string, string>): string {
  return t.body.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? (vars[name] ?? whole) : whole,
  )
}
