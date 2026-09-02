import { z } from 'zod'

/** Spec §3.1: code is a sketch, not an implementation. */
export const CODE_LINE_CAP = 20
/** Spec §3.1: a real flowchart or sequence diagram, not a system map. */
export const DIAGRAM_LINE_CAP = 25
/** Spec §3.1: an artifact is at most six Level 2 blocks. */
export const ARTIFACT_MAX_CARDS = 6

const lineCount = (s: string): number => s.split('\n').length

/**
 * Optional. Lets the summary (spec 3 of 3) find architecture statements
 * without guessing from titles. `note` is the plain default.
 */
export const CardRole = z.enum(['architecture', 'comparison', 'interface', 'note'])

const base = {
  /** Short stable slug, so a later spec can address one card by id. */
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  role: CardRole.optional(),
}

const TextCard = z.object({
  ...base,
  kind: z.literal('text'),
  /** Plain text. A blank line splits paragraphs. No Markdown is rendered. */
  body: z.string().min(1).max(600),
})

const TableCard = z.object({
  ...base,
  kind: z.literal('table'),
  columns: z.array(z.string().max(40)).min(2).max(4),
  rows: z.array(z.array(z.string().max(80))).min(1).max(6),
})

const CodeCard = z.object({
  ...base,
  kind: z.literal('code'),
  language: z.string().min(1).max(20),
  code: z.string().min(1).max(1500),
  caption: z.string().max(120).optional(),
})

const DiagramCard = z.object({
  ...base,
  kind: z.literal('diagram'),
  /** A literal now; an enum the day a second notation is actually rendered. */
  notation: z.literal('mermaid'),
  source: z.string().min(1).max(1500),
  caption: z.string().max(120).optional(),
})

/**
 * One card of an `artifact` event (spec §3.1).
 *
 * The row-width and line-cap rules live in a `superRefine` on the union
 * rather than `.refine()` on each option: Zod 3's discriminated union only
 * accepts bare objects as options. The JSON Schema export ignores refinements,
 * so these three rules reach the agent only through the template prose and
 * the schema rejection message it gets back.
 */
export const Card = z
  .discriminatedUnion('kind', [TextCard, TableCard, CodeCard, DiagramCard])
  .superRefine((card, ctx) => {
    if (card.kind === 'table') {
      card.rows.forEach((row, i) => {
        if (row.length !== card.columns.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', i],
            message: `row must have exactly ${card.columns.length} cells, one per column`,
          })
        }
      })
    }
    if (card.kind === 'code' && lineCount(card.code) > CODE_LINE_CAP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: `at most ${CODE_LINE_CAP} lines`,
      })
    }
    if (card.kind === 'diagram' && lineCount(card.source) > DIAGRAM_LINE_CAP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source'],
        message: `at most ${DIAGRAM_LINE_CAP} lines`,
      })
    }
  })
export type Card = z.infer<typeof Card>
export type CardKind = Card['kind']
