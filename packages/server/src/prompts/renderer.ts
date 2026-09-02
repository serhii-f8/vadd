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
  'execute-task-investigation',
  'verify',
  'review',
  'repair',
] as const
export type PromptPhase = (typeof PROMPT_PHASES)[number]

export type PromptTemplate = {
  version: number
  phase: string
  /**
   * What this turn must produce, as alternation groups: every group must be
   * satisfied, and a group is satisfied by any one of its members. Written
   * `expects: [task_result|failure, evidence|failure]`.
   *
   * The flat list this replaced could only mean AND, which made a successful
   * `execute-task` turn structurally unable to satisfy its own contract: the
   * template offers `failure` as the alternative to `task_result`, so a turn
   * that succeeded was reported as missing a block and handed the user
   * "Unstructured output — open raw view" for fully structured output.
   */
  expects: AgentEventType[][]
  /**
   * Amendment A24: event types this turn may emit without owing them.
   * Excluded from the pipeline's `unexpected_type` check; never consulted by
   * `unmetExpectations()`, so a turn that emits only a permitted type still
   * owes every `expects` group. Flat — no alternation groups.
   */
  permits: AgentEventType[]
  body: string
  /** Absolute path the template was read from, for error messages. */
  source: string
}

/** `prompts/claude-code/v1/`, anchored to the repo root, not `process.cwd()`. */
export function bundledPromptDir(): string {
  return process.env.VADD_PROMPTS_DIR ?? join(repoRoot(), 'prompts', 'claude-code', 'v1')
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

  const expects = list(fields.expects).map((entry) =>
    entry
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
  for (const group of expects) {
    for (const e of group) {
      if (!(AGENT_EVENT_TYPES as readonly string[]).includes(e)) {
        throw new Error(`Template ${source} expects unknown event type "${e}"`)
      }
    }
  }

  const permits = list(fields.permits)
  for (const p of permits) {
    if (!(AGENT_EVENT_TYPES as readonly string[]).includes(p)) {
      throw new Error(`Template ${source} permits unknown event type "${p}"`)
    }
  }

  const version = Number(fields.version)
  if (!Number.isInteger(version)) throw new Error(`Template ${source} has no integer version`)
  if (!fields.phase) throw new Error(`Template ${source} has no phase`)

  return {
    version,
    phase: fields.phase,
    expects: expects as AgentEventType[][],
    permits: permits as AgentEventType[],
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

const PLACEHOLDER = /\{\{(\w+)\}\}/g

/**
 * Placeholders the server fills from the objective row itself.
 */
export const AUTO_TEMPLATE_VARS = ['title', 'goalText'] as const

/**
 * Placeholders with no source in this milestone phase, which the caller must
 * supply as `vars`.
 *
 * `verificationChecks` comes from the verification spec and `taskTitle` /
 * `taskDescription` from `plan_tasks`; the machine supplies both from phase 4
 * on, and a human driving corpus collection types them in. Naming them here
 * rather than leaving them implicit is the point: `verify.md`, `execute-task.md`
 * and `execute-task-investigation.md` are the three templates that solicit
 * `evidence`, one of the two gated types, and the first two shipped sending
 * the literal string `{{verificationCommands}}` to the agent because nothing
 * checked that any caller could satisfy them.
 *
 * `verificationCommands` is kept alongside its replacement: phase 4 gave the
 * commands to EvidenceCollector and rewrote `verify.md` to ask for the checks,
 * but a user override in `~/.vadd/prompts/` may still be the older template,
 * and dropping the name would turn that into an unsatisfiable placeholder.
 *
 * `missing` is `repair.md`'s: the human-readable list of unmet expect groups,
 * built by the caller from `ContractPipeline.unmetExpectations()`.
 *
 * `verifyCommandIds` is `plan.md`'s (amendment A11): the comma-joined
 * `verify.commands[].id`s a task's `expectFailing` may name. `sendPromptEffect`
 * always supplies it for the `plan` phase — an empty string when no
 * verification spec is resolved yet — so it is never left as a literal
 * placeholder the way `verificationCommands` once was.
 *
 * `projectMemory` is `explore.md`'s (amendment A22): the capped, formatted
 * `project_memory` block `buildProjectMemoryPromptBlock` builds.
 * `sendPromptEffect` always supplies it for the `explore` phase — the literal
 * "No project memory recorded yet." sentence when the project has none — so
 * it is never left as a literal placeholder either.
 */
export const CALLER_TEMPLATE_VARS = [
  'verificationChecks',
  'verificationCommands',
  'taskTitle',
  'taskDescription',
  'missing',
  'verifyCommandIds',
  'projectMemory',
] as const

/** Distinct `{{name}}` placeholders in a template body or a rendered prompt. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))]
}

/**
 * Replaces `{{name}}` with `vars.name`. An unknown placeholder is left in place
 * rather than blanked: a visibly broken prompt is debuggable, a silently empty
 * one is not. Callers are expected to run `placeholdersIn` over the result and
 * refuse to send a prompt that still carries one.
 */
export function renderTemplate(t: PromptTemplate, vars: Record<string, string>): string {
  return t.body.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(vars, name) ? (vars[name] ?? whole) : whole,
  )
}
