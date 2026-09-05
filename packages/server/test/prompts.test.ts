import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentEvent, fitsReadingBudget } from '@vadd/core'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { FenceScanner } from '../src/contract/fence-scanner.js'
import { repoRoot } from '../src/paths.js'
import {
  AUTO_TEMPLATE_VARS,
  bundledPromptDir,
  CALLER_TEMPLATE_VARS,
  loadTemplate,
  PROMPT_PHASES,
  parseTemplate,
  placeholdersIn,
  renderTemplate,
  userPromptDir,
} from '../src/prompts/renderer.js'

let home: string
const prev = process.env.VADD_HOME
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'vadd-prompts-'))
  process.env.VADD_HOME = home
})
afterEach(() => {
  if (prev === undefined) delete process.env.VADD_HOME
  else process.env.VADD_HOME = prev
})

test('parses front-matter including the expects list', () => {
  const t = parseTemplate(
    ['---', 'version: 1', 'phase: planning', 'expects: [plan]', '---', 'Body {{goalText}}'].join(
      '\n',
    ),
    'test',
  )
  expect(t).toMatchObject({ version: 1, phase: 'planning', expects: [['plan']] })
  expect(t.body.trim()).toBe('Body {{goalText}}')
})

test('rejects a template whose expects names an unknown event type', () => {
  expect(() =>
    parseTemplate(
      ['---', 'version: 1', 'phase: x', 'expects: [invented]', '---', 'b'].join('\n'),
      'test',
    ),
  ).toThrow(/invented/)
})

test('A24: parses a permits list, flat, and defaults it to []', () => {
  const t = parseTemplate(
    [
      '---',
      'version: 2',
      'phase: propose',
      'expects: [decision_needed]',
      'permits: [artifact, memory_note]',
      '---',
      'b',
    ].join('\n'),
    'test',
  )
  expect(t.permits).toEqual(['artifact', 'memory_note'])
  const none = parseTemplate(
    ['---', 'version: 1', 'phase: p', 'expects: []', '---', 'b'].join('\n'),
    'test',
  )
  expect(none.permits).toEqual([])
})

test('A24: rejects a permits entry naming an unknown event type', () => {
  expect(() =>
    parseTemplate(
      ['---', 'version: 1', 'phase: x', 'expects: []', 'permits: [invented]', '---', 'b'].join(
        '\n',
      ),
      'test',
    ),
  ).toThrow(/permits unknown event type "invented"/)
})

test('substitutes placeholders and leaves unknown ones visible', () => {
  const t = parseTemplate(
    ['---', 'version: 1', 'phase: p', 'expects: []', '---', 'A {{one}} B {{missing}}'].join('\n'),
    'test',
  )
  expect(renderTemplate(t, { one: 'X' })).toContain('A X B {{missing}}')
})

test('every bundled phase loads', () => {
  for (const phase of PROMPT_PHASES) {
    const t = loadTemplate(phase)
    expect(t.phase, phase).toBe(phase)
    expect(t.body.length, phase).toBeGreaterThan(0)
  }
})

test('execute-task-investigation asks for findings, not a diff', () => {
  const t = loadTemplate('execute-task-investigation')
  expect(t.body).toContain('Do not change any code')
  expect(t.expects).toEqual([
    ['task_result', 'failure'],
    ['evidence', 'failure'],
  ])
})

test('bundledPromptDir() resolves to a real directory holding the addendum', () => {
  expect(existsSync(join(bundledPromptDir(), 'system-addendum.md'))).toBe(true)
})

test('repoRoot() finds the monorepo root regardless of caller depth', () => {
  // Same assertion bundledPromptDir() relies on: this must hold from wherever
  // repoRoot() is called from, including a `dist/` build one level deeper
  // than `src/` — see the comment on repoRoot() for why that matters.
  expect(existsSync(join(repoRoot(), 'pnpm-workspace.yaml'))).toBe(true)
})

test('a malformed user override throws rather than silently falling back', () => {
  mkdirSync(userPromptDir(), { recursive: true })
  writeFileSync(join(userPromptDir(), 'plan.md'), 'not a template at all')
  expect(() => loadTemplate('plan')).toThrow()
})

test('a user override wins over the bundled template (D11)', () => {
  mkdirSync(userPromptDir(), { recursive: true })
  writeFileSync(
    join(userPromptDir(), 'plan.md'),
    ['---', 'version: 1', 'phase: plan', 'expects: [plan]', '---', 'MINE'].join('\n'),
  )
  expect(loadTemplate('plan').body.trim()).toBe('MINE')
  // Overriding one phase must not fork the rest.
  expect(loadTemplate('verify').body).not.toContain('MINE')
})

test('every example block in every bundled template is valid and within budget', () => {
  for (const phase of PROMPT_PHASES) {
    const scanner = new FenceScanner()
    const blocks = [...scanner.push(loadTemplate(phase).body), ...scanner.flush().blocks]
    // A phase that lost its example would otherwise pass this loop vacuously.
    expect(blocks.length, `${phase}: expected at least one vadd-event block`).toBeGreaterThan(0)
    for (const block of blocks) {
      const parsed = AgentEvent.safeParse(JSON.parse(block.body))
      expect(parsed.success, `${phase}: ${block.body}`).toBe(true)
      if (!parsed.success) continue
      // Spec §10: the bundled templates are where the reading budget is tested.
      expect(fitsReadingBudget(parsed.data), `${phase}: ${block.body}`).toEqual([])
    }
  }
})

test('every placeholder in every bundled template has a declared source', () => {
  // The check whose absence shipped `{{verificationCommands}}` and
  // `{{taskTitle}}` / `{{taskDescription}}` to the agent as literal text. A new
  // placeholder in any template is now a failing test until someone decides
  // where its value comes from, rather than a silently broken prompt.
  const known = new Set<string>([...AUTO_TEMPLATE_VARS, ...CALLER_TEMPLATE_VARS])
  for (const phase of PROMPT_PHASES) {
    for (const name of placeholdersIn(loadTemplate(phase).body)) {
      expect(
        known.has(name),
        `${phase}.md uses {{${name}}}, which no caller supplies. Add it to ` +
          'AUTO_TEMPLATE_VARS or CALLER_TEMPLATE_VARS in prompts/renderer.ts.',
      ).toBe(true)
    }
  }
})

test('verify.md asks for the checks, not the commands', () => {
  // Phase 4 gave the commands to EvidenceCollector. The agent's verify turn now
  // judges the acceptance checks — the one thing running a command cannot
  // produce — so shipping `{{verificationCommands}}` would be asking it to
  // re-run a suite VADD has already run and recorded.
  //
  // It does carry the *results* of those commands: "do not run them again"
  // is only a fair instruction when the agent can see what running them
  // found.
  const body = loadTemplate('verify').body
  expect(placeholdersIn(body).sort()).toEqual(['commandResults', 'verificationChecks'])
})

test('system-addendum honours a user override the way every phase template does (D11)', () => {
  mkdirSync(userPromptDir(), { recursive: true })
  writeFileSync(
    join(userPromptDir(), 'system-addendum.md'),
    ['---', 'version: 1', 'phase: system', 'expects: []', '---', 'MY ADDENDUM'].join('\n'),
  )
  expect(loadTemplate('system-addendum').body.trim()).toBe('MY ADDENDUM')
})

test('the objective-derived vars alone leave five templates unsatisfied', () => {
  // Pins the fact the fix depends on: `verify` and `execute-task` genuinely
  // cannot be rendered from an objective row, so the route must reject them
  // without `vars` rather than treating the leftover braces as prose. If a
  // later phase wires these up from the verification spec and plan_tasks, this
  // test is the one to update — deliberately, not by accident.
  //
  // `repair` joins them for the same reason: `{{missing}}` comes from
  // `ContractPipeline.unmetExpectations()` at repair time, not the objective row.
  //
  // `plan` joined this list under amendment A11: `{{verifyCommandIds}}` comes
  // from the resolved verification spec, which `sendPromptEffect` supplies
  // (as `''` when unresolved) — never from the objective row alone.
  //
  // `execute-task-investigation` joins this list: `{{taskTitle}}` and
  // `{{taskDescription}}` come from CALLER_TEMPLATE_VARS supplied per-task,
  // not from the objective row alone.
  //
  // `explore` joins this list under amendment A22: `{{projectMemory}}` comes
  // from `buildProjectMemoryPromptBlock`, which `sendPromptEffect` supplies
  // for the `explore` phase — never from the objective row alone.
  const auto = Object.fromEntries(AUTO_TEMPLATE_VARS.map((v) => [v, 'x']))
  const unsatisfied = PROMPT_PHASES.filter(
    (p) => placeholdersIn(renderTemplate(loadTemplate(p), auto)).length > 0,
  )
  expect(unsatisfied.sort()).toEqual([
    'execute-task',
    'execute-task-investigation',
    'explore',
    'plan',
    'repair',
    'verify',
  ])
})

test('a fully supplied var set renders every template with no placeholder left', () => {
  const all = Object.fromEntries(
    [...AUTO_TEMPLATE_VARS, ...CALLER_TEMPLATE_VARS].map((v) => [v, 'x']),
  )
  for (const phase of PROMPT_PHASES) {
    expect(placeholdersIn(renderTemplate(loadTemplate(phase), all)), phase).toEqual([])
  }
})

test('at least one template carries a worked example', () => {
  const withExamples = PROMPT_PHASES.filter((p) => loadTemplate(p).body.includes('```vadd-event'))
  expect(withExamples.length).toBeGreaterThan(0)
})

test('parses an alternation group in expects', () => {
  const t = parseTemplate(
    [
      '---',
      'version: 1',
      'phase: execute-task',
      'expects: [task_result|failure, evidence]',
      '---',
      'b',
    ].join('\n'),
    'test',
  )
  expect(t.expects).toEqual([['task_result', 'failure'], ['evidence']])
})

test('rejects an unknown event type inside an alternation group', () => {
  expect(() =>
    parseTemplate(
      ['---', 'version: 1', 'phase: x', 'expects: [task_result|invented]', '---', 'b'].join('\n'),
      'test',
    ),
  ).toThrow(/invented/)
})

test('no bundled template requires an event that contradicts another it expects', () => {
  // `failure` is the documented alternative to a success event, never a
  // co-requirement: any template listing both must offer them as one group.
  for (const phase of PROMPT_PHASES) {
    for (const group of loadTemplate(phase).expects) {
      expect(
        group.length,
        `${phase}: bare "failure" is required, not offered as an alternative`,
      ).toBeGreaterThan(group.includes('failure') ? 1 : 0)
    }
  }
})

test('A24: memory_note is permitted on every phase template except repair', () => {
  for (const phase of PROMPT_PHASES) {
    const t = loadTemplate(phase)
    if (phase === 'repair') {
      // Sent inside the same open turn, so it inherits the original
      // template's permits — declaring its own would be a second source.
      expect(t.permits).toEqual([])
      continue
    }
    expect(t.permits, `${phase}.md`).toContain('memory_note')
  }
})

test('A24: artifact is permitted on propose and plan, and nowhere else', () => {
  for (const phase of PROMPT_PHASES) {
    const permitted = loadTemplate(phase).permits.includes('artifact')
    expect(permitted, `${phase}.md`).toBe(phase === 'propose' || phase === 'plan')
  }
})

test('A24: propose.md and plan.md each carry an in-budget artifact example', () => {
  for (const phase of ['propose', 'plan'] as const) {
    const scanner = new FenceScanner()
    const body = loadTemplate(phase).body
    const blocks = [...scanner.push(body), ...scanner.flush().blocks]
    const artifacts = blocks
      .map((b) => AgentEvent.safeParse(JSON.parse(b.body)))
      .filter((r) => r.success && r.data.type === 'artifact')
    expect(artifacts.length, `${phase}.md has no artifact example`).toBe(1)
  }
})

test('every template states its event budget, and it matches expects', () => {
  // `expects` is a server-side assertion the agent cannot read. Nothing ever
  // told it what a turn may emit, and in the fourth gate run eleven of sixteen
  // unlabelled emissions were turns 1-2 producing types their own declared
  // contract never solicited — five of them evidence asserting no work was done.
  for (const phase of PROMPT_PHASES) {
    const t = loadTemplate(phase)
    // repair: its budget is whatever the turn owed, named by {{missing}}.
    if (t.expects.length === 0) continue

    const line = /^Emit only: (.+)\.$/m.exec(t.body)
    expect(line, `${phase}.md has no "Emit only:" line`).not.toBeNull()

    const stated = [...(line?.[1] ?? '').matchAll(/`(\w+)`/g)].map((m) => m[1])
    const declared = t.expects.flat()
    expect(
      [...new Set(stated)].sort(),
      `${phase}.md states a budget that disagrees with its expects front-matter`,
    ).toEqual([...new Set(declared)].sort())
  }
})
