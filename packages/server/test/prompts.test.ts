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
  expect(t).toMatchObject({ version: 1, phase: 'planning', expects: ['plan'] })
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

test('the objective-derived vars alone leave two templates unsatisfied', () => {
  // Pins the fact the fix depends on: `verify` and `execute-task` genuinely
  // cannot be rendered from an objective row, so the route must reject them
  // without `vars` rather than treating the leftover braces as prose. If a
  // later phase wires these up from the verification spec and plan_tasks, this
  // test is the one to update — deliberately, not by accident.
  const auto = Object.fromEntries(AUTO_TEMPLATE_VARS.map((v) => [v, 'x']))
  const unsatisfied = PROMPT_PHASES.filter(
    (p) => placeholdersIn(renderTemplate(loadTemplate(p), auto)).length > 0,
  )
  expect(unsatisfied.sort()).toEqual(['execute-task', 'verify'])
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
