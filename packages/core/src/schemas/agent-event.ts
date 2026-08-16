import { z } from 'zod'

/**
 * The workflow phases an agent can report from. These are the machine's states
 * (spec §5); the machine itself arrives in M1 phase 3, but the contract has to
 * name them now because `status.phase` is part of the locked §4 union.
 */
export const Phase = z.enum([
  'exploring',
  'clarifying',
  'proposing',
  'planning',
  'executing',
  'verifying',
  'reviewing',
  'integrating',
])
export type Phase = z.infer<typeof Phase>

/** `evidence_items.kind` (spec §3). */
export const EvidenceKind = z.enum([
  'test',
  'diff',
  'lint',
  'build',
  'check',
  'artifact',
  'warning',
])
export type EvidenceKind = z.infer<typeof EvidenceKind>

/** `evidence_items.status` (spec §3). */
export const EvidenceStatus = z.enum(['pass', 'fail', 'warn', 'info'])
export type EvidenceStatus = z.infer<typeof EvidenceStatus>

/**
 * The Output Contract, spec §4 verbatim. This union is the single source of
 * truth: the JSON Schema shipped to the agent is *exported* from it
 * (`json-schema.ts`), never hand-written a second time.
 *
 * The `max()` bounds are load-bearing, not decoration — spec §10's reading
 * budget is enforced against them by `policies/reading-budget.ts`.
 */
export const AgentEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    phase: Phase,
    headline: z.string().max(120),
  }),
  z.object({
    type: z.literal('decision_needed'),
    question: z.string().max(200),
    options: z
      .array(
        z.object({
          id: z.string(),
          label: z.string().max(80),
          pros: z.array(z.string().max(100)).max(5),
          cons: z.array(z.string().max(100)).max(5),
          effort: z.enum(['S', 'M', 'L']).optional(),
          // The ONLY mandatory analysis field (spec §4).
          reversibility: z.enum(['high', 'medium', 'low']),
          verification: z.string().max(120),
        }),
      )
      .min(2)
      .max(4),
    recommendedId: z.string(),
  }),
  z.object({
    type: z.literal('clarification'),
    question: z.string().max(200),
    suggestedAnswers: z.array(z.string().max(80)).max(4),
  }),
  z.object({
    type: z.literal('plan'),
    tasks: z
      .array(z.object({ title: z.string().max(80), description: z.string().max(300) }))
      .min(1)
      .max(12),
  }),
  z.object({
    type: z.literal('task_result'),
    taskId: z.string(),
    claim: z.string().max(150),
    evidenceRefs: z.array(z.string()),
  }),
  z.object({
    type: z.literal('evidence'),
    kind: EvidenceKind,
    status: EvidenceStatus,
    headline: z.string().max(120),
    summary: z.array(z.string().max(100)).max(6),
    artifactPath: z.string().optional(),
    /**
     * Amendment A6. The `check-<index>` id from `normalizeChecks()` this event
     * satisfies. Optional: every other `kind` leaves it unset, and an
     * unrecognised value is ignored rather than guessed at.
     */
    checkId: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal('failure'),
    headline: z.string().max(120),
    probableCause: z.string().max(200),
    suggestedActions: z.array(z.string().max(100)).max(3),
  }),
])
export type AgentEvent = z.infer<typeof AgentEvent>

export const AGENT_EVENT_TYPES = [
  'status',
  'decision_needed',
  'clarification',
  'plan',
  'task_result',
  'evidence',
  'failure',
] as const
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number]
