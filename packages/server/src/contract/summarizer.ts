import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { settings } from '../db/schema.js'
import type { Summarizer } from './pipeline.js'

/** Where the user's own key lives. VADD never ships one (spec §2, D15). */
export const SUMMARIZER_KEY_SETTING = 'anthropic_api_key'

/** Haiku-class, per spec §2. */
export const SUMMARIZER_MODEL = 'claude-haiku-4-5'

const UNSUPPORTED = new Set([
  'maxLength',
  'minLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'multipleOf',
])

/**
 * Removes the JSON Schema keywords the structured-output path rejects.
 *
 * The exported schema keeps them, because they are useful documentation in the
 * prompt contract — the agent should know a headline is capped at 120
 * characters. Only the copy sent to the extraction API is stripped, and the
 * result is re-validated against the full Zod union anyway, so no constraint is
 * actually lost.
 */
export function stripUnsupportedKeywords(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnsupportedKeywords)
  if (schema === null || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED.has(k)) continue
    out[k] = stripUnsupportedKeywords(v)
  }
  return out
}

/**
 * One-shot extraction of `AgentEvent`s from unstructured agent output.
 *
 * Optional and off by default: with no key configured the pipeline never
 * constructs this class and makes no network call at all, which is what spec
 * §10's offline test pins.
 */
export class AnthropicSummarizer implements Summarizer {
  readonly #client: Anthropic

  constructor(
    apiKey: string,
    private readonly model: string = SUMMARIZER_MODEL,
  ) {
    this.#client = new Anthropic({ apiKey })
  }

  async extract(rawText: string, schema: Record<string, unknown>): Promise<unknown> {
    const wrapped = {
      type: 'object',
      additionalProperties: false,
      required: ['events'],
      properties: {
        events: { type: 'array', items: stripUnsupportedKeywords(schema) },
      },
    }

    const res = await this.#client.messages.create({
      model: this.model,
      // Small deliberately: the output is a handful of short JSON objects, and
      // this is an optional feature the user pays for out of their own pocket.
      max_tokens: 4096,
      system:
        'Extract the structured events already present in the assistant transcript below. ' +
        'Report only what the transcript states. Invent nothing; if the transcript supports ' +
        'no event, return an empty array.',
      output_config: { format: { type: 'json_schema', schema: wrapped } },
      messages: [{ role: 'user', content: rawText }],
    })

    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!text) return { events: [] }
    return JSON.parse(text.text)
  }
}

/** Returns a summarizer only when the user has stored their own key. */
export function summarizerFromSettings(db: Db): Summarizer | undefined {
  const row = db.select().from(settings).where(eq(settings.key, SUMMARIZER_KEY_SETTING)).get()
  const key = typeof row?.value === 'string' ? row.value : undefined
  return key && key.length > 0 ? new AnthropicSummarizer(key) : undefined
}
