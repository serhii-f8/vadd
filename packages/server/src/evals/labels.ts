import { readFileSync } from 'node:fs'
import { EvidenceKind, EvidenceStatus } from '@vadd/core'
import { z } from 'zod'

/** The two types spec §9 makes the gate bind on. */
export const GATED_TYPES = ['decision_needed', 'evidence'] as const
export type GatedType = (typeof GATED_TYPES)[number]

/**
 * The `match` fields compared **exactly** rather than as regexes, each with the
 * closed set of values the schema admits.
 *
 * `match.ts` reads this same map, so the matcher and the loader cannot disagree
 * about which fields are exact — which is what made the original bug invisible:
 * every value was validated as a regex, so `"status": "(?i)pass"` or a plain
 * typo like `"passed"` loaded clean and then never matched anything, silently
 * costing recall on a transcript nobody would think to re-check.
 */
export const EXACT_MATCH_VALUES: Record<string, readonly string[]> = {
  kind: EvidenceKind.options,
  status: EvidenceStatus.options,
}

/**
 * Compiles a label-file pattern to a RegExp.
 *
 * Contract for anyone hand-writing these patterns: a pattern that starts with
 * `(?i)` is matched case-insensitively — the `(?i)` prefix itself is stripped
 * before matching. `(?i)` anywhere other than the very start (e.g. `foo(?i)bar`)
 * is not supported and is rejected at label-file load time, not silently
 * matched literally or mishandled. Everything else is standard JavaScript
 * `RegExp` syntax.
 */
export function compileRegex(pattern: string): RegExp {
  const caseInsensitive = /^\(\?i\)([\s\S]*)$/.exec(pattern)
  return caseInsensitive ? new RegExp(caseInsensitive[1] as string, 'i') : new RegExp(pattern)
}

const Regex = z.string().refine(
  (s) => {
    try {
      compileRegex(s)
      return true
    } catch {
      return false
    }
  },
  { message: 'not a valid regular expression' },
)

export const Label = z.object({
  /** 1-based prompt-turn ordinal within the transcript. */
  turn: z.number().int().positive(),
  type: z.enum(GATED_TYPES),
  /** Human-readable, unique within a file. Not used in matching. */
  key: z.string().min(1),
  /**
   * Field predicates. `kind` and `status` compare exactly; every other key is a
   * regex tested against the emission's same-named string field.
   */
  match: z.record(z.string(), Regex),
  note: z.string().optional(),
})

/**
 * `kind` and `status` are only carried by `evidence`, and only there are they
 * compared exactly. Restricting the check to that type keeps design §5.3's rule
 * intact — a label naming a field the event does not carry fails to match, it
 * does not throw — while closing the one case where an unmatchable value is
 * indistinguishable from an honest miss.
 */
const LabelWithExactValuesChecked = Label.superRefine((label, ctx) => {
  if (label.type !== 'evidence') return
  for (const [field, allowed] of Object.entries(EXACT_MATCH_VALUES)) {
    const given = label.match[field]
    if (given === undefined || allowed.includes(given)) continue
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['match', field],
      message:
        `label "${label.key}" matches ${field} "${given}", which is not one of ` +
        `${allowed.join(', ')}. ${field} is compared exactly, not as a regex, so ` +
        'this label could never match and would silently cost recall.',
    })
  }
})
export type Label = z.infer<typeof Label>

export const LabelFile = z
  .object({
    schemaVersion: z.literal(1),
    transcript: z.string().min(1),
    labels: z.array(LabelWithExactValuesChecked),
    /** True for the four transcripts held out while tuning (design §5.6). */
    holdout: z.boolean().default(false),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>()
    for (const l of file.labels) {
      if (seen.has(l.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate label key "${l.key}"` })
      }
      seen.add(l.key)
    }
  })
export type LabelFile = z.infer<typeof LabelFile>

export function loadLabelFile(file: string): LabelFile {
  return LabelFile.parse(JSON.parse(readFileSync(file, 'utf8')))
}
